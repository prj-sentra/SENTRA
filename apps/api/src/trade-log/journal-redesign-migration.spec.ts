import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('journal redesign migration ordering', () => {
  it('drains deferred trigger work before its required post-backfill default removal', () => {
    const migration = readFileSync(resolve(__dirname, '../../prisma/migrations/20260809000000_journal_redesign/migration.sql'), 'utf8');
    const backfill = migration.indexOf('UPDATE "trade_campaign_images" SET "upload_id" = "id"');
    const drain = migration.indexOf('SET CONSTRAINTS ALL IMMEDIATE');
    const dropDefault = migration.indexOf('ALTER TABLE "trade_campaign_images" ALTER COLUMN "upload_id" DROP DEFAULT');
    expect(backfill).toBeGreaterThanOrEqual(0);
    expect(drain).toBeGreaterThan(backfill);
    expect(dropDefault).toBeGreaterThan(drain);
  });

  it('initializes replay IDs then removes the temporary database default', () => {
    const migration = readFileSync(resolve(__dirname, '../../prisma/migrations/20260809000000_journal_redesign/migration.sql'), 'utf8');
    expect(migration).toContain('ADD COLUMN "upload_id" TEXT NOT NULL DEFAULT');
    expect(migration).toContain('UPDATE "trade_campaign_images" SET "upload_id" = "id"');
    expect(migration).toContain('ALTER COLUMN "upload_id" DROP DEFAULT');
  });
  it('fails unknown timeframes before mutation and preserves every authored note source', () => {
    const migration = readFileSync(resolve(__dirname, '../../prisma/migrations/20260809000000_journal_redesign/migration.sql'), 'utf8');
    const preflight = migration.indexOf("RAISE EXCEPTION 'Unknown analysis timeframe mapping'");
    const firstUpdate = migration.indexOf('UPDATE "trade_analyses"');
    expect(preflight).toBeGreaterThanOrEqual(0);
    expect(preflight).toBeLessThan(firstUpdate);
    expect(migration).toContain("WHEN 'h1' THEN '1h'");
    expect(migration).toContain("WHEN 'mn1' THEN '1MN'");
    expect(migration).toContain("E'진입 기록:\\n' || e.\"note\"");
    expect(migration).toContain("E'청산 기록:\\n' || x.\"note\"");
    expect(migration).toContain("SELECT md5(a.\"trade_id\" || ':cross')");
    expect(migration).toContain('UPDATE "trade_analyses" SET "cross" = NULL');
  });
  it('keeps verifier aliases and reconciliation checks in lockstep with the migration', () => {
    const migration = readFileSync(resolve(__dirname, '../../prisma/migrations/20260809000000_journal_redesign/migration.sql'), 'utf8');
    const verifier = readFileSync(resolve(__dirname, '../../scripts/verify-journal-redesign-migration.ts'), 'utf8');
    for (const alias of ['m1', '1m', 'h1', '1h', 'd1', '1d', 'mn1', '1mn']) {
      expect(migration).toContain(`'${alias}'`);
      expect(verifier).toContain(`'${alias}'`);
    }
    expect(verifier).toContain('octet_length(archive."content") = octet_length(s.content)');
    expect(verifier).toContain("position(s.label || E'\\\\n' || s.content IN a.\"note\")");
    expect(verifier).toContain('Archive rerun invariant failed');
  });
  it('keeps cross NONE raw archival distinct from its Korean display migration', () => {
    const verifier = readFileSync(resolve(__dirname, '../../scripts/verify-journal-redesign-migration.ts'), 'utf8');
    const fixture = readFileSync(resolve(__dirname, '../../scripts/fixtures/journal-redesign-migration.sql'), 'utf8');
    expect(verifier).toContain("scripts/fixtures/journal-redesign-migration.sql");
    expect(verifier).toContain('await client.query(fixture)');
    expect(verifier).not.toContain("UNION ALL SELECT archive.\"trade_id\", 'cross'");
    expect(verifier).toContain('archive."content" <> \'none\'');
    expect(verifier).toContain("analysis.\"cross\" IS NOT NULL");
    expect(verifier).toContain("E'이동평균선 크로스:\\\\n크로스 없음'");
    expect(fixture).toContain("'legacy-cross-none'");
    expect(fixture).toContain('"base_timeframe","cross"');
    expect(fixture).toContain("' H1 ','none'");
  });
  it('reconciles the known final-schema drift with guarded SQL', () => {
    const migration = readFileSync(resolve(__dirname, '../../prisma/migrations/20260809110000_reconcile_journal_redesign_drift/migration.sql'), 'utf8');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "published_at" TIMESTAMP(3)');
    expect(migration).toContain('ALTER COLUMN "upload_id" DROP DEFAULT');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "mt5_position_balances"');
    expect(migration).toContain('PRIMARY KEY ("server","account_login","position_id")');
    expect(migration).toContain('CREATE INDEX IF NOT EXISTS "mt5_position_balances_account_id_idx"');
    expect(migration).toContain('FOREIGN KEY ("account_id") REFERENCES "mt5_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE');
    expect(migration).toContain("conname = 'mt5_position_balances_account_id_fkey'");
  });
  it('runs the reconciliation after the full ordered lifecycle and verifies reruns', () => {
    const verifier = readFileSync(resolve(__dirname, '../../scripts/verify-journal-redesign-migration.ts'), 'utf8');
    expect(verifier).toContain("const reconciliationMigration = '20260809110000_reconcile_journal_redesign_drift'");
    expect(verifier).toContain('if (name > targetMigration)');
    expect(verifier).toContain('DROP TABLE "mt5_position_balances"');
    expect(verifier).toContain('await executeMigration(client, reconciliation);');
    expect(verifier).toContain('await assertReconciliationSchema(client);');
  });
});
