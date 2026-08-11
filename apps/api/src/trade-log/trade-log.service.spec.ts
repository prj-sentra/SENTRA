import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { TradeLogService } from './trade-log.service';

const rawTrade = {
  id: 'trade-1', ownerId: 'owner-1', symbol: 'XAUUSD', side: 'LONG', status: 'PLANNED',
  strategy: null, thesis: null, entryRationale: null, exitRationale: null,
  takeProfitCriteria: null, stopLossCriteria: null, note: null, accountCurrency: null,
  quantityLots: null, entryPrice: null, exitPrice: null, exitReason: null, realizedPnl: null,
  takeProfitPrice: null, stopLossPrice: null, openedAt: null, closedAt: null,
  seedBalance: null, riskAmount: null, riskPercent: null, createdAt: new Date(), updatedAt: new Date(),
  entry: null, exit: null,
  analysis: { schemaVersion: 2, baseTimeframe: null, primaryTrend: null, bollingerBandCount: null,
    bollingerDirection: null, maTimeframes: {},
    marketZoneEnabled: false, marketZoneHigh: null, marketZoneLow: null,
    chartPatternObserved: false, chartPatternTimeframe: null, chartPatternType: null,
    retailPositionEnabled: false, retailBuyAveragePrice: null, retailSellAveragePrice: null,
    retailBuyRatio: null, fibonacciEnabled: false, fibonacciStartPrice: null,
    fibonacciEndPrice: null, economicIndicators: [], createdAt: new Date(), updatedAt: new Date() },
};

const prisma = () => ({
  trade: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
  mt5Account: { findFirst: jest.fn() },
});

