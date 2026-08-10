import { Prisma, TradeSide } from '@prisma/client';

export const METRIC_CONTRACT_VERSION = 1;

export interface TradePlanMetricSource {
  side: TradeSide;
  entryPrice: Prisma.Decimal;
  quantityLots: Prisma.Decimal;
  preEntryBalance: Prisma.Decimal;
  tickSize: Prisma.Decimal;
  tickValueProfit: Prisma.Decimal;
  tickValueLoss: Prisma.Decimal;
  metricContractVersion: number;
}

export function calculateTradePlanMetrics(
  plan: TradePlanMetricSource,
  takeProfitPrice: Prisma.Decimal,
  stopLossPrice: Prisma.Decimal,
): { riskAmount: Prisma.Decimal; riskPercent: Prisma.Decimal; returnPercent: Prisma.Decimal; rr: Prisma.Decimal } | null {
  if (plan.metricContractVersion !== METRIC_CONTRACT_VERSION || plan.quantityLots.lte(0) || plan.preEntryBalance.lte(0)
    || plan.tickSize.lte(0) || plan.tickValueProfit.lte(0) || plan.tickValueLoss.lte(0)) return null;
  const long = plan.side === TradeSide.LONG;
  if ((long && (stopLossPrice.gte(plan.entryPrice) || takeProfitPrice.lte(plan.entryPrice)))
    || (!long && (stopLossPrice.lte(plan.entryPrice) || takeProfitPrice.gte(plan.entryPrice)))) return null;
  const riskAmount = plan.entryPrice.minus(stopLossPrice).abs().dividedBy(plan.tickSize).times(plan.tickValueLoss).times(plan.quantityLots);
  const returnAmount = takeProfitPrice.minus(plan.entryPrice).abs().dividedBy(plan.tickSize).times(plan.tickValueProfit).times(plan.quantityLots);
  if (!riskAmount.isFinite() || !returnAmount.isFinite() || riskAmount.lte(0)) return null;
  const round = (value: Prisma.Decimal) => value.toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
  return {
    riskAmount: round(riskAmount),
    riskPercent: round(riskAmount.dividedBy(plan.preEntryBalance).times(100)),
    returnPercent: round(returnAmount.dividedBy(plan.preEntryBalance).times(100)),
    rr: round(returnAmount.dividedBy(riskAmount)),
  };
}

export function calculateExecutionBasedMetrics(
  trade: {
    side: TradeSide;
    entryPrice: Prisma.Decimal | null;
    exitPrice: Prisma.Decimal | null;
    realizedPnl: Prisma.Decimal | null;
    seedBalance: Prisma.Decimal | null;
  },
  takeProfitPrice: Prisma.Decimal,
  stopLossPrice: Prisma.Decimal,
): { riskAmount: Prisma.Decimal; riskPercent: Prisma.Decimal; returnPercent: Prisma.Decimal; rr: Prisma.Decimal } | null {
  const { entryPrice, exitPrice, realizedPnl, seedBalance } = trade;
  if (!entryPrice || !exitPrice || !realizedPnl || !seedBalance || seedBalance.lte(0)) return null;
  const long = trade.side === TradeSide.LONG;
  if ((long && (stopLossPrice.gte(entryPrice) || takeProfitPrice.lte(entryPrice)))
    || (!long && (stopLossPrice.lte(entryPrice) || takeProfitPrice.gte(entryPrice)))) return null;
  const executionDistance = exitPrice.minus(entryPrice).abs();
  if (executionDistance.lte(0) || realizedPnl.isZero()) return null;
  const valuePerPriceUnit = realizedPnl.abs().dividedBy(executionDistance);
  const riskAmount = entryPrice.minus(stopLossPrice).abs().times(valuePerPriceUnit);
  const returnAmount = takeProfitPrice.minus(entryPrice).abs().times(valuePerPriceUnit);
  if (!riskAmount.isFinite() || !returnAmount.isFinite() || riskAmount.lte(0)) return null;
  const round = (value: Prisma.Decimal) => value.toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
  return {
    riskAmount: round(riskAmount),
    riskPercent: round(riskAmount.dividedBy(seedBalance).times(100)),
    returnPercent: round(returnAmount.dividedBy(seedBalance).times(100)),
    rr: round(returnAmount.dividedBy(riskAmount)),
  };
}
