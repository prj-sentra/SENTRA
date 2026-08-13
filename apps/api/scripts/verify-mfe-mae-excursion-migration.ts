import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';

const root = resolve(__dirname, '..');
const migrations = resolve(root, 'prisma/migrations');
const target = '20260812130000_add_mfe_mae_excursions';

async function expectFailure(work: () => Promise<unknown>, expected: string): Promise<void> {
  try { await work(); } catch (error) {
    if (String(error).includes(expected)) return;
    throw error;
  }
  throw new Error(`expected failure containing ${expected}`);
}

async function migrate(client: Client, name: string): Promise<void> {
  await client.query('BEGIN');
  try {
    await client.query(readFileSync(resolve(migrations, name, 'migration.sql'), 'utf8'));
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw new Error(`migration ${name} failed: ${String(error)}`, { cause: error });
  }
}

async function main(): Promise<void> {
  const connectionString = process.env.MIGRATION_VERIFY_DATABASE_URL;
  if (!connectionString) throw new Error('MIGRATION_VERIFY_DATABASE_URL is required');
  const database = new URL(connectionString).pathname.replace(/^\//, '').split('/')[0]?.toLowerCase() ?? '';
  if (!/(test|verify|spec|ci)/.test(database)) throw new Error('MIGRATION_VERIFY_DATABASE_URL database name must contain test, verify, spec, or ci');
  const names = readdirSync(migrations, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  if (!names.includes(target)) throw new Error(`missing ${target}`);
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
    for (const name of names) await migrate(client, name);
    const tables = await client.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('trade_excursion_results','trade_campaign_excursion_results','excursion_work_items','excursion_work_progress') ORDER BY table_name`);
    if (JSON.stringify(tables.rows.map((row) => row.table_name)) !== JSON.stringify(['excursion_work_items', 'excursion_work_progress', 'trade_campaign_excursion_results', 'trade_excursion_results'])) throw new Error('excursion tables are missing');
    const checks = await client.query<{ conname: string }>(`SELECT conname FROM pg_constraint WHERE conrelid IN ('trade_excursion_results'::regclass, 'trade_campaign_excursion_results'::regclass, 'excursion_work_items'::regclass, 'excursion_work_progress'::regclass) AND contype='c' ORDER BY conname`);
    for (const required of ['trade_excursion_results_status_check', 'trade_excursion_results_failed_metrics_check', 'trade_excursion_results_extrema_check', 'trade_campaign_excursion_results_status_check', 'excursion_work_items_scope_target_check']) {
      if (!checks.rows.some((row) => row.conname === required)) throw new Error(`missing check ${required}`);
    }
    await client.query(`
      INSERT INTO "app_users" ("id", "username", "normalized_username", "password_hash", "updated_at") VALUES ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'verify-user', 'verify-user', 'hash', CURRENT_TIMESTAMP);
      INSERT INTO "mt5_accounts" ("id", "owner_id", "nickname", "server", "canonical_server", "account_login", "credential_ciphertext", "credential_iv", "credential_tag", "updated_at") VALUES ('verify-account', 'ffffffff-ffff-4fff-8fff-ffffffffffff', 'Verifier', 'broker', 'broker', 42, '\\x00', '\\x00', '\\x00', CURRENT_TIMESTAMP);
      INSERT INTO "trades" ("id", "symbol", "side", "status", "owner_id", "mt5_account_id", "updatedAt") VALUES ('verify-trade', 'EURUSD', 'long', 'closed', 'ffffffff-ffff-4fff-8fff-ffffffffffff', 'verify-account', CURRENT_TIMESTAMP);
      INSERT INTO "trade_analyses" ("id", "trade_id", "updated_at") VALUES ('verify-analysis', 'verify-trade', CURRENT_TIMESTAMP);
      INSERT INTO "trade_campaigns" ("id", "root_trade_id", "trading_date", "owner_id", "mt5_account_id", "updated_at") VALUES ('verify-campaign', 'verify-trade', CURRENT_DATE, 'ffffffff-ffff-4fff-8fff-ffffffffffff', 'verify-account', CURRENT_TIMESTAMP);
      INSERT INTO "trade_excursion_results" ("trade_id", "status", "attempt_calculation_version", "attempt_input_fingerprint", "last_attempted_at", "success_calculation_version", "success_input_fingerprint", "last_succeeded_at", "updated_at") VALUES ('verify-trade', 'SUCCESS', 1, 'input', CURRENT_TIMESTAMP, 1, 'input', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
      INSERT INTO "trade_campaign_excursion_results" ("campaign_id", "status", "attempt_calculation_version", "attempt_input_fingerprint", "last_attempted_at", "failure_reason", "success_calculation_version", "success_input_fingerprint", "last_succeeded_at", "price_family_status", "pnl_family_status", "updated_at") VALUES ('verify-campaign', 'STALE', 1, 'input', CURRENT_TIMESTAMP, 'stale', 1, 'input', CURRENT_TIMESTAMP, 'STALE', 'STALE', CURRENT_TIMESTAMP);
    `);
    await expectFailure(() => client.query(`UPDATE "trade_excursion_results" SET "success_calculation_version"=NULL WHERE "trade_id"='verify-trade'`), 'trade_excursion_results_status_check');
    await expectFailure(() => client.query(`UPDATE "trade_excursion_results" SET "status"='FAILED', "failure_reason"='failed', "success_calculation_version"=NULL, "success_input_fingerprint"=NULL, "last_succeeded_at"=NULL, "mfe_price"=1, "mfe_price_mark_price"=2, "mfe_price_occurred_at"=CURRENT_TIMESTAMP WHERE "trade_id"='verify-trade'`), 'trade_excursion_results_failed_metrics_check');
    await expectFailure(() => client.query(`INSERT INTO "excursion_work_items" ("id", "scope", "target_id", "trade_id", "campaign_id", "account_id", "base_input_fingerprint", "reason", "updated_at") VALUES ('verify-invalid-work', 'TRADE', 'verify-trade', NULL, NULL, 'verify-account', 'input', 'verify', CURRENT_TIMESTAMP)`), 'excursion_work_items_scope_target_check');
    await client.query(`DELETE FROM "trade_campaigns" WHERE "id"='verify-campaign'; DELETE FROM "trades" WHERE "id"='verify-trade'`);
    const cascaded = await client.query<{ results: string; campaign: string }>(`SELECT (SELECT count(*)::text FROM "trade_excursion_results") results, (SELECT count(*)::text FROM "trade_campaign_excursion_results") campaign`);
    if (cascaded.rows[0]?.results !== '0' || cascaded.rows[0]?.campaign !== '0') throw new Error('trade cascade did not remove excursion results');
  } finally {
    try { await client.query('DROP SCHEMA IF EXISTS public CASCADE;'); } finally { await client.end(); }
  }
  console.log('MFE/MAE excursion migration verification passed');
}

void main();
