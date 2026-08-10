import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';

const root = resolve(__dirname, '..');
const migrationsRoot = resolve(root, 'prisma/migrations');
const targetMigration = '20260810000000_provenance_mt5_position_entry_balances';
const migrationNames = readdirSync(migrationsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
const targetSql = readFileSync(resolve(migrationsRoot, targetMigration, 'migration.sql'), 'utf8');

async function migrate(client: Client, name: string, sql: string): Promise<void> {
  await client.query('BEGIN');
  try { await client.query(sql); await client.query('COMMIT'); }
  catch (error) { await client.query('ROLLBACK'); throw new Error(`migration ${name} failed: ${String(error)}`, { cause: error }); }
}

async function expectFailure(work: () => Promise<unknown>, fragment: string): Promise<void> {
  try { await work(); } catch (error) {
    if (String(error).includes(fragment)) return;
    throw error;
  }
  throw new Error(`expected failure containing ${fragment}`);
}

async function main(): Promise<void> {
  const connectionString = process.env.MIGRATION_VERIFY_DATABASE_URL;
  if (!connectionString) throw new Error('MIGRATION_VERIFY_DATABASE_URL is required');
  const databaseName = new URL(connectionString).pathname.replace(/^\//, '').split('/')[0]?.toLowerCase() ?? '';
  if (!/(test|verify|spec|ci)/.test(databaseName)) throw new Error('MIGRATION_VERIFY_DATABASE_URL database name must contain test, verify, spec, or ci');
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
    for (const name of migrationNames) {
      if (name >= targetMigration) break;
      await migrate(client, name, readFileSync(resolve(migrationsRoot, name, 'migration.sql'), 'utf8'));
    }
    await client.query('BEGIN');
    await client.query(`
      INSERT INTO "mt5_accounts" ("id", "owner_id", "nickname", "server", "canonical_server", "account_login", "credential_ciphertext", "credential_iv", "credential_tag", "updated_at")
      VALUES ('verify-account', '00000000-0000-0000-0000-000000000001', 'Verifier', 'broker', 'broker', 42, '\\x00', '\\x00', '\\x00', CURRENT_TIMESTAMP);
      INSERT INTO "trades" ("id", "symbol", "side", "status", "owner_id", "mt5_account_id", "mt5_server", "mt5_server_canonical", "mt5_account_login", "mt5_position_id", "seed_balance", "updatedAt")
      VALUES ('mt5-trade', 'XAUUSD', 'long', 'open', '00000000-0000-0000-0000-000000000001', 'verify-account', 'broker', 'broker', 42, 77, 100.25, CURRENT_TIMESTAMP),
             ('manual-trade', 'EURUSD', 'short', 'open', '00000000-0000-0000-0000-000000000001', NULL, NULL, NULL, NULL, NULL, 200.50, CURRENT_TIMESTAMP);
      INSERT INTO "trade_analyses" ("id", "trade_id", "updated_at") VALUES ('verify-analysis', 'mt5-trade', CURRENT_TIMESTAMP), ('verify-manual-analysis', 'manual-trade', CURRENT_TIMESTAMP);
      INSERT INTO "trade_campaigns" ("id", "root_trade_id", "trading_date", "owner_id", "mt5_account_id", "updated_at") VALUES ('verify-campaign', 'mt5-trade', CURRENT_DATE, '00000000-0000-0000-0000-000000000001', 'verify-account', CURRENT_TIMESTAMP);
      INSERT INTO "mt5_deals" ("account_id", "server", "account_login", "ticket", "order", "position_id", "time", "time_msc", "time_utc", "time_msc_utc", "type", "entry", "magic", "reason", "volume", "price", "commission", "swap", "profit", "fee", "symbol", "comment", "external_id", "fetched_at", "raw_json", "updated_at")
      VALUES ('verify-account', 'broker', 42, 9001, 9001, 77, 1, 1000, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 'XAUUSD', 'raw-preserved', '', CURRENT_TIMESTAMP, '{"source":"verify"}', CURRENT_TIMESTAMP);
      INSERT INTO "mt5_position_balances" ("account_id", "server", "account_login", "position_id", "pre_entry_balance", "fetched_at", "updated_at") VALUES ('verify-account', 'broker', 42, 77, 100.25, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
    `);
    await client.query('COMMIT');
    await migrate(client, targetMigration, targetSql);
    const seeds = await client.query<{ id: string; seed: string | null }>('SELECT "id", "seed_balance"::text AS seed FROM "trades" ORDER BY "id"');
    if (JSON.stringify(seeds.rows) !== JSON.stringify([{ id: 'manual-trade', seed: '200.500000000000000000000000000000' }, { id: 'mt5-trade', seed: null }])) throw new Error('migration did not clear only source-identified MT5 seed balances');
    const preserved = await client.query<{ analysis: number; campaign: number; raw: string }>(`SELECT (SELECT count(*)::int FROM "trade_analyses" WHERE "id"='verify-analysis') analysis, (SELECT count(*)::int FROM "trade_campaigns" WHERE "id"='verify-campaign') campaign, (SELECT "comment" FROM "mt5_deals" WHERE "ticket"=9001) raw`);
    if (preserved.rows[0]?.analysis !== 1 || preserved.rows[0]?.campaign !== 1 || preserved.rows[0]?.raw !== 'raw-preserved') throw new Error('migration lost retained trade, analysis, campaign, or raw-deal facts');
    const legacy = await client.query(`SELECT to_regclass('public.mt5_position_balances') AS value`);
    if (legacy.rows[0]?.value) throw new Error('legacy position-balance table remains');
    const balance = await client.query<{ numeric_precision: number; numeric_scale: number }>(`SELECT numeric_precision, numeric_scale FROM information_schema.columns WHERE table_name='mt5_position_entry_balances' AND column_name='pre_entry_balance'`);
    if (balance.rows[0]?.numeric_precision !== 65 || balance.rows[0]?.numeric_scale !== 30) throw new Error('pre_entry_balance must be DECIMAL(65,30)');
    await client.query(`INSERT INTO "mt5_position_entry_balances" ("account_id", "server", "account_login", "position_id", "ledger_semantics_version", "state", "reason", "fetched_at", "updated_at") VALUES ('verify-account', 'broker', 42, 88, 1, 'UNSUPPORTED_UNANCHORED', 'OPENING_DEAL_OUTSIDE_HISTORY', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`);
    await expectFailure(() => client.query(`INSERT INTO "mt5_position_entry_balances" ("account_id", "server", "account_login", "position_id", "entry_deal_ticket", "entry_order_ticket", "entry_time_msc", "entry_time_msc_utc", "ledger_semantics_version", "state", "pre_entry_balance", "fetched_at", "updated_at") VALUES ('verify-account', 'broker', 42, 89, 9999, 1, 1, CURRENT_TIMESTAMP, 1, 'PROVEN', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`), 'mt5_position_entry_balances_anchor_fkey');
    await expectFailure(() => client.query(`INSERT INTO "mt5_position_entry_balances" ("account_id", "server", "account_login", "position_id", "ledger_semantics_version", "state", "reason", "fetched_at", "updated_at") VALUES ('verify-account', 'broker', 42, 90, 1, 'PROVEN', 'UNSUPPORTED_CHECKPOINT', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`), 'mt5_position_entry_balances_state_check');
    await expectFailure(() => migrate(client, targetMigration, targetSql), 'already exists');
    const postflight = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM "mt5_position_entry_balances" WHERE "state"='UNSUPPORTED_UNANCHORED'`);
    if (postflight.rows[0]?.count !== '1') throw new Error('rerun failure changed postflight data');
  } finally {
    try { await client.query('DROP SCHEMA IF EXISTS public CASCADE;'); } finally { await client.end(); }
  }
  console.log('provenance MT5 position entry balances migration verification passed');
}

void main();
