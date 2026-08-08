import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';

const root = resolve(__dirname, '..');
const migrationsRoot = resolve(root, 'prisma/migrations');
const targetMigration = '20260808190000_secure_accounts_gallery';
const migrationNames = readdirSync(migrationsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const migrationPath = resolve(migrationsRoot, targetMigration, 'migration.sql');
const fixturePath = resolve(root, 'prisma/fixtures/secure-accounts-gallery.verify.sql');
const migration = readFileSync(migrationPath, 'utf8');

for (const proof of [
  'canonical MT5 identity collision requires remediation',
  'legacy image maps to multiple campaigns',
  'legacy image has no campaign and no opened_at',
  'legacy image file manifest required',
  'legacy image file manifest reconciliation failed',
  'campaign gallery exceeds ten images',
  'image count reconciliation failed',
  'image metadata reconciliation failed',
  'campaign root scope mismatch',
  'campaign member scope mismatch',
]) {
  if (!migration.includes(proof)) throw new Error(`migration proof missing: ${proof}`);
}
const manifestSql = `
  CREATE TABLE "legacy_trade_chart_image_file_manifest" (
    "image_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL
  )
`;


const baseTrade = (id: string, openedAt: string | null = 'CURRENT_TIMESTAMP') => `
  BEGIN;
  INSERT INTO "trades" ("id","symbol","side","status","createdAt","updatedAt","opened_at")
  VALUES ('${id}','XAUUSD','long','open',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,${openedAt});
  INSERT INTO "trade_analyses" ("id","trade_id","updated_at")
  VALUES (md5('${id}:analysis'),'${id}',CURRENT_TIMESTAMP);
  COMMIT;
`;

async function verifyFailureScenario(client: Client, migrationSql: string, expected: string, setup: string): Promise<void> {
  await client.query(setup);
  await expectMigrationFailure(client, migrationSql, expected);
  const retained = await client.query<{ present: boolean }>(
    `SELECT to_regclass('public.trade_chart_images') IS NOT NULL AS present`,
  );
  if (!retained.rows[0]?.present) throw new Error(`${expected}: source metadata was dropped before rollback`);
  await client.query('TRUNCATE "trade_chart_images","campaign_memberships","trade_campaigns","mt5_deals","mt5_orders","mt5_sync_status","trades" CASCADE');
  await client.query('DROP TABLE IF EXISTS legacy_trade_chart_image_file_manifest');
}

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

const connectionString = process.env.MIGRATION_VERIFY_DATABASE_URL;
if (!connectionString) throw new Error('MIGRATION_VERIFY_DATABASE_URL is required and must identify an isolated empty PostgreSQL database');

async function main(): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const existing = await client.query<{ count: string }>(`
      SELECT count(*)::text AS count
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
    `);
    if (existing.rows[0]?.count !== '0') {
      throw new Error('migration verification database must be empty');
    }
    for (const migrationName of migrationNames) {
      const sql = readFileSync(resolve(migrationsRoot, migrationName, 'migration.sql'), 'utf8');
      if (migrationName !== targetMigration) {
        await executeMigration(client, migrationName, sql);
        continue;
      }

      await verifyFailureScenario(client, sql, 'canonical MT5 identity collision requires remediation', `
        ${baseTrade('identity-a')}
        ${baseTrade('identity-b')}
        UPDATE "trades" SET "mt5_server"=E'Broker\tLive',"mt5_account_login"=7,"mt5_position_id"=1 WHERE "id"='identity-a';
        UPDATE "trades" SET "mt5_server"='broker live',"mt5_account_login"=7,"mt5_position_id"=2 WHERE "id"='identity-b'
      `);
      await verifyFailureScenario(client, sql, 'legacy image has no campaign and no opened_at', `
        ${baseTrade('null-time', 'NULL')}
        INSERT INTO "trade_chart_images" ("id","trade_id","file_name","mime_type","byte_size","width","height","updated_at")
        VALUES ('null-image','null-time','null.webp','image/webp',1,1,1,CURRENT_TIMESTAMP);
        ${manifestSql};
        INSERT INTO "legacy_trade_chart_image_file_manifest" VALUES ('null-image','null.webp',1,repeat('0',64))
      `);
      await verifyFailureScenario(client, sql, 'legacy image maps to multiple campaigns', `
        ${baseTrade('multi-root')}
        ${baseTrade('multi-member')}
        INSERT INTO "trade_campaigns" ("id","root_trade_id","trading_date","updated_at") VALUES
          ('campaign-a','multi-member',CURRENT_DATE,CURRENT_TIMESTAMP),
          ('campaign-b','multi-root',CURRENT_DATE,CURRENT_TIMESTAMP);
        INSERT INTO "campaign_memberships" ("id","campaign_id","trade_id","source","updated_at")
          VALUES ('member-a','campaign-a','multi-root','manual',CURRENT_TIMESTAMP);
        INSERT INTO "trade_chart_images" ("id","trade_id","file_name","mime_type","byte_size","width","height","updated_at")
          VALUES ('multi-image','multi-root','multi.webp','image/webp',1,1,1,CURRENT_TIMESTAMP);
        ${manifestSql};
        INSERT INTO "legacy_trade_chart_image_file_manifest" VALUES ('multi-image','multi.webp',1,repeat('0',64))
      `);
      await verifyFailureScenario(client, sql, 'legacy image file manifest reconciliation failed', `
        ${baseTrade('hash-root')}
        INSERT INTO "trade_chart_images" ("id","trade_id","file_name","mime_type","byte_size","width","height","updated_at")
          VALUES ('hash-image','hash-root','hash.webp','image/webp',1,1,1,CURRENT_TIMESTAMP);
        ${manifestSql};
        INSERT INTO "legacy_trade_chart_image_file_manifest" VALUES ('hash-image','hash.webp',1,'mismatch')
      `);
      await verifyFailureScenario(client, sql, 'trade_campaign_images_position_check', `
        DO $$ BEGIN
          FOR i IN 0..10 LOOP
            INSERT INTO "trades" ("id","symbol","side","status","createdAt","updatedAt","opened_at")
              VALUES ('limit-'||i,'XAUUSD','long','open',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
            INSERT INTO "trade_analyses" ("id","trade_id","updated_at")
              VALUES (md5('limit-'||i||':analysis'),'limit-'||i,CURRENT_TIMESTAMP);
          END LOOP;
        END $$;
        INSERT INTO "trade_campaigns" ("id","root_trade_id","trading_date","updated_at")
          VALUES ('limit-campaign','limit-0',CURRENT_DATE,CURRENT_TIMESTAMP);
        INSERT INTO "campaign_memberships" ("id","campaign_id","trade_id","source","updated_at")
          SELECT 'limit-member-'||i,'limit-campaign','limit-'||i,'manual',CURRENT_TIMESTAMP FROM generate_series(0,10) i;
        INSERT INTO "trade_chart_images" ("id","trade_id","file_name","mime_type","byte_size","width","height","updated_at")
          SELECT 'limit-image-'||i,'limit-'||i,'limit-'||i||'.webp','image/webp',1,1,1,CURRENT_TIMESTAMP FROM generate_series(0,10) i;
        ${manifestSql};
        INSERT INTO "legacy_trade_chart_image_file_manifest"
          SELECT 'limit-image-'||i,'limit-'||i||'.webp',1,repeat('0',64) FROM generate_series(0,10) i
      `);
      // A missing filesystem-produced manifest must fail before the legacy
      // metadata table is dropped. The same database must then be cut over
      // successfully once the manifest has been supplied.
      await expectMigrationFailure(client, sql, 'legacy image file manifest required');
      const sourceAfterFailure = await client.query<{ present: boolean }>(
        `SELECT to_regclass('public.trade_chart_images') IS NOT NULL AS present`,
      );
      if (!sourceAfterFailure.rows[0]?.present) throw new Error('target migration dropped legacy image metadata before reconciliation');
      await client.query(manifestSql);
      await executeMigration(client, migrationName, sql);

      // A rerun is rejected without damaging the completed destination.
      await expectMigrationFailure(client, sql, 'already exists');
      const destinationAfterRerun = await client.query<{ present: boolean }>(
        `SELECT to_regclass('public.trade_campaign_images') IS NOT NULL AS present`,
      );
      if (!destinationAfterRerun.rows[0]?.present) throw new Error('failed rerun damaged migrated gallery');
    }
    if (!migrationNames.includes(targetMigration)) throw new Error(`target migration ${targetMigration} was not executed`);
    await client.query(readFileSync(fixturePath, 'utf8'));
  } finally {
    await client.end();
  }
  console.log('secure accounts/gallery migration verification passed');
}

void main();

async function expectMigrationFailure(client: Client, sql: string, message: string): Promise<void> {
  await client.query('BEGIN');
  try {
    await client.query(sql);
  } catch (error) {
    await client.query('ROLLBACK');
    const actual = error instanceof Error ? error.message : String(error);
    if (!actual.includes(message)) throw new Error(`expected migration failure containing "${message}", got "${actual}"`);
    return;
  }
  await client.query('ROLLBACK');
  throw new Error(`migration unexpectedly succeeded; expected "${message}"`);
}
