import { randomUUID } from 'node:crypto';
import { unlinkSync, writeFileSync } from 'node:fs';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from 'pg';

const execFile = promisify(execFileCallback);

type BackfillCounts = {
  mode: 'dry-run' | 'apply';
  plans: number;
  eligible: number;
  unsupported: number;
  alreadyProven: number;
  conflict: number;
  quarantined: number;
  cleared: number;
  createdPlans: number;
};

type Plan = {
  positionId: string;
  side: 'long' | 'short';
  entryAt: number;
  entryPrice: string;
  quantityLots: string;
  takeProfitPrice: string;
  stopLossPrice: string;
  preEntryBalance: string;
  accountCurrency: string;
  tickSize: string;
  tickValueProfit: string;
  tickValueLoss: string;
};

const validPlan = (positionId: string): Plan => ({
  positionId,
  side: 'long',
  entryAt: 1_760_000_000_000,
  entryPrice: '100',
  quantityLots: '1',
  takeProfitPrice: '120',
  stopLossPrice: '90',
  preEntryBalance: '1000',
  accountCurrency: 'USD',
  tickSize: '1',
  tickValueProfit: '1',
  tickValueLoss: '1',
});

const unsupportedPlan = (positionId: string): Plan => ({ ...validPlan(positionId), stopLossPrice: '110' });

