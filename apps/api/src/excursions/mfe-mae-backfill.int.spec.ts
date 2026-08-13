import { spawnSync } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import { resolve } from 'node:path';

const script = resolve(__dirname, '../../scripts/backfill-mfe-mae.ts');

function run(args: string[], env: NodeJS.ProcessEnv = {}): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, ['-r', 'ts-node/register', '-r', 'tsconfig-paths/register', script, ...args], {
    cwd: resolve(__dirname, '../..'),
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
}

function digest(payload: object): string {
  const encoded = canonical(payload);
  return createHash('sha256').update(`${Buffer.byteLength(encoded, 'utf8')}:${encoded}`).digest('hex');
}

function signedManifest(payload: object, key = 'test-manifest-key'): string {
  const canonicalPayload = canonical(payload);
  const lengthPrefixed = `${Buffer.byteLength(canonicalPayload, 'utf8')}:${canonicalPayload}`;
  return `${Buffer.from(canonicalPayload).toString('base64url')}.${createHmac('sha256', key).update(lengthPrefixed).digest('base64url')}`;
}

describe('MFE/MAE reviewed backfill boundary', () => {
  it('rejects apply without the explicit confirmation before opening a database connection', () => {
    const result = run(['--apply', '--account-id', 'account', '--batch-manifest', 'token'], { DATABASE_URL: 'postgresql://127.0.0.1:1/not_used' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--confirm-backfill-mfe-mae');
  });

  it('rejects a review cursor supplied to apply before opening a database connection', () => {
    const result = run(['--apply', '--confirm-backfill-mfe-mae', '--account-id', 'account', '--batch-manifest', 'token', '--review-page-cursor', 'cursor'], { DATABASE_URL: 'postgresql://127.0.0.1:1/not_used' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('review page cursors are dry-run only');
  });

  it('requires account scope and never permits a global dry run', () => {
    const result = run([], { DATABASE_URL: 'postgresql://127.0.0.1:1/not_used' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--account-id is required');
  });

  it('keeps reauthorization separate from apply and requires its signed M1 input', () => {
    const result = run(['--reauthorize', '--account-id', 'account'], { DATABASE_URL: 'postgresql://127.0.0.1:1/not_used' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--batch-manifest is required');
  });

  it('rejects a tampered manifest before database work', () => {
    const result = run(
      ['--apply', '--confirm-backfill-mfe-mae', '--account-id', 'account', '--batch-manifest', 'not-a-signed-manifest'],
      { DATABASE_URL: 'postgresql://127.0.0.1:1/not_used', MFE_MAE_BACKFILL_ENABLED: 'true', MFE_MAE_MANIFEST_KEY: 'test-manifest-key' },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('invalid signed token');
  });

  it('requires the original signed M1 instead of accepting R1 as the reviewed manifest', () => {
    const selected: unknown[] = [];
    const token = signedManifest({
      kind: 'R1', version: 1, batchId: 'batch', accountId: 'account', formulaVersion: 1, valuationVersion: 1,
      issuedAtMsc: 1, expiresAtMsc: 1, databaseFingerprint: 'database', selectedBatchFingerprint: createHash('sha256').update('2:[]').digest('hex'),
      selected, originalManifestSha256: 'a'.repeat(64),
    });
    const result = run(
      ['--apply', '--confirm-backfill-mfe-mae', '--account-id', 'account', '--batch-manifest', token],
      { DATABASE_URL: 'postgresql://127.0.0.1:1/not_used', MFE_MAE_BACKFILL_ENABLED: 'true', MFE_MAE_MANIFEST_KEY: 'test-manifest-key' },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('manifest identity is invalid');
  });

  it('rejects an R1 whose original-M1 SHA does not authorize the supplied signed M1 before database work', () => {
    const selected: unknown[] = [];
    const original = {
      kind: 'M1' as const, version: 1, batchId: 'batch', accountId: 'account', formulaVersion: 1, valuationVersion: 1,
      issuedAtMsc: 1, expiresAtMsc: 1, databaseFingerprint: 'database', selectedBatchFingerprint: digest(selected), selected,
    };
    const reauthorization = {
      ...original, kind: 'R1' as const, issuedAtMsc: Date.now(), expiresAtMsc: Date.now() + 60_000, originalManifestSha256: 'a'.repeat(64),
    };
    const result = run(
      ['--apply', '--confirm-backfill-mfe-mae', '--account-id', 'account', '--batch-manifest', signedManifest(original), '--reauthorization-manifest', signedManifest(reauthorization)],
      { DATABASE_URL: 'postgresql://127.0.0.1:1/not_used', MFE_MAE_BACKFILL_ENABLED: 'true', MFE_MAE_MANIFEST_KEY: 'test-manifest-key' },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('reauthorization manifest does not exactly authorize the reviewed manifest');
  });

  it('rejects R1 selection substitution before database work even with the original M1 SHA', () => {
    const selected: unknown[] = [];
    const original = {
      kind: 'M1' as const, version: 1, batchId: 'batch', accountId: 'account', formulaVersion: 1, valuationVersion: 1,
      issuedAtMsc: 1, expiresAtMsc: 1, databaseFingerprint: 'database', selectedBatchFingerprint: digest(selected), selected,
    };
    const reauthorization = {
      ...original, kind: 'R1' as const, issuedAtMsc: Date.now(), expiresAtMsc: Date.now() + 60_000,
      selectedBatchFingerprint: digest([{ scope: 'TRADE', targetId: 'substituted', generation: 1, baseInputFingerprint: 'x', tickSnapshotToMsc: null }]),
      selected: [{ scope: 'TRADE' as const, targetId: 'substituted', generation: 1, baseInputFingerprint: 'x', tickSnapshotToMsc: null }],
      originalManifestSha256: digest(original),
    };
    const result = run(
      ['--apply', '--confirm-backfill-mfe-mae', '--account-id', 'account', '--batch-manifest', signedManifest(original), '--reauthorization-manifest', signedManifest(reauthorization)],
      { DATABASE_URL: 'postgresql://127.0.0.1:1/not_used', MFE_MAE_BACKFILL_ENABLED: 'true', MFE_MAE_MANIFEST_KEY: 'test-manifest-key' },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('reauthorization manifest does not exactly authorize the reviewed manifest');
  });
});
