import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { Client } from 'pg';

const connectionString = process.env.MIGRATION_VERIFY_DATABASE_URL;
const volume = process.env.LEGACY_IMAGE_VOLUME;
if (!connectionString) throw new Error('MIGRATION_VERIFY_DATABASE_URL is required');
if (!volume) throw new Error('LEGACY_IMAGE_VOLUME is required');

interface LegacyImage { id: string; file_name: string; byte_size: number }
interface ManifestEntry extends LegacyImage { sha256: string }

async function main(): Promise<void> {
  const root = resolve(volume!);
  if (!lstatSync(root).isDirectory()) throw new Error('LEGACY_IMAGE_VOLUME must be a directory');
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const source = await client.query<LegacyImage>('SELECT id, file_name, byte_size FROM trade_chart_images ORDER BY id');
    const expectedNames = new Set(source.rows.map((row) => row.file_name));
    if (expectedNames.size !== source.rows.length) throw new Error('legacy image file names must be unique');
    const actualNames = new Set(readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name));
    const missing = [...expectedNames].filter((name) => !actualNames.has(name));
    const extra = [...actualNames].filter((name) => !expectedNames.has(name));
    if (missing.length || extra.length) throw new Error(`legacy image volume mismatch: missing=${missing.join(',')} extra=${extra.join(',')}`);

    const manifest: ManifestEntry[] = source.rows.map((row) => {
      if (basename(row.file_name) !== row.file_name) throw new Error(`unsafe legacy image file name: ${row.file_name}`);
      const bytes = readFileSync(resolve(root, row.file_name));
      if (bytes.byteLength !== row.byte_size) throw new Error(`legacy image byte-size mismatch: ${row.file_name}`);
      return { ...row, sha256: createHash('sha256').update(bytes).digest('hex') };
    });

    await client.query('BEGIN');
    try {
      await client.query('DROP TABLE IF EXISTS legacy_trade_chart_image_file_manifest');
      await client.query('CREATE TABLE legacy_trade_chart_image_file_manifest (image_id TEXT NOT NULL, file_name TEXT NOT NULL, byte_size INTEGER NOT NULL, sha256 TEXT NOT NULL)');
      for (const entry of manifest) {
        await client.query('INSERT INTO legacy_trade_chart_image_file_manifest (image_id,file_name,byte_size,sha256) VALUES ($1,$2,$3,$4)', [entry.id, entry.file_name, entry.byte_size, entry.sha256]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    const auditPath = resolve(process.env.LEGACY_IMAGE_MANIFEST_AUDIT ?? 'legacy-image-manifest.audit.json');
    writeFileSync(auditPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), volume: root, entries: manifest }, null, 2)}\n`, { flag: 'wx' });
    console.log(`loaded ${manifest.length} legacy image manifest rows; audit=${auditPath}`);
  } finally {
    await client.end();
  }
}

void main();
