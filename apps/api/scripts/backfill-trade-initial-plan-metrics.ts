import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Prisma } from '@prisma/client';
import { Client, type QueryResultRow } from 'pg';

const METRIC_CONTRACT_VERSION = 1;
const MAX_LIMIT = 500;
const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/;
const PLAN_FIELDS = {
  entry_price: 'entryPrice', quantity_lots: 'quantityLots', take_profit_price: 'takeProfitPrice',
  stop_loss_price: 'stopLossPrice', pre_entry_balance: 'preEntryBalance', tick_size: 'tickSize',
  tick_value_profit: 'tickValueProfit', tick_value_loss: 'tickValueLoss',
} as const;

type Plan = {
  positionId: string; side: 'long' | 'short'; entryAt: number; entryPrice: string; quantityLots: string;
  takeProfitPrice: string; stopLossPrice: string; preEntryBalance: string; accountCurrency: string;
  tickSize: string; tickValueProfit: string; tickValueLoss: string;
};
type BridgeEvidence = { server: string; accountLogin: number; positionEntryPlans: Plan[] };
type Counts = { eligible: number; unsupported: number; alreadyProven: number; conflict: number; quarantined: number; cleared: number; createdPlans: number };

function arg(name: string): string | undefined { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; }
function requireArg(name: string): string { const value = arg(name); if (!value) throw new Error(`${name} is required`); return value; }
function count(): Counts { return { eligible: 0, unsupported: 0, alreadyProven: 0, conflict: 0, quarantined: 0, cleared: 0, createdPlans: 0 }; }
function validPlan(value: unknown): value is Plan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Record<string, unknown>;
  return typeof plan.positionId === 'string' && /^(?:0|[1-9]\d*)$/.test(plan.positionId)
    && (plan.side === 'long' || plan.side === 'short') && typeof plan.entryAt === 'number' && Number.isSafeInteger(plan.entryAt) && plan.entryAt >= 0
    && typeof plan.accountCurrency === 'string' && Boolean(plan.accountCurrency.trim())
    && ['entryPrice', 'quantityLots', 'takeProfitPrice', 'stopLossPrice', 'preEntryBalance', 'tickSize', 'tickValueProfit', 'tickValueLoss'].every((field) => typeof plan[field] === 'string' && DECIMAL.test(plan[field] as string));
}
function readEvidence(path: string): BridgeEvidence {
  const evidence: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!evidence || typeof evidence !== 'object') throw new Error('bridge evidence must be an object');
  const response = evidence as Record<string, unknown>;
  if (typeof response.server !== 'string' || !response.server.trim() || !Number.isSafeInteger(response.accountLogin) || !Array.isArray(response.positionEntryPlans) || !response.positionEntryPlans.every(validPlan)) throw new Error('bridge evidence is not a validated bridge response');
  const ids = response.positionEntryPlans.map((plan) => plan.positionId);
  if (new Set(ids).size !== ids.length) throw new Error('bridge evidence contains duplicate plan position IDs');
  return response as BridgeEvidence;
}
function supported(plan: Plan): boolean {
  const entry = new Prisma.Decimal(plan.entryPrice);
  const takeProfit = new Prisma.Decimal(plan.takeProfitPrice);
  const stopLoss = new Prisma.Decimal(plan.stopLossPrice);
  return new Prisma.Decimal(plan.quantityLots).greaterThan(0)
    && new Prisma.Decimal(plan.preEntryBalance).greaterThan(0)
    && new Prisma.Decimal(plan.tickSize).greaterThan(0)
    && new Prisma.Decimal(plan.tickValueProfit).greaterThan(0)
    && new Prisma.Decimal(plan.tickValueLoss).greaterThan(0)
    && (plan.side === 'long'
      ? stopLoss.lessThan(entry) && takeProfit.greaterThan(entry)
      : stopLoss.greaterThan(entry) && takeProfit.lessThan(entry));
}
function metrics(plan: Plan): [string, string, string] {
  const decimal = (value: string) => new Prisma.Decimal(value);
  const riskAmount = decimal(plan.entryPrice).minus(decimal(plan.stopLossPrice)).abs()
    .dividedBy(decimal(plan.tickSize)).times(decimal(plan.tickValueLoss)).times(decimal(plan.quantityLots));
  const returnAmount = decimal(plan.takeProfitPrice).minus(decimal(plan.entryPrice)).abs()
    .dividedBy(decimal(plan.tickSize)).times(decimal(plan.tickValueProfit)).times(decimal(plan.quantityLots));
  const round = (value: Prisma.Decimal) => value.toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP).toFixed(4);
  return [round(riskAmount), round(riskAmount.dividedBy(decimal(plan.preEntryBalance)).times(100)), round(returnAmount.dividedBy(decimal(plan.preEntryBalance)).times(100))];
}
async function clearToQuarantine(client: Client, trade: QueryResultRow, reason: string, counts: Counts, apply: boolean): Promise<void> {
  counts.quarantined += 1; counts.cleared += 1;
  if (!apply) return;
  await client.query(`INSERT INTO trade_legacy_metric_quarantine (id, trade_id, original_risk_percent, original_return_percent, reason, source_at) VALUES ($1, $2, $3, $4, $5, $6)`, [randomUUID(), trade.id, trade.risk_percent, trade.return_percent, reason, trade.updated_at]);
  await client.query(`UPDATE trades SET risk_amount = NULL, risk_percent = NULL, return_percent = NULL, initial_plan_id = NULL, initial_plan_metric_contract_version = NULL WHERE id = $1`, [trade.id]);
}
async function processPlan(client: Client, accountId: string, server: string, login: number, plan: Plan, counts: Counts, apply: boolean): Promise<void> {
  const existing = await client.query(`SELECT * FROM mt5_position_entry_plans WHERE server = $1 AND account_login = $2 AND position_id = $3 FOR UPDATE`, [server, login, plan.positionId]);
  let planId: string;
  if (existing.rowCount) {
    const row = existing.rows[0];
    const same = row.account_id === accountId && row.side === plan.side && new Date(row.entry_at).getTime() === plan.entryAt
      && Object.entries(PLAN_FIELDS).every(([column, field]) => new Prisma.Decimal(row[column]).equals(plan[field]))
      && row.account_currency === plan.accountCurrency && row.metric_contract_version === METRIC_CONTRACT_VERSION;
    if (!same) throw new Error(`immutable bridge entry plan conflicts for position ${plan.positionId}`);
    planId = row.id;
  } else {
    planId = randomUUID(); counts.createdPlans += 1;
    if (apply) await client.query(`INSERT INTO mt5_position_entry_plans (id, account_id, server, account_login, position_id, side, entry_at, entry_price, quantity_lots, take_profit_price, stop_loss_price, pre_entry_balance, account_currency, tick_size, tick_value_profit, tick_value_loss, metric_contract_version, captured_at) VALUES ($1,$2,$3,$4,$5,$6,to_timestamp($7 / 1000.0),$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,CURRENT_TIMESTAMP)`, [planId, accountId, server, login, plan.positionId, plan.side, plan.entryAt, plan.entryPrice, plan.quantityLots, plan.takeProfitPrice, plan.stopLossPrice, plan.preEntryBalance, plan.accountCurrency, plan.tickSize, plan.tickValueProfit, plan.tickValueLoss, METRIC_CONTRACT_VERSION]);
  }
  const trades = await client.query(`SELECT id, risk_amount, risk_percent, return_percent, initial_plan_id, initial_plan_metric_contract_version, updated_at FROM trades WHERE mt5_account_id = $1 AND mt5_server_canonical = $2 AND mt5_account_login = $3 AND mt5_position_id = $4 FOR UPDATE`, [accountId, server, login, plan.positionId]);
  for (const trade of trades.rows) {
    const values = [trade.risk_amount, trade.risk_percent, trade.return_percent, trade.initial_plan_id, trade.initial_plan_metric_contract_version];
    let populated = values.filter((value) => value !== null).length;
    if (populated !== 0 && populated !== values.length) {
      counts.conflict += 1;
      await clearToQuarantine(client, trade, 'partial_initial_plan_metric_state', counts, apply);
      populated = 0;
    }
    if (!supported(plan)) {
      counts.unsupported += 1;
      if (populated) await clearToQuarantine(client, trade, 'unsupported_bridge_initial_plan', counts, apply);
      continue;
    }
    const [riskAmount, riskPercent, returnPercent] = metrics(plan);
    if (populated === values.length && trade.initial_plan_id === planId && trade.initial_plan_metric_contract_version === METRIC_CONTRACT_VERSION && new Prisma.Decimal(trade.risk_amount).equals(riskAmount) && new Prisma.Decimal(trade.risk_percent).equals(riskPercent) && new Prisma.Decimal(trade.return_percent).equals(returnPercent)) {
      counts.alreadyProven += 1;
      continue;
    }
    if (populated) {
      counts.conflict += 1;
      await clearToQuarantine(client, trade, 'conflicting_initial_plan_metric_state', counts, apply);
    }
    counts.eligible += 1;
    if (apply) await client.query(`UPDATE trades SET account_currency=$2, risk_amount=$3, risk_percent=$4, return_percent=$5, initial_plan_id=$6, initial_plan_metric_contract_version=$7 WHERE id=$1`, [trade.id, plan.accountCurrency, riskAmount, riskPercent, returnPercent, planId, METRIC_CONTRACT_VERSION]);
  }
}
async function main(): Promise<void> {
  const connectionString = process.env.BACKFILL_DATABASE_URL;
  if (!connectionString) throw new Error('BACKFILL_DATABASE_URL is required');
  const apply = process.argv.includes('--apply');
  if (apply && !process.argv.includes('--confirm-backfill-trade-initial-plan-metrics')) throw new Error('apply requires --confirm-backfill-trade-initial-plan-metrics');
  const limit = Number(arg('--limit') ?? 100);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new Error(`--limit must be an integer from 1 to ${MAX_LIMIT}`);
  const evidence = readEvidence(requireArg('--bridge-response'));
  if (evidence.positionEntryPlans.length > limit) throw new Error(`bridge evidence exceeds --limit (${limit})`);
  const client = new Client({ connectionString }); await client.connect();
  try {
    await client.query('BEGIN');
    const accounts = await client.query(`SELECT id, canonical_server, account_login FROM mt5_accounts WHERE canonical_server = lower($1) AND account_login = $2 FOR UPDATE`, [evidence.server, evidence.accountLogin]);
    if (accounts.rowCount !== 1) throw new Error('bridge identity must match exactly one configured MT5 account');
    const account = accounts.rows[0]; const counts = count();
    for (const plan of evidence.positionEntryPlans) await processPlan(client, account.id, account.canonical_server, evidence.accountLogin, plan, counts, apply);
    if (apply) await client.query('COMMIT'); else await client.query('ROLLBACK');
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', plans: evidence.positionEntryPlans.length, ...counts }));
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { await client.end(); }
}

if (require.main === module) void main();
