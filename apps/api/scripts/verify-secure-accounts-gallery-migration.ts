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
  'campaign gallery exceeds ten images',
  'image count reconciliation failed',
  'image metadata reconciliation failed',
  'campaign root scope mismatch',
  'campaign member scope mismatch',
]) {
  if (!migration.includes(proof)) throw new Error(`migration proof missing: ${proof}`);
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
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${migrationName} failed`, { cause: error });
      }
    }
    if (!migrationNames.includes(targetMigration)) throw new Error(`target migration ${targetMigration} was not executed`);
    await client.query(readFileSync(fixturePath, 'utf8'));
  } finally {
    await client.end();
  }
  console.log('secure accounts/gallery migration verification passed');
}

void main();