describe('trade initial-plan metric backfill on disposable PostgreSQL', () => {
  const databaseUrl = process.env.BACKFILL_TEST_DATABASE_URL;
  const run = databaseUrl ? it : it.skip;
  let database: Client;
  let schema: string;
  let scopedUrl: string;

  function evidence(plans: Plan[]): string {
    return JSON.stringify({ server: 'Fixture Server', accountLogin: 7001, positionEntryPlans: plans });
  }

  function databaseUrlForSchema(url: string, name: string): string {
    const scoped = new URL(url);
    scoped.searchParams.set('options', `-c search_path=${name}`);
    return scoped.toString();
  }

  async function execute(sql: string, values?: unknown[]): Promise<void> {
    await database.query(sql, values);
  }

  async function seedTrade(positionId: string, state: 'empty' | 'partial' | 'full' = 'empty'): Promise<void> {
    const values = state === 'empty'
      ? [null, null, null, null, null]
      : state === 'partial'
        ? [null, '1.0000', null, null, null]
        : ['999.0000', '99.0000', '88.0000', 'wrong-plan', 1];
    await execute(
      `INSERT INTO trades (id, mt5_account_id, mt5_server_canonical, mt5_account_login, mt5_position_id, risk_amount, risk_percent, return_percent, initial_plan_id, initial_plan_metric_contract_version)
       VALUES ($1, 'account', 'fixture server', 7001, $2, $3, $4, $5, $6, $7)`,
      [`trade-${positionId}`, positionId, ...values],
    );
  }

  function evidencePath(plans: Plan[]): string {
    const path = `/tmp/trade-initial-plan-backfill-${randomUUID()}.json`;
    writeFileSync(path, evidence(plans), 'utf8');
    return path;
  }

  async function runBackfill(plans: Plan[], apply = false): Promise<BackfillCounts> {
    const path = evidencePath(plans);
    const args = [
      '-r', 'ts-node/register', '-r', 'tsconfig-paths/register',
      'scripts/backfill-trade-initial-plan-metrics.ts',
      '--bridge-response', path,
    ];
    if (apply) args.push('--apply', '--confirm-backfill-trade-initial-plan-metrics');
    try {
      const result = await execFile(process.execPath, args, {
        cwd: `${__dirname}/../..`,
        env: { ...process.env, BACKFILL_DATABASE_URL: scopedUrl },
      });
      return JSON.parse(result.stdout.trim()) as BackfillCounts;
    } finally {
      unlinkSync(path);
    }
  }

  async function metricState(positionId: string): Promise<Record<string, unknown>> {
    return (await database.query(
      `SELECT risk_amount::text, risk_percent::text, return_percent::text, initial_plan_id, initial_plan_metric_contract_version
       FROM trades WHERE id = $1`,
      [`trade-${positionId}`],
    )).rows[0];
  }

  beforeEach(async () => {
    if (!databaseUrl) throw new Error('BACKFILL_TEST_DATABASE_URL is required');
    database = new Client({ connectionString: databaseUrl });
    await database.connect();
    const name = (await database.query<{ database: string }>('SELECT current_database() AS database')).rows[0].database;
    if (!/(^|[_-])(test|testing|ci|spec)([_-]|$)/i.test(name)) throw new Error(`refusing backfill integration database: ${name}`);
    schema = `initial_plan_backfill_spec_${randomUUID().replaceAll('-', '_')}`;
    scopedUrl = databaseUrlForSchema(databaseUrl, schema);
    await execute(`CREATE SCHEMA ${schema}; SET search_path TO ${schema}`);
    await execute(`
      CREATE TABLE mt5_accounts (id text PRIMARY KEY, canonical_server text NOT NULL, account_login bigint NOT NULL);
      CREATE TABLE mt5_position_entry_plans (
        id text PRIMARY KEY, account_id text NOT NULL, server text NOT NULL, account_login bigint NOT NULL, position_id text NOT NULL,
        side text NOT NULL, entry_at timestamptz NOT NULL, entry_price numeric NOT NULL, quantity_lots numeric NOT NULL,
        take_profit_price numeric NOT NULL, stop_loss_price numeric NOT NULL, pre_entry_balance numeric NOT NULL,
        account_currency text NOT NULL, tick_size numeric NOT NULL, tick_value_profit numeric NOT NULL, tick_value_loss numeric NOT NULL,
        metric_contract_version integer NOT NULL, captured_at timestamptz NOT NULL, UNIQUE (server, account_login, position_id)
      );
      CREATE TABLE trades (
        id text PRIMARY KEY, mt5_account_id text NOT NULL, mt5_server_canonical text NOT NULL, mt5_account_login bigint NOT NULL,
        mt5_position_id bigint NOT NULL, account_currency text, risk_amount numeric, risk_percent numeric, return_percent numeric,
        initial_plan_id text, initial_plan_metric_contract_version integer, updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE trade_legacy_metric_quarantine (
        id text PRIMARY KEY, trade_id text NOT NULL, original_risk_percent numeric, original_return_percent numeric,
        reason text NOT NULL, source_at timestamptz NOT NULL
      );
    `);
    await execute(`INSERT INTO mt5_accounts (id, canonical_server, account_login) VALUES ('account', 'fixture server', 7001)`);
  });

  afterEach(async () => {
    await database.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await database.end();
  });

  run('keeps dry-run classification identical to apply, quarantines mismatches, and converges idempotently', async () => {
    const plans = [validPlan('101'), validPlan('102'), validPlan('103'), unsupportedPlan('104')];
    await seedTrade('101');
    await seedTrade('102', 'partial');
    await seedTrade('103', 'full');
    await seedTrade('104');

    const dryRun = await runBackfill(plans);
    expect(dryRun).toMatchObject({ mode: 'dry-run', plans: 4, eligible: 3, unsupported: 1, alreadyProven: 0, conflict: 2, quarantined: 2, cleared: 2, createdPlans: 4 });
    expect((await database.query('SELECT count(*)::int AS count FROM mt5_position_entry_plans')).rows).toEqual([{ count: 0 }]);

    const applied = await runBackfill(plans, true);
    expect(applied).toEqual({ ...dryRun, mode: 'apply' });
    expect(await metricState('101')).toMatchObject({ risk_amount: '10.0000', risk_percent: '1.0000', return_percent: '2.0000', initial_plan_metric_contract_version: 1 });
    expect(await metricState('102')).toMatchObject({ risk_amount: '10.0000', risk_percent: '1.0000', return_percent: '2.0000', initial_plan_metric_contract_version: 1 });
    expect(await metricState('103')).toMatchObject({ risk_amount: '10.0000', risk_percent: '1.0000', return_percent: '2.0000', initial_plan_metric_contract_version: 1 });
    expect((await database.query(`
      SELECT t.mt5_position_id::text AS position_id, p.position_id AS plan_position_id
      FROM trades t
      JOIN mt5_position_entry_plans p ON p.id = t.initial_plan_id
      WHERE t.mt5_position_id IN (101, 102, 103)
      ORDER BY t.mt5_position_id
    `)).rows).toEqual([
      { position_id: '101', plan_position_id: '101' },
      { position_id: '102', plan_position_id: '102' },
      { position_id: '103', plan_position_id: '103' },
    ]);
    expect(await metricState('104')).toEqual({ risk_amount: null, risk_percent: null, return_percent: null, initial_plan_id: null, initial_plan_metric_contract_version: null });
    expect((await database.query(`SELECT reason FROM trade_legacy_metric_quarantine ORDER BY trade_id`)).rows).toEqual([
      { reason: 'partial_initial_plan_metric_state' },
      { reason: 'conflicting_initial_plan_metric_state' },
    ]);

    const rerun = await runBackfill(plans, true);
    expect(rerun).toMatchObject({ mode: 'apply', plans: 4, eligible: 0, unsupported: 1, alreadyProven: 3, conflict: 0, quarantined: 0, cleared: 0, createdPlans: 0 });
    expect((await database.query('SELECT count(*)::int AS count FROM trade_legacy_metric_quarantine')).rows).toEqual([{ count: 2 }]);
  });

  run('rolls back every prior write when a later immutable plan conflicts', async () => {
    await seedTrade('201');
    await execute(
      `INSERT INTO mt5_position_entry_plans (id, account_id, server, account_login, position_id, side, entry_at, entry_price, quantity_lots, take_profit_price, stop_loss_price, pre_entry_balance, account_currency, tick_size, tick_value_profit, tick_value_loss, metric_contract_version, captured_at)
       VALUES ('conflicting-plan', 'account', 'fixture server', 7001, '202', 'short', to_timestamp(1760000000000 / 1000.0), 100, 1, 120, 90, 1000, 'USD', 1, 1, 1, 1, CURRENT_TIMESTAMP)`,
    );

    await expect(runBackfill([validPlan('201'), validPlan('202')], true)).rejects.toMatchObject({ stderr: expect.stringContaining('immutable bridge entry plan conflicts for position 202') });
    expect((await database.query(`SELECT count(*)::int AS count FROM mt5_position_entry_plans WHERE position_id = '201'`)).rows).toEqual([{ count: 0 }]);
    expect(await metricState('201')).toEqual({ risk_amount: null, risk_percent: null, return_percent: null, initial_plan_id: null, initial_plan_metric_contract_version: null });
  });
  run('keeps fractional decimal boundary eligibility aligned with live projection through the backfill lifecycle', async () => {
    const plan: Plan = {
      ...validPlan('301'),
      entryPrice: '1.0000000000000000001',
      takeProfitPrice: '1.0000000000000000002',
      stopLossPrice: '1',
      tickSize: '0.0000000000000000001',
    };
    await seedTrade('301');

    const dryRun = await runBackfill([plan]);
    expect(dryRun).toMatchObject({ mode: 'dry-run', plans: 1, eligible: 1, unsupported: 0, alreadyProven: 0 });
    expect(await metricState('301')).toEqual({ risk_amount: null, risk_percent: null, return_percent: null, initial_plan_id: null, initial_plan_metric_contract_version: null });

    const applied = await runBackfill([plan], true);
    expect(applied).toEqual({ ...dryRun, mode: 'apply' });
    expect(await metricState('301')).toMatchObject({ risk_amount: '1.0000', risk_percent: '0.1000', return_percent: '0.1000', initial_plan_metric_contract_version: 1 });

    expect(await runBackfill([plan], true)).toMatchObject({ mode: 'apply', eligible: 0, unsupported: 0, alreadyProven: 1 });
  });
});
