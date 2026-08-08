import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';

const root = resolve(__dirname, '..');
const migrationPath = resolve(root, 'prisma/migrations/20260808190000_secure_accounts_gallery/migration.sql');
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
if (!connectionString) throw new Error('MIGRATION_VERIFY_DATABASE_URL is required and must identify an isolated migrated PostgreSQL database');

async function main(): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(readFileSync(fixturePath, 'utf8'));
  } finally {
    await client.end();
  }
  console.log('secure accounts/gallery migration verification passed');
}

void main();
