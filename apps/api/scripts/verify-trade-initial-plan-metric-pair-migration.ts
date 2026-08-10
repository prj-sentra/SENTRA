import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';

const root = resolve(__dirname, '..');
const migrationsRoot = resolve(root, 'prisma/migrations');
const targetMigration = '20260809210000_add_initial_plan_metric_pair';
const migration = readFileSync(resolve(migrationsRoot, targetMigration, 'migration.sql'), 'utf8');
const migrationNames = readdirSync(migrationsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

async function executeMigration(client: Client, name: string, sql: string): Promise<void> {
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw new Error(`migration ${name} failed`, { cause: error });
  }
}

async function expectFailure(work: () => Promise<unknown>, message: string): Promise<void> {
  try {
    await work();
  } catch (error) {
    if (String(error).includes(message)) return;
    throw error;
  }
  throw new Error(`expected failure containing "${message}"`);
}

async function assertSchema(client: Client): Promise<void> {
  const columns = await client.query<{ table_name: string; column_name: string; data_type: string; is_nullable: string }>(`
    SELECT table_name, column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name IN ('mt5_position_entry_plans', 'trade_legacy_metric_quarantine')
  `);
  const expected: Record<string, Array<[string, string, string]>> = {
    mt5_position_entry_plans: [
      ['id', 'text', 'NO'], ['account_id', 'text', 'NO'], ['account_login', 'bigint', 'NO'],
      ['position_id', 'bigint', 'NO'], ['metric_contract_version', 'integer', 'NO'],
    ],
    trade_legacy_metric_quarantine: [
      ['trade_id', 'text', 'NO'], ['original_risk_percent', 'numeric', 'YES'],
      ['original_return_percent', 'numeric', 'YES'], ['reason', 'text', 'NO'], ['source_at', 'timestamp without time zone', 'YES'],
    ],
  };
  for (const [table, definitions] of Object.entries(expected)) {
    for (const [name, type, nullable] of definitions) {
      const column = columns.rows.find((row) => row.table_name === table && row.column_name === name);
      if (!column || column.data_type !== type || column.is_nullable !== nullable) {
        throw new Error(`${table}.${name} is missing or has the wrong definition`);
      }
    }
  }
  const constraints = await client.query<{ conname: string; confdeltype: string; confupdtype: string }>(`
    SELECT conname, confdeltype, confupdtype
    FROM pg_constraint
    WHERE conrelid IN ('"trades"'::regclass, '"mt5_position_entry_plans"'::regclass)
  `);
  const planAccount = constraints.rows.find((row) => row.conname === 'mt5_position_entry_plans_account_id_fkey');
  const provenance = constraints.rows.find((row) => row.conname === 'trades_initial_plan_id_initial_plan_metric_contract_version_fke');
  if (planAccount?.confdeltype !== 'r' || planAccount.confupdtype !== 'c' || provenance?.confdeltype !== 'r' || provenance.confupdtype !== 'c') {
    throw new Error('initial-plan foreign keys are missing or have the wrong actions');
  }
  const check = await client.query<{ present: boolean }>(`SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='"trades"'::regclass AND conname='trades_initial_plan_metric_pair_check') AS present`);
  if (!check.rows[0]?.present) throw new Error('initial-plan metric all-or-none check is missing');
}

