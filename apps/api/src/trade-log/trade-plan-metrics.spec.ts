import { Prisma, TradeSide } from '@prisma/client';
import { calculateExecutionBasedMetrics } from './trade-plan-metrics';

const decimal = (value: number | string) => new Prisma.Decimal(value);

describe('calculateExecutionBasedMetrics', () => {
  it('derives target metrics for a historical trade without an entry-plan snapshot', () => {
    const result = calculateExecutionBasedMetrics({
      side: TradeSide.LONG,
      entryPrice: decimal(4323.4),
      exitPrice: decimal(4346.67),
      realizedPnl: decimal(23.27),
      seedBalance: decimal(1000),
    }, decimal(4350), decimal(4310));

    expect(result).toEqual({
      riskAmount: decimal(13.4),
      riskPercent: decimal(1.34),
      returnPercent: decimal(2.66),
      rr: decimal(1.9851),
    });
  });

  it('rejects targets placed on the wrong sides of a short entry', () => {
    expect(calculateExecutionBasedMetrics({
      side: TradeSide.SHORT,
      entryPrice: decimal(100), exitPrice: decimal(90), realizedPnl: decimal(10), seedBalance: decimal(1000),
    }, decimal(110), decimal(90))).toBeNull();
  });
});
