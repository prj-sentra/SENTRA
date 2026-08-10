import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(__dirname, '../../prisma/migrations/20260809210000_add_initial_plan_metric_pair/migration.sql');
const verifierPath = resolve(__dirname, '../../scripts/verify-trade-initial-plan-metric-pair-migration.ts');
const backfillPath = resolve(__dirname, '../../scripts/backfill-trade-initial-plan-metrics.ts');

describe('trade initial-plan metric-pair migration contract', () => {
  it('creates the immutable entry-plan and legacy-quarantine schema using Prisma names', () => {
    const migration = readFileSync(migrationPath, 'utf8');
    expect(migration).toContain('CREATE TABLE "mt5_position_entry_plans"');
    expect(migration).toContain('"metric_contract_version" INTEGER NOT NULL DEFAULT 1');
    expect(migration).toContain('CREATE TABLE "trade_legacy_metric_quarantine"');
    expect(migration).toContain('"original_risk_percent" DECIMAL(65,30)');
    expect(migration).toContain('"original_return_percent" DECIMAL(65,30)');
    expect(migration).toContain('"return_percent" DECIMAL(65,30)');
    expect(migration).toContain('"initial_plan_metric_contract_version" INTEGER');
    expect(migration).toContain('REFERENCES "mt5_position_entry_plans"("id", "metric_contract_version")');
    expect(migration).toContain('ON DELETE RESTRICT ON UPDATE CASCADE');
  });

  it('quarantines legacy values before clearing every governed live field', () => {
    const migration = readFileSync(migrationPath, 'utf8');
    const quarantine = migration.indexOf('INSERT INTO "trade_legacy_metric_quarantine"');
    const clear = migration.indexOf('UPDATE "trades"\nSET "risk_amount" = NULL');
    expect(quarantine).toBeGreaterThanOrEqual(0);
    expect(clear).toBeGreaterThan(quarantine);
    expect(migration.slice(quarantine, clear)).toContain('"risk_percent"');
    expect(migration.slice(quarantine, clear)).toContain('"updatedAt"');
    expect(migration.slice(clear)).toContain('"return_percent" = NULL');
    expect(migration.slice(clear)).toContain('"initial_plan_id" = NULL');
    expect(migration.slice(clear)).toContain('"initial_plan_metric_contract_version" = NULL');
    expect(migration.slice(quarantine, clear)).toContain('ON CONFLICT ("id") DO NOTHING');
  });

  it('enforces all-or-none metrics and provenance, and verifies eligible and ineligible states', () => {
    const migration = readFileSync(migrationPath, 'utf8');
    const verifier = readFileSync(verifierPath, 'utf8');
    expect(migration).toContain('CONSTRAINT "trades_initial_plan_metric_pair_check"');
    expect(migration).toContain('"risk_amount" IS NOT NULL AND "risk_percent" IS NOT NULL AND "return_percent" IS NOT NULL');
    expect(migration).toContain('"initial_plan_id" IS NOT NULL AND "initial_plan_metric_contract_version" IS NOT NULL');
    expect(verifier).toContain('migration verification database must be empty');
    expect(verifier).toMatch(/"risk_amount"\s*=\s*ROUND\(/);
    expect(verifier).toContain('trades_initial_plan_metric_pair_check');
    expect(verifier).toContain('trades_initial_plan_id_initial_plan_metric_contract_version_fke');
    expect(verifier).toContain('idempotent quarantine invariant');
  });
  it('makes backfill snapshot conflicts transactional and converges quarantined metric states in one run', () => {
    const backfill = readFileSync(backfillPath, 'utf8');

    expect(backfill).toContain('throw new Error(`immutable bridge entry plan conflicts for position ${plan.positionId}`)');
    expect(backfill).toContain("} catch (error) { await client.query('ROLLBACK'); throw error; }");
    expect(backfill).toMatch(/partial_initial_plan_metric_state[\s\S]*populated = 0;[\s\S]*counts\.eligible \+= 1;[\s\S]*initial_plan_metric_contract_version=\$7/);
    expect(backfill).toMatch(/conflicting_initial_plan_metric_state[\s\S]*counts\.eligible \+= 1;[\s\S]*initial_plan_metric_contract_version=\$7/);
    expect(backfill).toContain('counts.alreadyProven += 1');
  });

  it('never backfills a live metric pair from quarantined legacy risk or return values', () => {
    const migration = readFileSync(migrationPath, 'utf8');
    const quarantine = migration.indexOf('INSERT INTO "trade_legacy_metric_quarantine"');
    const clear = migration.indexOf('UPDATE "trades"\nSET "risk_amount" = NULL');

    expect(migration.slice(quarantine, clear)).not.toContain('INSERT INTO "mt5_position_entry_plans"');
    expect(migration.slice(clear)).toContain('"risk_amount" = NULL');
    expect(migration.slice(clear)).toContain('"risk_percent" = NULL');
    expect(migration.slice(clear)).toContain('"return_percent" = NULL');
    expect(migration.slice(clear)).toContain('"initial_plan_id" = NULL');
    expect(migration.slice(clear)).toContain('"initial_plan_metric_contract_version" = NULL');
  });
});