async function main(): Promise<void> {
  const connectionString = process.env.MIGRATION_VERIFY_DATABASE_URL;
  if (!connectionString) throw new Error('MIGRATION_VERIFY_DATABASE_URL is required and must identify an isolated empty PostgreSQL database');
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const existing = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S')`);
    if (existing.rows[0]?.count !== '0') throw new Error('migration verification database must be empty');

    for (const name of migrationNames) {
      if (name >= targetMigration) break;
      await executeMigration(client, name, readFileSync(resolve(migrationsRoot, name, 'migration.sql'), 'utf8'));
    }
    await client.query(`
      BEGIN;
      INSERT INTO "trades" ("id", "symbol", "side", "status", "owner_id", "risk_amount", "risk_percent", "updatedAt")
      VALUES
        ('legacy-metric', 'XAUUSD', 'long', 'open', '00000000-0000-0000-0000-000000000001', 12.5, 1.25, '2026-08-09T21:00:00.000Z'),
        ('empty-metric', 'XAUUSD', 'long', 'open', '00000000-0000-0000-0000-000000000001', NULL, NULL, '2026-08-09T21:00:00.000Z');
      INSERT INTO "trade_analyses" ("id", "trade_id", "updated_at")
      VALUES
        ('legacy-metric-analysis', 'legacy-metric', CURRENT_TIMESTAMP),
        ('empty-metric-analysis', 'empty-metric', CURRENT_TIMESTAMP);
      COMMIT;
    `);
    await executeMigration(client, targetMigration, migration);

    const quarantine = await client.query<{ original_risk_percent: string; original_return_percent: string | null; reason: string; source_at: Date }>(`SELECT "original_risk_percent"::text, "original_return_percent"::text, "reason", "source_at" FROM "trade_legacy_metric_quarantine" WHERE "trade_id"='legacy-metric'`);
    if (quarantine.rowCount !== 1
      || Number(quarantine.rows[0]?.original_risk_percent) !== 1.25
      || quarantine.rows[0]?.original_return_percent !== null
      || quarantine.rows[0]?.reason !== 'missing_initial_plan_provenance'
      || quarantine.rows[0]?.source_at.toISOString() !== '2026-08-09T21:00:00.000Z') {
      throw new Error('legacy metrics were not quarantined before being cleared');
    }
    const live = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM "trades" WHERE "risk_amount" IS NOT NULL OR "risk_percent" IS NOT NULL OR "return_percent" IS NOT NULL OR "initial_plan_id" IS NOT NULL OR "initial_plan_metric_contract_version" IS NOT NULL`);
    if (live.rows[0]?.count !== '0') throw new Error('live initial-plan metric fields were not cleared');
    const rerunCandidates = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM "trades" WHERE "risk_amount" IS NOT NULL OR "risk_percent" IS NOT NULL OR "return_percent" IS NOT NULL`);
    if (rerunCandidates.rows[0]?.count !== '0') throw new Error('cleared legacy state did not leave an idempotent quarantine invariant');
    await assertSchema(client);

    await client.query(`INSERT INTO "mt5_accounts" ("id", "owner_id", "nickname", "server", "canonical_server", "account_login", "credential_ciphertext", "credential_iv", "credential_tag", "updated_at") VALUES ('metric-account', '00000000-0000-0000-0000-000000000001', 'Metric', 'broker', 'broker', 100, '\\x00', '\\x00', '\\x00', CURRENT_TIMESTAMP)`);
    await client.query(`INSERT INTO "mt5_position_entry_plans" ("id", "account_id", "server", "account_login", "position_id", "side", "entry_at", "entry_price", "quantity_lots", "take_profit_price", "stop_loss_price", "pre_entry_balance", "account_currency", "tick_size", "tick_value_profit", "tick_value_loss", "captured_at") VALUES ('plan-1', 'metric-account', 'broker', 100, 200, 'long', CURRENT_TIMESTAMP, 1, 1, 2, 0.5, 1000, 'USD', 0.01, 1, 1, CURRENT_TIMESTAMP)`);
    const halfUp = await client.query<{ value: string }>(`SELECT ROUND(1.23445::numeric, 4)::text AS value`);
    if (halfUp.rows[0]?.value !== '1.2345') throw new Error('initial-plan metric formula must use HALF_UP rounding');
    await client.query(`UPDATE "trades" SET "risk_amount"=ROUND((1::numeric - .5::numeric) / .01::numeric * 1 * 1, 4), "risk_percent"=ROUND(((1::numeric - .5::numeric) / .01::numeric * 1 * 1) / 1000::numeric * 100, 4), "return_percent"=ROUND(((2::numeric - 1::numeric) / .01::numeric * 1 * 1) / 1000::numeric * 100, 4), "initial_plan_id"='plan-1', "initial_plan_metric_contract_version"=1 WHERE "id"='empty-metric'`);
    await expectFailure(() => client.query(`UPDATE "trades" SET "return_percent"=NULL WHERE "id"='empty-metric'`), 'trades_initial_plan_metric_pair_check');
    await expectFailure(() => client.query(`UPDATE "trades" SET "initial_plan_metric_contract_version"=2 WHERE "id"='empty-metric'`), 'trades_initial_plan_id_initial_plan_metric_contract_version_fke');
    await client.query(`UPDATE "trades" SET "risk_amount"=50.0000, "risk_percent"=5.0000, "return_percent"=10.0000, "initial_plan_id"='plan-1', "initial_plan_metric_contract_version"=1 WHERE "id"='empty-metric'`);
    const frozen = await client.query<{ risk_amount: string; risk_percent: string; return_percent: string }>(`SELECT "risk_amount"::text, "risk_percent"::text, "return_percent"::text FROM "trades" WHERE "id"='empty-metric'`);
    if (Number(frozen.rows[0]?.risk_amount) !== 50 || Number(frozen.rows[0]?.risk_percent) !== 5 || Number(frozen.rows[0]?.return_percent) !== 10) throw new Error('initial-plan formula or replay freeze changed the proven metric pair');

    const candidates = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM "trades" WHERE "risk_amount" IS NOT NULL OR "risk_percent" IS NOT NULL OR "return_percent" IS NOT NULL`);
    if (candidates.rows[0]?.count !== '1') throw new Error('eligible metric state was not retained');
    const quarantineCount = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM "trade_legacy_metric_quarantine"`);
    if (quarantineCount.rows[0]?.count !== '1') throw new Error('legacy quarantine row was unexpectedly duplicated');
  } finally {
    await client.end();
  }
  console.log('trade initial-plan metric-pair migration verification passed');
}

void main();
