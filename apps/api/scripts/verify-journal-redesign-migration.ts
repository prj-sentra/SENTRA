import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';

const root = resolve(__dirname, '..');
const migrationsRoot = resolve(root, 'prisma/migrations');
const targetMigration = '20260809000000_journal_redesign';
const reconciliationMigration = '20260809110000_reconcile_journal_redesign_drift';
const migrationPath = resolve(migrationsRoot, targetMigration, 'migration.sql');
const migration = readFileSync(migrationPath, 'utf8');
const reconciliation = readFileSync(resolve(migrationsRoot, reconciliationMigration, 'migration.sql'), 'utf8');
const fixture = readFileSync(resolve(root, 'scripts/fixtures/journal-redesign-migration.sql'), 'utf8');
const migrationNames = readdirSync(migrationsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
const timeframeAliases = ['m1', '1m', 'm5', '5m', 'm15', '15m', 'm30', '30m', 'h1', '1h', 'h4', '4h', 'd1', '1d', 'w1', '1w', 'mn1', '1mn'] as const;
const canonicalTimeframes = ['1m', '5m', '15m', '30m', '1h', '4h', '1D', '1W', '1MN'] as const;

function ids(rows: Array<{ id: string }>): string { return rows.map((row) => row.id).join(', '); }
function values(valuesToQuote: readonly string[]): string { return valuesToQuote.map((value) => `'${value}'`).join(', '); }

async function preflight(client: Client): Promise<void> {
  const unknown = await client.query(`SELECT "id" FROM "trade_analyses" WHERE ("base_timeframe" IS NOT NULL AND lower(btrim("base_timeframe")) NOT IN (${values(timeframeAliases)})) OR ("chart_pattern_timeframe" IS NOT NULL AND lower(btrim("chart_pattern_timeframe")) NOT IN (${values(timeframeAliases)}))`);
  if (unknown.rowCount) throw new Error(`Unknown analysis timeframe mappings: ${ids(unknown.rows)}`);
}

async function postflight(client: Client): Promise<void> {
  const nonCanonical = await client.query(`SELECT "id" FROM "trade_analyses" WHERE ("base_timeframe" IS NOT NULL AND "base_timeframe" NOT IN (${values(canonicalTimeframes)})) OR ("chart_pattern_timeframe" IS NOT NULL AND "chart_pattern_timeframe" NOT IN (${values(canonicalTimeframes)}))`);
  if (nonCanonical.rowCount) throw new Error(`Analysis timeframes were not canonicalized: ${ids(nonCanonical.rows)}`);
  const missing = await client.query(`
    WITH sources AS (
      SELECT t."id" AS trade_id, source.source, source.content, source.label FROM "trades" t CROSS JOIN LATERAL (VALUES
        ('strategy', t."strategy", '전략:'), ('thesis', t."thesis", '매매 가설:'), ('entry_rationale', t."entry_rationale", '진입 근거:'), ('exit_rationale', t."exit_rationale", '청산 근거:'), ('take_profit_criteria', t."take_profit_criteria", 'TP 설정 근거:'), ('stop_loss_criteria', t."stop_loss_criteria", 'SL 설정 근거:'), ('note', t."note", '기타 기록:')
      ) AS source(source, content, label) WHERE source.content IS NOT NULL
      UNION ALL SELECT e."tradeId", 'entry_note', e."note", '진입 기록:' FROM "trade_entries" e WHERE e."note" IS NOT NULL
      UNION ALL SELECT e."tradeId", 'exit_note', e."note", '청산 기록:' FROM "trade_exits" e WHERE e."note" IS NOT NULL
    ) SELECT s.trade_id AS id, s.source FROM sources s JOIN "trade_analyses" a ON a."trade_id" = s.trade_id
    WHERE NOT EXISTS (SELECT 1 FROM "trade_analysis_archives" archive WHERE archive."trade_id" = s.trade_id AND archive."source" = s.source AND archive."content" = s.content AND octet_length(archive."content") = octet_length(s.content)) OR position(s.label || E'\\n' || s.content IN a."note") = 0`);
  if (missing.rowCount) throw new Error(`Unarchived or unfolded authored sources: ${missing.rows.map((row) => `${row.id}:${row.source}`).join(', ')}`);
  const duplicateArchives = await client.query(`SELECT "trade_id" AS id FROM "trade_analysis_archives" GROUP BY "trade_id", "source" HAVING count(*) <> 1`);
  if (duplicateArchives.rowCount) throw new Error(`Archive rerun invariant failed: ${ids(duplicateArchives.rows)}`);
  const invalidCross = await client.query(`SELECT archive."trade_id" AS id FROM "trade_analysis_archives" archive JOIN "trade_analyses" analysis ON analysis."trade_id" = archive."trade_id" WHERE archive."source" = 'cross' AND (archive."content" <> 'none' OR octet_length(archive."content") <> octet_length('none') OR analysis."cross" IS NOT NULL OR position(E'이동평균선 크로스:\\n크로스 없음' IN analysis."note") = 0)`);
  if (invalidCross.rowCount) throw new Error(`Cross NONE archive/display reconciliation failed: ${ids(invalidCross.rows)}`);
}

function assertSafeAlterOrdering(): void {
  const backfill = migration.indexOf('UPDATE "trade_campaign_images" SET "upload_id"');
  const defaultDrop = migration.indexOf('ALTER TABLE "trade_campaign_images" ALTER COLUMN "upload_id" DROP DEFAULT');
  if (backfill < 0 || defaultDrop < backfill || !migration.slice(backfill, defaultDrop).includes('SET CONSTRAINTS ALL IMMEDIATE')) throw new Error('upload_id default must be dropped only after backfill and deferred triggers are drained');
}
async function assertReconciliationSchema(client: Client): Promise<void> {
  const publishedAt = await client.query<{ data_type: string }>(`SELECT data_type FROM information_schema.columns WHERE table_name='trade_campaign_images' AND column_name='published_at'`);
  if (publishedAt.rows[0]?.data_type !== 'timestamp without time zone') throw new Error('trade_campaign_images.published_at is missing or has the wrong type');
  const uploadDefault = await client.query<{ column_default: string | null }>(`SELECT column_default FROM information_schema.columns WHERE table_name='trade_campaign_images' AND column_name='upload_id'`);
  if (uploadDefault.rows[0]?.column_default !== null) throw new Error('upload_id default remained after reconciliation');
  const columns = await client.query<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(`SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name='mt5_position_balances'`);
  const expectedColumns: Record<string, [string, string]> = {
    account_id: ['text', 'NO'], server: ['text', 'NO'], account_login: ['bigint', 'NO'], position_id: ['bigint', 'NO'],
    pre_entry_balance: ['numeric', 'NO'], fetched_at: ['timestamp without time zone', 'NO'], created_at: ['timestamp without time zone', 'NO'], updated_at: ['timestamp without time zone', 'NO'],
  };
  for (const [name, [type, nullable]] of Object.entries(expectedColumns)) {
    const column = columns.rows.find((row) => row.column_name === name);
    if (column?.data_type !== type || column.is_nullable !== nullable) throw new Error(`mt5_position_balances.${name} is missing or has the wrong definition`);
  }
  if (!columns.rows.find((row) => row.column_name === 'created_at')?.column_default?.includes('CURRENT_TIMESTAMP')) throw new Error('mt5_position_balances.created_at default is missing');
  const constraints = await client.query<{ name: string; delete_action: string; update_action: string }>(`SELECT conname AS name, confdeltype AS delete_action, confupdtype AS update_action FROM pg_constraint WHERE conrelid = '"mt5_position_balances"'::regclass AND conname IN ('mt5_position_balances_pkey', 'mt5_position_balances_account_id_fkey')`);
  if (constraints.rowCount !== 2 || constraints.rows.find((row) => row.name === 'mt5_position_balances_account_id_fkey')?.delete_action !== 'r' || constraints.rows.find((row) => row.name === 'mt5_position_balances_account_id_fkey')?.update_action !== 'c') throw new Error('mt5_position_balances primary key or account foreign key is missing or has the wrong actions');
  const index = await client.query<{ indexdef: string }>(`SELECT indexdef FROM pg_indexes WHERE tablename='mt5_position_balances' AND indexname='mt5_position_balances_account_id_idx'`);
  if (!index.rows[0]?.indexdef.includes('(account_id)')) throw new Error('mt5_position_balances account index is missing');
}

async function executeMigration(client: Client, sql: string): Promise<void> {
  await client.query('BEGIN');
  try { await client.query(sql); await client.query('COMMIT'); } catch (error) { await client.query('ROLLBACK'); throw error; }
}

async function expectFailure(client: Client, work: () => Promise<void>, message: string): Promise<void> {
  try { await work(); } catch (error) { if (String(error).includes(message)) return; throw error; }
  throw new Error(`expected failure containing "${message}"`);
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
      if (name === targetMigration) break;
      await executeMigration(client, readFileSync(resolve(migrationsRoot, name, 'migration.sql'), 'utf8'));
    }
    await client.query(fixture);
    await client.query(`UPDATE "trade_analyses" SET "base_timeframe"='2h' WHERE "id"='journal-analysis'`);
    await expectFailure(client, () => preflight(client), 'Unknown analysis timeframe mappings');
    await expectFailure(client, () => executeMigration(client, migration), 'Unknown analysis timeframe mapping');
    await client.query(`UPDATE "trade_analyses" SET "base_timeframe"=' H1 ' WHERE "id"='journal-analysis'`);
    await preflight(client);
    assertSafeAlterOrdering();
    await executeMigration(client, migration);
    await postflight(client);
    for (const name of migrationNames) {
      if (name > targetMigration) await executeMigration(client, readFileSync(resolve(migrationsRoot, name, 'migration.sql'), 'utf8'));
    }
    await assertReconciliationSchema(client);
    await client.query(`DROP TABLE "mt5_position_balances"; ALTER TABLE "trade_campaign_images" DROP COLUMN "published_at"; ALTER TABLE "trade_campaign_images" ALTER COLUMN "upload_id" SET DEFAULT '';`);
    await executeMigration(client, reconciliation);
    await assertReconciliationSchema(client);
    await executeMigration(client, reconciliation);
    await assertReconciliationSchema(client);
  } finally { await client.end(); }
  console.log('journal-redesign migration full lifecycle and drift reconciliation verification passed');
}

void main();