describe('TradeLogService owner boundary', () => {
  it('always includes ownerId when loading a trade', async () => {
    const db = prisma(); db.trade.findFirst.mockResolvedValue(rawTrade);
    await expect(new TradeLogService(db as never).getTrade('owner-1', 'account-1', 'trade-1')).resolves.toMatchObject({ id: 'trade-1' });
    expect(db.trade.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'trade-1', ownerId: 'owner-1', mt5AccountId: 'account-1' } }));
  });

  it('hides a foreign trade as not found', async () => {
    const db = prisma(); db.trade.findFirst.mockResolvedValue(null);
    await expect(new TradeLogService(db as never).getTrade('owner-1', 'account-1', 'foreign')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects missing and foreign selected accounts', async () => {
    const db = prisma(); const service = new TradeLogService(db as never);
    await expect(service.getStats('owner-1')).rejects.toBeInstanceOf(BadRequestException);
    db.mt5Account.findFirst.mockResolvedValue(null);
    await expect(service.getStats('owner-1', 'foreign')).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.mt5Account.findFirst).toHaveBeenCalledWith({ where: { id: 'foreign', ownerId: 'owner-1' }, select: { id: true } });
  });
});
describe('TradeLogService campaign conflict pruning', () => {
  it('queries only unresolved conflicts whose candidate JSON contains the removed campaign', async () => {
    const db = prisma();
    const tx = {
      campaignConflict: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
    };
    const service = new TradeLogService(db as never);

    await (service as any).pruneCampaignConflictCandidates(tx, 'campaign-1');

    expect(tx.campaignConflict.findMany).toHaveBeenCalledWith({
      where: {
        status: 'UNRESOLVED',
        candidateCampaignIds: { array_contains: ['campaign-1'] },
      },
    });
    expect(tx.campaignConflict.update).not.toHaveBeenCalled();
  });
});
describe('TradeLogService historical MT5 campaign operations', () => {
  const trade = {
    ...rawTrade,
    mt5AccountId: 'inactive-account',
    mt5Server: 'Broker',
    mt5ServerCanonical: 'broker',
    mt5AccountLogin: 7n,
    openedAt: new Date('2026-08-01T00:00:00.000Z'),
  };

  function campaignDb() {
    const tx: any = {
      $queryRaw: jest.fn(async (query: any) => {
        const sql = query.strings?.join('') ?? '';
        return sql.includes('FROM mt5_accounts')
          ? [{ id: 'inactive-account', canonicalServer: 'broker', accountLogin: 7n, active: false, replacedById: 'replacement-account' }]
          : [];
      }),
      trade: { findFirst: jest.fn().mockResolvedValue(trade) },
      campaignMembership: {
        findUnique: jest.fn().mockResolvedValue({ tradeId: trade.id, campaignId: 'campaign-1', source: 'AUTO' }),
        upsert: jest.fn(),
        findMany: jest.fn().mockResolvedValue([{ tradeId: trade.id, trade: { id: trade.id, openedAt: trade.openedAt, mt5PositionId: 9n } }]),
      },
      tradeCampaign: {
        findFirst: jest.fn().mockResolvedValue({ id: 'campaign-1', ownerId: 'owner-1', mt5AccountId: trade.mt5AccountId }),
        findUnique: jest.fn().mockResolvedValue({ id: 'campaign-1', ownerId: 'owner-1', mt5AccountId: trade.mt5AccountId, rootTrade: trade }),
        update: jest.fn(),
      },
      campaignConflict: {
        findUnique: jest.fn().mockResolvedValue({ id: 'conflict-1', status: 'UNRESOLVED', tradeId: trade.id, candidateCampaignIds: ['campaign-1'] }),
        update: jest.fn(),
      },
    };
    return {
      tx,
      db: {
        trade: { findFirst: jest.fn().mockResolvedValue(trade) },
        campaignConflict: { findFirst: jest.fn().mockResolvedValue({ id: 'conflict-1', trade }) },
        $transaction: jest.fn(async (callback: any) => callback(tx)),
      },
    };
  }

  it('relinks an owned inactive/replaced account after shared locking while retaining account compatibility checks', async () => {
    const { db, tx } = campaignDb();
    const service = new TradeLogService(db as never);

    await expect(service.relinkCampaign('owner-1', { accountId: 'inactive-account', tradeId: trade.id, campaignId: 'campaign-1' })).resolves.toBeUndefined();
    expect(tx.$queryRaw.mock.calls[0][0].strings.join('')).toContain('FOR UPDATE');
    expect(tx.$queryRaw.mock.calls[1][0].strings.join('')).toContain('pg_advisory_xact_lock');
    expect(tx.campaignMembership.upsert).toHaveBeenCalled();
  });

  it('resolves an owned inactive/replaced account after shared locking and rejects incompatible campaign scope', async () => {
    const { db, tx } = campaignDb();
    const service = new TradeLogService(db as never);

    await expect(service.resolveCampaignConflict('owner-1', 'conflict-1', { accountId: 'inactive-account', campaignId: 'campaign-1' })).resolves.toBeUndefined();
    expect(tx.campaignConflict.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'conflict-1' } }));

    tx.tradeCampaign.findFirst.mockResolvedValueOnce({ id: 'campaign-1', ownerId: 'owner-1', mt5AccountId: 'other-account' });
    await expect(service.resolveCampaignConflict('owner-1', 'conflict-1', { accountId: 'inactive-account', campaignId: 'campaign-1' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
describe('TradeLogService analysis completion', () => {
  const completeAnalysis = () => ({
    ...rawTrade.analysis,
    baseTimeframe: 'H1',
    primaryTrend: 'UP',
    maTimeframes: Object.fromEntries(['15m', '30m', '1h', '4h', '1D', '1W', '1MN'].map((timeframe) => [timeframe, { arrangement: 'bullish', cross20_60: 'golden', cross20_120: 'golden' }])),
  });

  it('accepts complete technical analysis with a real cross and no Bollinger touch', () => {
    const service = new TradeLogService(prisma() as never);
    expect((service as any).campaignAnalysisComplete(completeAnalysis())).toBe(true);
    expect((service as any).campaignAnalysisComplete({ ...completeAnalysis(), maTimeframes: { ...completeAnalysis().maTimeframes, '1h': { arrangement: 'bullish', cross20_60: 'golden' } } })).toBe(false);
    expect((service as any).executionAnalysisComplete({ ...completeAnalysis(), bollingerDirection: 'NORMAL' })).toBe(false);
  });

  it('requires Bollinger direction only when a band was touched and enforces enabled conditional groups', () => {
    const service = new TradeLogService(prisma() as never);
    expect((service as any).executionAnalysisComplete({ ...completeAnalysis(), bollingerBandCount: 'ONE_BAND', bollingerDirection: null })).toBe(false);
    expect((service as any).campaignAnalysisComplete({ ...completeAnalysis(), marketZoneEnabled: true, marketZoneHigh: 110, marketZoneLow: null })).toBe(false);
    expect((service as any).campaignAnalysisComplete({ ...completeAnalysis(), retailPositionEnabled: true, retailBuyAveragePrice: 100, retailSellAveragePrice: null, retailBuyRatio: 50 })).toBe(false);
    expect((service as any).campaignAnalysisComplete({ ...completeAnalysis(), fibonacciEnabled: true, fibonacciStartPrice: 100, fibonacciEndPrice: null })).toBe(false);
  });

});
describe('TradeLogService initial-plan metric serialization', () => {
  const plannedMetricTrade = (overrides: Record<string, unknown> = {}) => ({
    ...rawTrade,
    mt5AccountId: 'account-1',
    status: 'CLOSED',
    openedAt: new Date('2026-08-10T10:00:00.000Z'),
    closedAt: new Date('2026-08-10T11:00:00.000Z'),
    entry: { price: 100, quantity: 1, occurredAt: new Date('2026-08-10T10:00:00.000Z'), note: null },
    exit: { price: 110, quantity: 1, occurredAt: new Date('2026-08-10T11:00:00.000Z'), reason: null, note: null },
    seedBalance: 1_000,
    riskAmount: 10,
    riskPercent: 1,
    returnPercent: 2,
    plannedTakeProfitPrice: 120,
    plannedStopLossPrice: 90,
    initialPlanId: 'plan-1',
    initialPlanMetricContractVersion: 1,
    initialPlan: { id: 'plan-1', metricContractVersion: 1, takeProfitPrice: 120, stopLossPrice: 90 },
    ...overrides,
  });

  it.each([
    ['legacy risk-only values', { returnPercent: null }],
    ['legacy return-only values', { riskAmount: null, riskPercent: null }],
    ['a missing initial-plan snapshot', { initialPlan: null }],
    ['a mismatched initial-plan version', { initialPlanMetricContractVersion: 2 }],
  ])('hides initial-plan metrics for %s', async (_, overrides) => {
    const db = prisma();
    db.trade.findFirst.mockResolvedValue(plannedMetricTrade(overrides));
    const result = await new TradeLogService(db as never).getTrade('owner-1', 'account-1', 'trade-1');

    expect(result).not.toEqual(expect.objectContaining({
      plannedTakeProfitPrice: expect.anything(),
      plannedStopLossPrice: expect.anything(),
      riskAmount: expect.anything(),
      riskPercent: expect.anything(),
      returnPercent: expect.anything(),
    }));
  });

  it('exposes user TP/SL and metrics only for a matching complete provenance pair', async () => {
    const db = prisma();
    db.trade.findFirst.mockResolvedValue(plannedMetricTrade());

    await expect(new TradeLogService(db as never).getTrade('owner-1', 'account-1', 'trade-1')).resolves.toMatchObject({
      plannedTakeProfitPrice: 120,
      plannedStopLossPrice: 90,
      riskAmount: 10,
      riskPercent: 1,
      returnPercent: 2,
      rr: 2,
    });
  });

  it('does not let an unproven risk value enter campaign or statistics aggregates', async () => {
    const unproven = plannedMetricTrade({ returnPercent: null });
    const service = new TradeLogService(prisma() as never);
    const campaign = (service as any).serializeCampaign({
      id: 'campaign-1', rootTradeId: unproven.id, mt5AccountId: 'account-1', tradingDate: new Date('2026-08-10T00:00:00.000Z'),
      updatedAt: new Date('2026-08-10T12:00:00.000Z'),
      analysis: { primaryTrend: null, maTimeframes: {}, marketZoneEnabled: false, marketZoneHigh: null, marketZoneLow: null, chartPatternObserved: false, chartPatternTimeframe: null, chartPatternType: null, retailPositionEnabled: false, retailBuyAveragePrice: null, retailSellAveragePrice: null, retailBuyRatio: null, fibonacciEnabled: false, fibonacciStartPrice: null, fibonacciEndPrice: null, economicIndicators: [], createdAt: new Date(), updatedAt: new Date() },
      rootTrade: unproven, memberships: [{ trade: unproven }], images: [], conflicts: [],
    });
    expect(campaign.seedBalance).toBeUndefined();
    expect(campaign.members[0].riskPercent).toBeUndefined();

    const db = prisma();
    db.mt5Account.findFirst.mockResolvedValue({ id: 'account-1' });
    db.trade.findMany.mockResolvedValue([unproven]);
    const stats = await new TradeLogService(db as never).getStats('owner-1', 'account-1');
    expect(stats.overview).toMatchObject({ totalRiskAmount: 0, riskAmountCount: 0, averageRiskPercent: 0, riskPercentCount: 0 });
  });
});
