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

const statsPreference = {
  breakevenPercent: { toString: () => '0.1', valueOf: () => 0.1 },
  timeZone: 'Asia/Seoul', tradingDayStartMinutes: 120,
  asiaStartMinutes: 540, asiaEndMinutes: 960, londonStartMinutes: 480, londonEndMinutes: 1020,
  newYorkStartMinutes: 480, newYorkEndMinutes: 1020,
};
const prisma = () => ({
  trade: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
  mt5Account: { findFirst: jest.fn() },
  statisticsPreference: { upsert: jest.fn().mockResolvedValue(statsPreference) },
  mt5PositionEntryBalance: { findMany: jest.fn().mockResolvedValue([]) },
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
    await expect(service.getStats('owner-1', {} as any)).rejects.toBeInstanceOf(BadRequestException);
    db.mt5Account.findFirst.mockResolvedValue(null);
    await expect(service.getStats('owner-1', { accountId: 'foreign' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.mt5Account.findFirst).toHaveBeenCalledWith({ where: { id: 'foreign', ownerId: 'owner-1' }, select: { id: true } });
  });
});
describe('TradeLogService calendar summaries', () => {
  it('groups campaign members and realized PnL by owner-scoped trading date', async () => {
    const db = {
      mt5Account: { findFirst: jest.fn().mockResolvedValue({ id: 'account-1' }) },
      $queryRaw: jest.fn().mockResolvedValue([
        { tradingDate: new Date('2026-08-03T00:00:00.000Z'), tradeCount: 3n, campaignCount: 2n, realizedPnl: 75 },
        { tradingDate: new Date('2026-08-05T00:00:00.000Z'), tradeCount: 1n, campaignCount: 1n, realizedPnl: 10.5 },
      ]),
      tradeCampaign: { findMany: jest.fn().mockResolvedValue([]) },
      trade: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const response = await new TradeLogService(db as never).listCampaigns('owner-1', undefined, 'account-1');

    expect(response.calendarDays).toEqual([
      { date: '2026-08-03', tradeCount: 3, campaignCount: 2, realizedPnl: 75 },
      { date: '2026-08-05', tradeCount: 1, campaignCount: 1, realizedPnl: 10.5 },
    ]);
    expect(response.date).toBe('2026-08-05');
    expect(db.$queryRaw).toHaveBeenCalledWith(expect.objectContaining({
      values: ['owner-1', 'account-1'],
    }));
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
    const stats = await new TradeLogService(db as never).getStats('owner-1', { accountId: 'account-1' });
    expect(stats.overview).toMatchObject({ totalRiskAmount: 0, riskAmountCount: 0, riskPercentCount: 0 });
  });
});
describe('TradeLogService statistics helpers', () => {
  const preferences = {
    breakevenPercent: 0.1, timeZone: 'Asia/Seoul', tradingDayStartMinutes: 120,
    sessions: { asia: { startMinutes: 0, endMinutes: 1439 }, london: { startMinutes: 0, endMinutes: 1439 }, 'new-york': { startMinutes: 0, endMinutes: 1439 } },
  };
  const record = (id: string, pnl: number, lots: number, openedAt: string, closedAt: string, seedBalance?: number) => ({
    id, accountId: 'account-1', symbol: 'XAUUSD', side: 'long', status: 'closed', analysisComplete: true,
    quantityLots: lots, realizedPnl: pnl, openedAt, closedAt, ...(seedBalance ? { seedBalance } : {}),
    analysis: { schemaVersion: 3, baseTimeframe: '1h', createdAt: openedAt, updatedAt: openedAt },
    createdAt: openedAt, updatedAt: closedAt,
  });
  it('aggregates campaign samples by PnL and lots while retaining trade mode', () => {
    const service = new TradeLogService(prisma() as never) as any;
    const records = [record('one', 20, 2, '2026-08-01T00:00:00.000Z', '2026-08-02T00:00:00.000Z', 1000), record('two', -10, 1, '2026-08-01T01:00:00.000Z', '2026-08-03T00:00:00.000Z', 1000)];
    const raw = records.map((trade) => ({ id: trade.id, campaignMembership: { campaignId: 'campaign-1' }, status: 'CLOSED', entry: {}, exit: {}, closedAt: new Date(trade.closedAt), realizedPnl: 1 }));
    const campaigns = service.statsSamples(raw, records, 'campaign', preferences);
    expect(campaigns).toMatchObject([{ id: 'campaign-1', type: 'campaign', realizedPnl: 10, lots: 3 }]);
    expect(service.statsSamples(raw, records, 'trade', preferences)).toHaveLength(2);
    expect(service.statsOverview(campaigns, 0.1).oneLotPnl).toBeCloseTo(10 / 3);
    expect(service.statsSamples([...raw, { id: 'open', campaignMembership: { campaignId: 'campaign-1' }, status: 'OPEN', entry: {}, exit: null, closedAt: null, realizedPnl: null }], records, 'campaign', preferences)).toEqual([]);
  });
  it('classifies inclusive breakeven, exposes missing seeds, overlapping sessions, prior comparison, user days, and drawdown', () => {
    const service = new TradeLogService(prisma() as never) as any;
    const classified = { id: 'a', realizedPnl: 1, seedBalance: 1000 };
    expect(service.statsOutcome(classified, 0.1)).toBe('breakeven');
    expect(service.statsOutcome({ id: 'missing', realizedPnl: 1 }, 0.1)).toBe('unclassified');
    expect(service.sessionMembership(new Date('2026-08-01T12:00:00.000Z'), preferences)).toEqual(['asia', 'london', 'new-york']);
    const samples = [
      { id: 'late', type: 'trade', trades: [record('late', -20, 1, '2026-08-02T00:00:00.000Z', '2026-08-02T01:00:00.000Z', 1010)], openedAt: '2026-08-02T00:00:00.000Z', closedAt: '2026-08-02T01:00:00.000Z', realizedPnl: -20, lots: 1, seedBalance: 1010, sessions: ['asia'] },
      { id: 'early', type: 'trade', trades: [record('early', 10, 1, '2026-08-01T00:00:00.000Z', '2026-08-01T01:00:00.000Z', 1000)], openedAt: '2026-08-01T00:00:00.000Z', closedAt: '2026-08-01T01:00:00.000Z', realizedPnl: 10, lots: 1, seedBalance: 1000, sessions: ['asia'] },
    ];
    expect(service.statsSeriesByGranularity(samples, preferences, { accountId: 'account-1' }).day.points.map((point: any) => point.equity)).toEqual([10, -10]);
    expect(service.priorStatsBounds({ from: '2026-08-02T00:00:00.000Z', to: '2026-08-03T00:00:00.000Z' })).toEqual({ from: '2026-07-31T23:59:59.999Z', to: '2026-08-01T23:59:59.999Z' });
    expect(service.priorStatsBounds({ from: '2026-08-02', to: '2026-08-03' })).toEqual({ from: '2026-07-31', to: '2026-08-01' });
    expect(service.statsDrawdown(samples.sort((a: any, b: any) => a.closedAt.localeCompare(b.closedAt)), [])).toMatchObject({ money: -20, percent: expect.closeTo(-20 / 1010 * 100) });
  });
  it('rejects unknown and invalid statistics preference fields', () => {
    const service = new TradeLogService(prisma() as never) as any;
    expect(() => service.validateStatsPreferences({ unknown: true })).toThrow(BadRequestException);
    expect(() => service.validateStatsPreferences({ sessions: { asia: { startMinutes: 1440 } } })).toThrow(BadRequestException);
  });
  it('normalizes scalar query selections and rejects invalid enums or reversed dates', () => {
    const service = new TradeLogService(prisma() as never) as any;
    expect(service.validateStatsQuery({ accountId: 'account-1', symbols: 'XAUUSD', sides: 'long' })).toMatchObject({ symbols: ['XAUUSD'], sides: ['long'] });
    expect(() => service.validateStatsQuery({ accountId: 'account-1', sides: 'flat' })).toThrow(BadRequestException);
    expect(() => service.validateStatsQuery({ accountId: 'account-1', from: '2026-08-02T00:00:00.000Z', to: '2026-08-01T00:00:00.000Z' })).toThrow(BadRequestException);
  });
});
describe('TradeLogService statistics preference display', () => {
  it('converts current market-local preference minutes to Seoul labels across DST and midnight', () => {
    const service = new TradeLogService(prisma() as never) as any;
    const preference = { ...statsPreference, londonStartMinutes: 8 * 60, londonEndMinutes: 17 * 60, newYorkStartMinutes: 8 * 60, newYorkEndMinutes: 17 * 60 };
    const winter = service.serializeStatsPreferences(preference, new Date('2026-01-15T12:00:00.000Z'));
    expect(winter.display.sessions.london.startLabel).toBe('17:00');
    expect(winter.display.sessions['new-york'].startLabel).toBe('22:00');
    const summer = service.serializeStatsPreferences(preference, new Date('2026-07-15T12:00:00.000Z'));
    expect(summer.display.sessions.london.startLabel).toBe('16:00');
    expect(summer.display.sessions['new-york'].startLabel).toBe('21:00');
    expect(summer.display.sessions['new-york'].endLabel).toBe('06:00');
  });
});
describe('TradeLogService expanded statistics', () => {
  it('uses canonical sequence order, classified expectancy, configured crosstab cells, and numeric distributions', () => {
    const service = new TradeLogService(prisma() as never) as any;
    const sample = (id: string, pnl: number, risk: number, closedAt: string, seedBalance = 1000) => ({ id, realizedPnl: pnl, riskAmount: risk, lots: 1, seedBalance, closedAt, openedAt: closedAt, sessions: [id === 'z' ? 'london' : 'asia'], trades: [{ id, symbol: id === 'a' ? 'XAUUSD' : 'EURUSD', side: 'long', strategy: 's', analysisComplete: true, analysis: { baseTimeframe: '1h' } }] });
    const samples = [sample('z', -10, 10, '2026-08-03T00:00:00.000Z'), sample('a', 10, 10, '2026-08-01T00:00:00.000Z'), sample('b', 20, 10, '2026-08-01T00:00:00.000Z'), { ...sample('unclassified', 900, 10, '2026-08-02T00:00:00.000Z'), seedBalance: undefined }];
    expect(service.statsOverview(samples, 0.1)).toMatchObject({ wins: 2, losses: 1, maxWinStreak: 2, currentLossStreak: 1, expectancy: 20 / 3, r: { total: 92, expectancy: 2 / 3 } });
    const crosstab = service.statsCrosstab(samples, 0.1, 'symbol', 'session', 'America/New_York');
    expect(crosstab.columns.map((column: any) => column.key)).toEqual(['asia', 'london']);
    expect(crosstab.rows).toHaveLength(2);
    expect(crosstab.rows.find((row: any) => row.key === 'XAUUSD').cells).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'london', count: 0, predicates: [{ dimension: 'symbol', key: 'XAUUSD' }, { dimension: 'session', key: 'london' }] })]));
    expect(service.statsDistributions(samples).map((item: any) => item.metric)).toEqual(['realizedPnl', 'oneLotPnl', 'r']);
  });
  it('returns all empty granular series with zero averages', () => {
    const series = (new TradeLogService(prisma() as never) as any).statsSeriesByGranularity([], { timeZone: 'Asia/Seoul', tradingDayStartMinutes: 120 }, { accountId: 'account-1' });
    expect(series).toEqual(expect.objectContaining({ day: expect.objectContaining({ points: [], activeBucketAverage: 0, calendarBucketAverage: 0 }), week: expect.any(Object), month: expect.any(Object), year: expect.any(Object) }));
  });
});
describe('TradeLogService stats range and risk coverage', () => {
  const preferences = { timeZone: 'Asia/Seoul', tradingDayStartMinutes: 120, breakevenPercent: 0.1 };
  it('fills zero calendar buckets while retaining active averages and finite histogram bounds', () => {
    const service = new TradeLogService(prisma() as never) as any;
    const samples = [
      { id: 'a', closedAt: '2026-08-10T03:00:00.000Z', realizedPnl: 30, lots: 1, riskAmount: 10, riskPercent: 1, seedBalance: 1000, trades: [], sessions: [] },
      { id: 'b', closedAt: '2026-08-12T03:00:00.000Z', realizedPnl: 30, lots: 1, riskAmount: 10, riskPercent: 2, seedBalance: 1000, trades: [], sessions: [] },
    ];
    const day = service.statsSeriesByGranularity(samples, preferences, { accountId: 'account-1', from: '2026-08-10', to: '2026-08-12' }).day;
    expect(day).toMatchObject({ activeBucketAverage: 30, calendarBucketAverage: 20 });
    expect(day.points.map((point: any) => point.count)).toEqual([1, 0, 1]);
    const bins = service.statsDistributions(samples)[0].bins;
    expect(bins[1]).toMatchObject({ min: -100, max: -10 });
    expect(bins[0]).not.toHaveProperty('min');
  });
  it('uses configured local trading-day keys for inclusive date-only endpoints and averages proven risk percentages', () => {
    const service = new TradeLogService(prisma() as never) as any;
    const base = { id: 'trade', realizedPnl: 1, seedBalance: 1000, lots: 1, riskAmount: 10, riskPercent: 1, trades: [], sessions: [] };
    expect(service.matchesStatsFilters({ ...base, closedAt: '2026-08-11T16:59:00.000Z' }, { accountId: 'account-1', to: '2026-08-11' }, preferences)).toBe(true);
    expect(service.matchesStatsFilters({ ...base, closedAt: '2026-08-11T17:00:00.000Z' }, { accountId: 'account-1', to: '2026-08-11' }, preferences)).toBe(false);
    expect(service.statsOverview([{ ...base, closedAt: '2026-08-11T00:00:00.000Z' }, { ...base, id: 'two', riskPercent: 3, closedAt: '2026-08-12T00:00:00.000Z' }], 0.1)).toMatchObject({ averageRiskPercent: 2, riskPercentCount: 2 });
  });
  it('assigns both repeated fall-back hours before the local start to the prior trading day', () => {
    const service = new TradeLogService(prisma() as never) as any;
    const newYork = { ...preferences, timeZone: 'America/New_York' };
    expect(service.statsPeriodKey('2026-11-01T05:30:00.000Z', newYork, 'day')).toBe('2026-10-31');
    expect(service.statsPeriodKey('2026-11-01T06:30:00.000Z', newYork, 'day')).toBe('2026-10-31');
    expect(service.statsPeriodKey('2026-11-01T07:00:00.000Z', newYork, 'day')).toBe('2026-11-01');
  });
  it('fills date-only ranges directly from local labels in extreme zones and computes changing-seed drawdown', () => {
    const service = new TradeLogService(prisma() as never) as any;
    expect(service.statsRangeKeys(
      { accountId: 'account-1', from: '2026-01-01', to: '2026-01-03' },
      { ...preferences, timeZone: 'Pacific/Kiritimati', tradingDayStartMinutes: 1380 },
      'day',
      [],
    )).toEqual(['2026-01-01', '2026-01-02', '2026-01-03']);
    const drawdown = service.statsDrawdown([
      { id: 'a', closedAt: '2026-01-01T00:00:00.000Z', realizedPnl: 100, seedBalance: 1000 },
      { id: 'b', closedAt: '2026-01-02T00:00:00.000Z', realizedPnl: -100, seedBalance: 1100 },
    ], []);
    expect(drawdown.percent).toBeCloseTo(-100 / 1100 * 100);
    expect(service.statsDrawdown([
      { id: 'deposit', closedAt: '2026-01-01T00:00:00.000Z', realizedPnl: 0, seedBalance: 1000 },
      { id: 'withdrawal', closedAt: '2026-01-02T00:00:00.000Z', realizedPnl: 0, seedBalance: 500 },
    ], []).percent).toBe(0);
    expect(service.statsDrawdown([
      { id: 'loss', closedAt: '2026-01-01T00:00:00.000Z', realizedPnl: -100, seedBalance: 1000 },
    ], []).percent).toBeCloseTo(-10);
  });
});
