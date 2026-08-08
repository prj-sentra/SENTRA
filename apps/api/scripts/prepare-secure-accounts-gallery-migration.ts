import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { Client } from 'pg';

const connectionString = process.env.MIGRATION_VERIFY_DATABASE_URL ?? process.env.DATABASE_URL;
const imageRoot = process.env.LEGACY_IMAGE_VOLUME;
if (!connectionString) throw new Error('DATABASE_URL is required');
if (!imageRoot) throw new Error('LEGACY_IMAGE_VOLUME is required');

const canonicalizeServer = (value: string): string => value
  .normalize('NFKC')
  .replace(/[\t\n\f\r ]+/g, ' ')
  .trim()
  .replace(/[A-Z]/g, (character) => String.fromCharCode(character.charCodeAt(0) + 32));

async function main(): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const identities = await client.query<{ server: string; login: string }>(`
      SELECT "server", "account_login"::text login FROM "mt5_deals"
      UNION ALL SELECT "server", "account_login"::text FROM "mt5_orders"
      UNION ALL SELECT "server", "account_login"::text FROM "mt5_sync_status"
      UNION ALL SELECT "mt5_server", "mt5_account_login"::text FROM "trades"
        WHERE "mt5_server" IS NOT NULL AND "mt5_account_login" IS NOT NULL
    `);
    const canonical = new Map<string, string>();
    for (const row of identities.rows) {
      const server = canonicalizeServer(row.server);
      if (!server) throw new Error('invalid MT5 identity requires remediation');
      const key = `${server}\0${row.login}`;
      const prior = canonical.get(key);
      if (prior !== undefined && prior !== row.server) throw new Error('canonical MT5 identity collision requires remediation');
      canonical.set(key, row.server);
    }

    const images = await client.query<{ id: string; file_name: string; byte_size: number }>(
      `SELECT "id", "file_name", "byte_size" FROM "trade_chart_images" ORDER BY "id"`,
    );
    const expected = new Set(images.rows.map((row) => row.file_name));
    const actual = readdirSync(imageRoot, { withFileTypes: true });
    if (actual.some((entry) => !entry.isFile()) || actual.some((entry) => !expected.has(entry.name)) || actual.length !== expected.size) {
      throw new Error('legacy image file manifest reconciliation failed: missing or extra files');
    }
    const manifest = images.rows.map((row) => {
      if (basename(row.file_name) !== row.file_name) throw new Error(`unsafe legacy image filename: ${row.file_name}`);
      const path = resolve(imageRoot, row.file_name);
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== row.byte_size) {
        throw new Error(`legacy image file manifest reconciliation failed: ${row.file_name}`);
      }
      return { ...row, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') };
    });

    await client.query('BEGIN');
    await client.query(`CREATE TABLE "legacy_trade_chart_image_file_manifest" (
      "image_id" TEXT PRIMARY KEY, "file_name" TEXT NOT NULL UNIQUE,
      "byte_size" INTEGER NOT NULL CHECK ("byte_size" >= 0), "sha256" TEXT NOT NULL,
      "verified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    for (const row of manifest) {
      await client.query(
        `INSERT INTO "legacy_trade_chart_image_file_manifest" ("image_id","file_name","byte_size","sha256") VALUES ($1,$2,$3,$4)`,
        [row.id, row.file_name, row.byte_size, row.sha256],
      );
    }
    await client.query('COMMIT');
    console.log(`materialized verified migration manifest for ${manifest.length} files`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

void main();
