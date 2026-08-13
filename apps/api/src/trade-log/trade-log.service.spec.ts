import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
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
  tradeCampaign: { findMany: jest.fn().mockResolvedValue([]) },
  campaignConflict: { findMany: jest.fn().mockResolvedValue([]) },
  mt5Account: { findFirst: jest.fn() },
  statisticsPreference: { upsert: jest.fn().mockResolvedValue(statsPreference) },
  mt5PositionEntryBalance: { findMany: jest.fn().mockResolvedValue([]) },
  $queryRaw: jest.fn(),
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

describe('TradeLogService journal date bucketing', () => {
  it('builds calendar and selection dates from completed campaign close time', async () => {
    const db = prisma();
    db.mt5Account.findFirst.mockResolvedValue({ id: 'account-1' });
    db.$queryRaw
      .mockResolvedValueOnce([{ tradingDate: new Date('2026-08-03T00:00:00.000Z'), tradeCount: 2n, campaignCount: 1n, realizedPnl: 10 }])
      .mockResolvedValueOnce([]);

    await expect(new TradeLogService(db as never).listCampaigns('owner-1', '2026-08-03', 'account-1')).resolves.toMatchObject({
      date: '2026-08-03',
      calendarDays: [{ date: '2026-08-03', tradeCount: 2, campaignCount: 1, realizedPnl: 10 }],
    });

    const calendarSql = db.$queryRaw.mock.calls[0][0].strings.join('');
    const selectionSql = db.$queryRaw.mock.calls[1][0].strings.join('');
    for (const sql of [calendarSql, selectionSql]) {
      expect(sql).toContain('BOOL_AND(t.closed_at IS NOT NULL)');
      expect(sql).toContain('MAX(t.closed_at)');
      expect(sql).toContain("AT TIME ZONE 'UTC' AT TIME ZONE ");
      expect(sql).toContain('make_interval(mins => ');
    }
    for (const query of db.$queryRaw.mock.calls.map(([value]) => value)) {
      expect(query.values).toEqual(expect.arrayContaining(['Asia/Seoul', 120]));
    }
    expect(db.tradeCampaign.findMany).not.toHaveBeenCalled();
  });

  it('assigns close times before the configured day start to the preceding journal date', () => {
    const service = new TradeLogService({} as never) as any;
    const preferences = { ...statsPreference, tradingDayStartMinutes: 360 };
    const campaign = (closedAt: string) => ({
      memberships: [{ trade: { openedAt: new Date('2026-08-13T00:00:00.000Z'), closedAt: new Date(closedAt) } }],
    });
    expect(service.campaignJournalDate(campaign('2026-08-13T20:59:59.999Z'), preferences)).toBe('2026-08-13');
    expect(service.campaignJournalDate(campaign('2026-08-13T21:00:00.000Z'), preferences)).toBe('2026-08-14');
  });
});

describe('TradeLogService campaign-head boundaries', () => {
  const opened = new Date('2026-08-01T00:00:00.000Z');
  const member = (tradeId: string, position: bigint, closedAt: Date | null = null, headSource: 'AUTO' | 'MANUAL' = 'AUTO') => ({
    tradeId, campaignId: 'campaign-1', source: 'AUTO', headSource,
    trade: { id: tradeId, openedAt: opened, closedAt, mt5PositionId: position },
  });

  it('orders equal executions by opening ticket and then position ID', async () => {
    const tx = {
      mt5Deal: { findMany: jest.fn().mockResolvedValue([
        { positionId: 9n, timeMsc: 1n, ticket: 10n },
        { positionId: 2n, timeMsc: 1n, ticket: 10n },
        { positionId: 1n, timeMsc: 1n, ticket: 20n },
      ]) },
    };
    const service = new TradeLogService({} as never);
    const ordered = await (service as any).orderMemberships(tx, 'account-1', [
      member('late-ticket', 1n), member('high-position', 9n), member('low-position', 2n),
    ]);
    expect(ordered.map((row: { tradeId: string }) => row.tradeId)).toEqual(['low-position', 'high-position', 'late-ticket']);
  });

  it('partitions a manual suffix into interval components without splitting touching or transitive intervals', () => {
    const service = new TradeLogService({} as never);
    const at = (milliseconds: number) => new Date(milliseconds);
    const rows = [
      { headSource: 'AUTO', trade: { openedAt: at(2), closedAt: at(4) } },
      { headSource: 'AUTO', trade: { openedAt: at(3), closedAt: at(3) } },
      { headSource: 'AUTO', trade: { openedAt: at(5), closedAt: at(6) } },
      { headSource: 'AUTO', trade: { openedAt: at(6), closedAt: null } },
    ];
    expect((service as any).partitionCampaignRange(rows).map((group: unknown[]) => group.length)).toEqual([2, 2]);
  });

  it('recomputes only the automatic component containing an unset head and stops at gaps or later manual heads', () => {
    const service = new TradeLogService({} as never);
    const at = (milliseconds: number) => new Date(milliseconds);
    const rows = [
      { headSource: 'AUTO', trade: { openedAt: at(1), closedAt: at(10) } },
      { headSource: 'AUTO', trade: { openedAt: at(2), closedAt: at(3) } },
      { headSource: 'AUTO', trade: { openedAt: at(5), closedAt: at(6) } },
      { headSource: 'AUTO', trade: { openedAt: at(7), closedAt: at(8) } },
      { headSource: 'MANUAL', trade: { openedAt: at(8), closedAt: at(20) } },
    ];
    expect((service as any).connectedAutomaticComponent(rows, 1)).toEqual(rows.slice(0, 4));
  });

  it('includes the preceding manual root as the bounded frontier without crossing an earlier manual boundary', () => {
    const service = new TradeLogService({} as never);
    const at = (milliseconds: number) => new Date(milliseconds);
    const rows = [
      { headSource: 'MANUAL', trade: { openedAt: at(1), closedAt: at(2) } },
      { headSource: 'MANUAL', trade: { openedAt: at(3), closedAt: at(20) } },
      { headSource: 'AUTO', trade: { openedAt: at(4), closedAt: at(5) } },
      { headSource: 'AUTO', trade: { openedAt: at(6), closedAt: at(7) } },
    ];
    expect((service as any).connectedAutomaticComponent(rows, 2)).toEqual(rows.slice(1));
  });

  it('normalizes campaign roots with persisted opening ticket before position ID', async () => {
    const openedAt = new Date('2026-08-01T00:00:00.000Z');
    const tx: any = {
      campaignMembership: { findMany: jest.fn().mockResolvedValue([
        { ...member('position-first', 1n), trade: { id: 'position-first', openedAt, mt5PositionId: 1n, mt5AccountId: 'account-1' } },
        { ...member('ticket-first', 99n), trade: { id: 'ticket-first', openedAt, mt5PositionId: 99n, mt5AccountId: 'account-1' } },
      ]) },
      mt5Deal: { findMany: jest.fn().mockResolvedValue([
        { positionId: 99n, timeMsc: 1n, ticket: 10n },
        { positionId: 1n, timeMsc: 1n, ticket: 20n },
      ]) },
      tradeCampaign: { findUnique: jest.fn().mockResolvedValue({ mt5AccountId: 'account-1' }), update: jest.fn(), delete: jest.fn() },
    };
    const service = new TradeLogService({} as never);
    await (service as any).normalizeCampaign(tx, 'campaign-1');
    expect(tx.tradeCampaign.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'campaign-1' }, data: expect.objectContaining({ rootTradeId: 'ticket-first' }),
    }));
  });

  it('orders serialized campaign members by persisted opening ticket before position ID', async () => {
    const openedAt = new Date('2026-08-01T00:00:00.000Z');
    const tx: any = {
      mt5Deal: { findMany: jest.fn().mockResolvedValue([
        { positionId: 99n, timeMsc: 1n, ticket: 10n },
        { positionId: 1n, timeMsc: 1n, ticket: 20n },
      ]) },
    };
    const service = new TradeLogService({} as never);
    const campaign: any = {
      mt5AccountId: 'account-1',
      memberships: [
        { ...member('position-first', 1n), trade: { id: 'position-first', openedAt, mt5PositionId: 1n } },
        { ...member('ticket-first', 99n), trade: { id: 'ticket-first', openedAt, mt5PositionId: 99n } },
      ],
    };
    const ordered = await (service as any).orderCampaignForSerialization(tx, campaign);
    expect(ordered.memberships.map((membership: { tradeId: string }) => membership.tradeId)).toEqual(['ticket-first', 'position-first']);
  });

  it('detects authored campaign analysis including review fields, while empty analysis is disposable', () => {
    const service = new TradeLogService({} as never);
    const empty = {
      primaryTrend: null, maTimeframes: {}, marketZoneEnabled: false, marketZoneHigh: null, marketZoneLow: null,
      retailPositionEnabled: false, retailBuyAveragePrice: null, retailSellAveragePrice: null, retailBuyRatio: null,
      fibonacciEnabled: false, fibonacciStartPrice: null, fibonacciEndPrice: null, entryReason: null,
      invalidationCondition: null, takeProfitCondition: null, additionalEntryPlan: null, tradeScore: null,
      strengths: null, weaknesses: null, economicIndicators: [],
    };
    expect((service as any).hasCampaignAnalysisContent(empty)).toBe(false);
    expect((service as any).hasCampaignAnalysisContent({ ...empty, strengths: 'kept review' })).toBe(true);
  });

  it('splits the selected and later members into a new manual-head campaign with empty analysis', async () => {
    const tx: any = {
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([{ id: 'account-1', canonicalServer: 'broker', accountLogin: 1n }])
        .mockResolvedValueOnce([]),
      tradeCampaign: {
        findFirst: jest.fn().mockResolvedValue({ id: 'campaign-1', ownerId: 'owner-1', mt5AccountId: 'account-1', version: 3 }),
        create: jest.fn().mockResolvedValue({ id: 'campaign-2' }),
        update: jest.fn(),
      },
      campaignMembership: { updateMany: jest.fn(), update: jest.fn() },
    };
    const db: any = {
      tradeCampaign: { findFirst: jest.fn().mockResolvedValue({ id: 'campaign-1', ownerId: 'owner-1', mt5AccountId: 'account-1' }) },
      $transaction: jest.fn((callback: any) => callback(tx)),
    };
    const service = new TradeLogService(db);
    jest.spyOn(service as any, 'lockCampaignRows').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'orderedCampaignMembers').mockResolvedValue([
      member('first', 1n), member('chosen', 2n), member('later', 3n),
    ]);
    jest.spyOn(service as any, 'normalizeCampaign').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'serializedCampaign').mockImplementation(async (...args: unknown[]) => ({ id: args[1] }));

    await expect(service.setCampaignHead('owner-1', 'account-1', 'campaign-1', { tradeId: 'chosen', campaignVersion: 3 })).resolves.toEqual({
      previousCampaign: { id: 'campaign-1' }, campaign: { id: 'campaign-2' },
    });
    expect(tx.tradeCampaign.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ rootTradeId: 'chosen', analysis: { create: {} } }),
    }));
    expect(tx.campaignMembership.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tradeId: { in: ['chosen', 'later'] } }, data: { campaignId: 'campaign-2', headSource: 'AUTO' },
    }));
    expect(tx.campaignMembership.update).toHaveBeenCalledWith({ where: { tradeId: 'chosen' }, data: { headSource: 'MANUAL', source: 'MANUAL' } });
  });

  it('rejects stale campaign versions before changing membership', async () => {
    const tx: any = {
      $queryRaw: jest.fn().mockResolvedValueOnce([{ id: 'account-1', canonicalServer: 'broker', accountLogin: 1n }]).mockResolvedValueOnce([]),
      tradeCampaign: { findFirst: jest.fn().mockResolvedValue({ id: 'campaign-1', ownerId: 'owner', mt5AccountId: 'account-1', version: 2 }) },
    };
    const db: any = {
      tradeCampaign: { findFirst: jest.fn().mockResolvedValue({ id: 'campaign-1', ownerId: 'owner', mt5AccountId: 'account-1' }) },
      $transaction: jest.fn((callback: any) => callback(tx)),
    };
    const service = new TradeLogService(db);
    jest.spyOn(service as any, 'lockCampaignRows').mockResolvedValue(undefined);
    await expect(service.setCampaignHead('owner', 'account-1', 'campaign-1', { tradeId: 'trade', campaignVersion: 1 })).rejects.toBeInstanceOf(ConflictException);
    expect(tx.campaignMembership).toBeUndefined();
  });

  it('rejects AUTO and account-first heads, and turns a gapped manual head back into AUTO', async () => {
    const tx: any = {
      $queryRaw: jest.fn((query: any) => Promise.resolve((query.strings?.join('') ?? '').includes('FROM mt5_accounts')
        ? [{ id: 'account-1', canonicalServer: 'broker', accountLogin: 1n }] : [])),
      tradeCampaign: { findFirst: jest.fn().mockResolvedValue({ id: 'campaign-1', ownerId: 'owner', mt5AccountId: 'account-1', version: 1 }), update: jest.fn() },
      campaignMembership: { update: jest.fn() },
    };
    const db: any = {
      tradeCampaign: { findFirst: jest.fn().mockResolvedValue({ id: 'campaign-1', ownerId: 'owner', mt5AccountId: 'account-1' }) },
      $transaction: jest.fn((callback: any) => callback(tx)),
    };
    const service = new TradeLogService(db);
    jest.spyOn(service as any, 'lockCampaignRows').mockResolvedValue(undefined);
    const orderedCampaign = jest.spyOn(service as any, 'orderedCampaignMembers');
    orderedCampaign.mockResolvedValueOnce([member('head', 2n, null, 'AUTO')]);
    await expect(service.unsetCampaignHead('owner', 'account-1', 'campaign-1', { campaignVersion: 1 })).rejects.toBeInstanceOf(BadRequestException);

    orderedCampaign.mockResolvedValueOnce([member('head', 2n, null, 'MANUAL')]);
    jest.spyOn(service as any, 'orderedAccountMembers').mockResolvedValue([member('head', 2n, null, 'MANUAL')]);
    await expect(service.unsetCampaignHead('owner', 'account-1', 'campaign-1', { campaignVersion: 1 })).rejects.toBeInstanceOf(BadRequestException);

    orderedCampaign.mockResolvedValueOnce([member('head', 2n, null, 'MANUAL')]);
    jest.spyOn(service as any, 'orderedAccountMembers').mockResolvedValue([
      { ...member('previous', 1n, new Date('2026-07-31T23:00:00.000Z')), campaignId: 'campaign-0' },
      member('head', 2n, null, 'MANUAL'),
    ]);
    orderedCampaign.mockResolvedValueOnce([{ ...member('previous', 1n, new Date('2026-07-31T23:00:00.000Z')), campaignId: 'campaign-0' }]);
    jest.spyOn(service as any, 'serializedCampaign').mockResolvedValue({ id: 'campaign-1' });
    await expect(service.unsetCampaignHead('owner', 'account-1', 'campaign-1', { campaignVersion: 1 })).resolves.toEqual({ campaign: { id: 'campaign-1' } });
    expect(tx.campaignMembership.update).toHaveBeenLastCalledWith({ where: { tradeId: 'head' }, data: { headSource: 'AUTO', source: 'AUTO' } });
    expect(tx.tradeCampaign.update).toHaveBeenCalledWith({ where: { id: 'campaign-1' }, data: { version: { increment: 1 } } });
  });

  it('preserves authored split content during a connected merge', async () => {
    let memo: string | null = 'preserve this';
    const tx: any = {
      $queryRaw: jest.fn((query: any) => Promise.resolve((query.strings?.join('') ?? '').includes('FROM mt5_accounts')
        ? [{ id: 'account-1', canonicalServer: 'broker', accountLogin: 1n }] : [])),
      tradeCampaign: {
        findFirst: jest.fn().mockResolvedValue({ id: 'campaign-2', ownerId: 'owner', mt5AccountId: 'account-1', version: 1 }),
        findUniqueOrThrow: jest.fn(() => ({ memo, images: [], conflicts: [], analysis: null })),
        delete: jest.fn(), update: jest.fn(),
      },
      campaignMembership: { update: jest.fn(), updateMany: jest.fn() },
    };
    const db: any = {
      tradeCampaign: { findFirst: jest.fn().mockResolvedValue({ id: 'campaign-2', ownerId: 'owner', mt5AccountId: 'account-1' }) },
      $transaction: jest.fn((callback: any) => callback(tx)),
    };
    const service = new TradeLogService(db);
    jest.spyOn(service as any, 'lockCampaignRows').mockResolvedValue(undefined);
    const preserve = jest.spyOn(service as any, 'preserveCampaignMerge').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'orderedCampaignMembers').mockImplementation(async (...args: unknown[]) => args[1] === 'campaign-2'
      ? [member('head', 2n, null, 'MANUAL')]
      : [{ ...member('previous', 1n, new Date('2026-08-02T00:00:00.000Z')), campaignId: 'campaign-1' }]);
    jest.spyOn(service as any, 'orderedAccountMembers').mockResolvedValue([
      { ...member('previous', 1n, new Date('2026-08-02T00:00:00.000Z')), campaignId: 'campaign-1' },
      { ...member('head', 2n, null, 'MANUAL'), campaignId: 'campaign-2' },
    ]);
    jest.spyOn(service as any, 'normalizeCampaign').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'serializedCampaign').mockResolvedValue({ id: 'campaign-1' });
    await expect(service.unsetCampaignHead('owner', 'account-1', 'campaign-2', { campaignVersion: 1 })).resolves.toEqual({
      previousCampaign: undefined, campaign: { id: 'campaign-1' },
    });
    expect(preserve).toHaveBeenCalledWith(tx, 'campaign-1', 'campaign-2');
    expect(tx.campaignMembership.updateMany).toHaveBeenCalledWith({ where: { tradeId: { in: ['previous', 'head'] } }, data: { campaignId: 'campaign-1', headSource: 'AUTO' } });
    expect(tx.tradeCampaign.delete).toHaveBeenCalledWith({ where: { id: 'campaign-2' } });
  });

  it('merges through an earlier predecessor interval that overlaps the manual head', async () => {
    const tx: any = {
      $queryRaw: jest.fn((query: any) => Promise.resolve((query.strings?.join('') ?? '').includes('FROM mt5_accounts')
        ? [{ id: 'account-1', canonicalServer: 'broker', accountLogin: 1n }] : [])),
      tradeCampaign: {
        findFirst: jest.fn().mockResolvedValue({ id: 'campaign-2', ownerId: 'owner', mt5AccountId: 'account-1', version: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ memo: null, images: [], conflicts: [], analysis: null }),
        delete: jest.fn(), update: jest.fn(),
      },
      campaignMembership: { update: jest.fn(), updateMany: jest.fn() },
    };
    const db: any = {
      tradeCampaign: { findFirst: jest.fn().mockResolvedValue({ id: 'campaign-2', ownerId: 'owner', mt5AccountId: 'account-1' }) },
      $transaction: jest.fn((callback: any) => callback(tx)),
    };
    const service = new TradeLogService(db);
    jest.spyOn(service as any, 'lockCampaignRows').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'preserveCampaignMerge').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'orderedCampaignMembers').mockImplementation(async (...args: unknown[]) => args[1] === 'campaign-2'
      ? [member('head', 3n, null, 'MANUAL')]
      : [
        { ...member('long-lived', 1n, new Date('2026-08-03T00:00:00.000Z')), campaignId: 'campaign-1' },
        { ...member('short-immediate', 2n, new Date('2026-08-01T01:00:00.000Z')), campaignId: 'campaign-1' },
      ]);
    jest.spyOn(service as any, 'orderedAccountMembers').mockResolvedValue([
      { ...member('long-lived', 1n, new Date('2026-08-03T00:00:00.000Z')), campaignId: 'campaign-1' },
      { ...member('short-immediate', 2n, new Date('2026-08-01T01:00:00.000Z')), campaignId: 'campaign-1' },
      { ...member('head', 3n, null, 'MANUAL'), campaignId: 'campaign-2' },
    ]);
    jest.spyOn(service as any, 'normalizeCampaign').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'serializedCampaign').mockResolvedValue({ id: 'campaign-1' });

    await expect(service.unsetCampaignHead('owner', 'account-1', 'campaign-2', { campaignVersion: 1 })).resolves.toEqual({
      previousCampaign: undefined, campaign: { id: 'campaign-1' },
    });
    expect(tx.tradeCampaign.delete).toHaveBeenCalledWith({ where: { id: 'campaign-2' } });
  });
});
describe('TradeLogService calendar summaries', () => {
  it('groups campaign members and realized PnL by owner-scoped trading date', async () => {
    const db = {
      mt5Account: { findFirst: jest.fn().mockResolvedValue({ id: 'account-1' }) },
      statisticsPreference: { upsert: jest.fn().mockResolvedValue(statsPreference) },
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
    expect(db.$queryRaw.mock.calls[0][0]).toEqual(expect.objectContaining({
      values: ['Asia/Seoul', 120, 'owner-1', 'account-1'],
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
      mt5Deal: { findMany: jest.fn().mockResolvedValue([]) },
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
  it('conserves trade excursion statuses and bins successful and stale metrics', () => {
    const service = new TradeLogService(prisma() as never) as any;
    const metric = { price: { mfe: { value: 4 }, mae: { value: -2 } }, percent: { mfe: { value: 2 }, mae: { value: -1 } }, unrealizedPnl: { mfe: { value: 10 }, mae: { value: -5 } }, captureRate: 50, rAvailability: 'available', r: { mfe: { value: 1 }, mae: { value: -.5 } } };
    const samples = [{ trades: [{ id: 'current', excursion: { scope: 'trade', status: 'success', metrics: metric } }, { id: 'stale', excursion: { scope: 'trade', status: 'stale', metrics: metric } }, { id: 'failed', excursion: { scope: 'trade', status: 'failed' } }, { id: 'unsupported', excursion: { scope: 'trade', status: 'unsupported' } }, { id: 'missing' }] }];
    const result = service.statsExcursions(samples, new Map(), 'trade');
    expect(result.families[0].status).toEqual({ success: 1, stale: 1, failed: 1, unsupported: 1, missing: 1 });
    expect(result.families[0].price.mfe.sampleCount).toBe(1);
    expect(result.families[0].price.mfe.bins.reduce((sum: number, bin: any) => sum + bin.count, 0)).toBe(1);
  });
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
  it('sums each entry PnL per Lot for campaign points while retaining trade mode', () => {
    const service = new TradeLogService(prisma() as never) as any;
    const records = [record('one', 20, 2, '2026-08-01T00:00:00.000Z', '2026-08-02T00:00:00.000Z', 1000), record('two', -10, 1, '2026-08-01T01:00:00.000Z', '2026-08-03T00:00:00.000Z', 1000)];
    const raw = records.map((trade) => ({ id: trade.id, campaignMembership: { campaignId: 'campaign-1' }, status: 'CLOSED', entry: {}, exit: {}, closedAt: new Date(trade.closedAt), realizedPnl: 1 }));
    const campaigns = service.statsSamples(raw, records, 'campaign', preferences);
    expect(campaigns).toMatchObject([{ id: 'campaign-1', type: 'campaign', realizedPnl: 10, lots: 3, oneLotPnl: 0 }]);
    expect(service.statsSamples(raw, records, 'trade', preferences)).toHaveLength(2);
    expect(service.statsOverview(campaigns, 0.1).oneLotPnl).toBe(0);
    expect(service.statsSeriesByGranularity(campaigns, preferences, { accountId: 'account-1' }).sequence.points[0].oneLotPnl).toBe(0);
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
    expect(service.statsSeriesByGranularity(samples, preferences, { accountId: 'account-1', unit: 'campaign' }).sequence.points[0]).toEqual(expect.objectContaining({
      timestamp: Date.parse('2026-08-01T01:00:00.000Z'),
      label: expect.stringContaining('1 ·'),
    }));
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
  it('uses canonical sequence order, classified expectancy, and configured crosstab cells', () => {
    const service = new TradeLogService(prisma() as never) as any;
    const sample = (id: string, pnl: number, risk: number, closedAt: string, seedBalance = 1000) => ({ id, realizedPnl: pnl, riskAmount: risk, lots: 1, seedBalance, closedAt, openedAt: closedAt, sessions: [id === 'z' ? 'london' : 'asia'], trades: [{ id, symbol: id === 'a' ? 'XAUUSD' : 'EURUSD', side: 'long', analysisComplete: true, analysis: { baseTimeframe: '1h' } }] });
    const samples = [{ ...sample('z', -10, 10, '2026-08-03T00:00:00.000Z'), lots: 2 }, sample('a', 10, 10, '2026-08-01T00:00:00.000Z'), sample('b', 20, 10, '2026-08-01T00:00:00.000Z'), { ...sample('unclassified', 900, 10, '2026-08-02T00:00:00.000Z'), seedBalance: undefined }];
    expect(service.statsOverview(samples, 0.1)).toMatchObject({ wins: 2, losses: 1, maxWinStreak: 2, currentLossStreak: 1, expectancy: 20 / 3, oneLotPnl: 231.25, r: { total: 92, expectancy: 2 / 3 } });
    expect(service.statsDimension(sample('weekday', 1, 1, '2026-08-03T00:00:00.000Z'), 'entryWeekday', 'Asia/Seoul')).toEqual(['월요일']);
    expect(service.statsDimension({ ...sample('long-hold', 1, 1, '2026-08-04T09:00:00.000Z'), openedAt: '2026-08-01T00:00:00.000Z' }, 'holdDuration')).toEqual(['72h+']);
    const crosstab = service.statsCrosstab(samples, 0.1, 'symbol', 'session', 'America/New_York');
    expect(crosstab.columns.map((column: any) => column.key)).toEqual(['asia', 'london']);
    expect(crosstab.rows).toHaveLength(2);
    expect(crosstab.rows.find((row: any) => row.key === 'XAUUSD').cells).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'london', count: 0, predicates: [{ dimension: 'symbol', key: 'XAUUSD' }, { dimension: 'session', key: 'london' }] })]));
  });
  it('returns all empty granular series with zero averages', () => {
    const series = (new TradeLogService(prisma() as never) as any).statsSeriesByGranularity([], { timeZone: 'Asia/Seoul', tradingDayStartMinutes: 120, breakevenPercent: 0.1 }, { accountId: 'account-1' });
    expect(series).toEqual(expect.objectContaining({ sequence: expect.objectContaining({ points: [] }), day: expect.objectContaining({ points: [], activeBucketAverage: 0, calendarBucketAverage: 0 }), week: expect.any(Object), month: expect.any(Object), year: expect.any(Object) }));
  });
  it('combines Bollinger touch count and direction into localized statistics keys', () => {
    const service = new TradeLogService(prisma() as never) as any;
    const sample = {
      openedAt: '2026-08-01T00:00:00.000Z',
      closedAt: '2026-08-01T01:00:00.000Z',
      sessions: ['asia'],
      trades: [
        { analysis: { bollingerBandCount: 'one_band', bollingerDirection: 'normal' } },
        { analysis: { bollingerBandCount: undefined, bollingerDirection: undefined } },
      ],
    };
    expect(service.statsDimension(sample, 'bollingerSetup')).toEqual(['one_band:normal', 'unevaluated']);
    expect(service.statsDimensionLabel('bollingerSetup', 'one_band:normal')).toBe('원볼 정볼');
    expect(service.statsDimensionLabel('bollingerSetup', 'two_band:chase')).toBe('투볼 추볼');
    expect(service.statsDimensionLabel('bollingerSetup', 'no_touch')).toBe('터치 안함');
    expect(['short', 'long'].sort((left, right) => service.statsDimensionCompare('side', left, right))).toEqual(['long', 'short']);
    expect(['일요일', '월요일', '금요일'].sort((left, right) => service.statsDimensionCompare('entryWeekday', left, right))).toEqual(['월요일', '금요일', '일요일']);
    expect(['off-session', 'new-york', 'asia', 'london'].sort((left, right) => service.statsDimensionCompare('session', left, right))).toEqual(['asia', 'london', 'new-york', 'off-session']);
    expect(['72h+', '<1h', '24-48h', '4-24h'].sort((left, right) => service.statsDimensionCompare('holdDuration', left, right))).toEqual(['<1h', '4-24h', '24-48h', '72h+']);
    expect(['XAUUSD', 'EURUSD', 'BTCUSD'].sort((left, right) => service.statsDimensionCompare('symbol', left, right))).toEqual(['BTCUSD', 'EURUSD', 'XAUUSD']);
  });
  it('excludes unevaluated filter options and preserves selected zero-result groups', () => {
    const service = new TradeLogService(prisma() as never) as any;
    const sample = {
      id: 'sample',
      openedAt: '2026-08-01T00:00:00.000Z',
      closedAt: '2026-08-01T01:00:00.000Z',
      realizedPnl: 10,
      lots: 1,
      sessions: ['asia'],
      trades: [{ symbol: 'BTCUSDT', side: 'long', analysisComplete: false, analysis: {} }],
    };
    expect(service.statsFilterOptions([sample], ['baseTimeframe', 'bollingerSetup'], 0.1, 'Asia/Seoul')).toEqual({
      baseTimeframe: [],
      bollingerSetup: [],
    });
    expect(service.statsPerformanceGroups([], ['symbol'], 0.1, 'Asia/Seoul', { symbols: ['BTCUSDT'] })).toEqual([
      expect.objectContaining({ key: 'BTCUSDT', labels: ['BTCUSDT'], count: 0, totalPnl: 0, averagePnl: 0, winRate: 0, averagePoint: 0 }),
    ]);
  });
});
describe('TradeLogService stats range and risk coverage', () => {
  const preferences = { timeZone: 'Asia/Seoul', tradingDayStartMinutes: 120, breakevenPercent: 0.1 };
  it('fills zero calendar buckets while retaining active averages and filtered cumulative one-lot PnL', () => {
    const service = new TradeLogService(prisma() as never) as any;
    const samples = [
      { id: 'a', closedAt: '2026-08-10T03:00:00.000Z', realizedPnl: 30, lots: 2, riskAmount: 10, riskPercent: 1, seedBalance: 1000, trades: [{ symbol: 'XAUUSD' }], sessions: [] },
      { id: 'excluded', closedAt: '2026-08-11T03:00:00.000Z', realizedPnl: 999, lots: 1, riskAmount: 10, riskPercent: 1, seedBalance: 1000, trades: [{ symbol: 'EURUSD' }], sessions: [] },
      { id: 'b', closedAt: '2026-08-12T03:00:00.000Z', realizedPnl: 30, lots: 3, riskAmount: 10, riskPercent: 2, seedBalance: 1000, trades: [{ symbol: 'XAUUSD' }], sessions: [] },
    ];
    const query = { accountId: 'account-1', from: '2026-08-10', to: '2026-08-12', symbols: ['XAUUSD'] };
    const filtered = samples.filter((sample) => service.matchesStatsFilters(sample, query, preferences));
    const day = service.statsSeriesByGranularity(filtered, preferences, query).day;
    expect(day).toMatchObject({ activeBucketAverage: 30, calendarBucketAverage: 20 });
    expect(day.points.map((point: any) => point.count)).toEqual([1, 0, 1]);
    expect(day.points.map((point: any) => point.oneLotPnl)).toEqual([15, 15, 25]);
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
  it('serializes only the literal persisted success DTO shape', () => {
    const service = new TradeLogService(prisma() as never) as any;
    const at = new Date('2026-08-12T00:00:00.000Z');
    const result = {
      status: 'SUCCESS', attemptCalculationVersion: 3, attemptInputFingerprint: 'input', lastAttemptedAt: at,
      successCalculationVersion: 3, successInputFingerprint: 'input', lastSucceededAt: at, rawFromMsc: 1n, rawToMsc: 2n,
      displayFromAt: at, displayToAt: at, tickSnapshotToMsc: 2n, priceSource: 'mt5_copy_ticks_range', pathDigest: 'path', tickCount: 2, valuationVersion: 1,
      valuationDigests: { accountCurrency: 'USD', digest: 'valuation' },
      mfePrice: 3, mfePriceMarkPrice: 1.103, mfePriceOccurredAt: at, maePrice: -2, maePriceMarkPrice: 1.098, maePriceOccurredAt: at,
      mfePercent: 3, mfePercentMarkPrice: 1.103, mfePercentOccurredAt: at, maePercent: -2, maePercentMarkPrice: 1.098, maePercentOccurredAt: at,
      mfeUnrealizedPnl: 30, mfeUnrealizedPnlOccurredAt: at, maeUnrealizedPnl: -20, maeUnrealizedPnlOccurredAt: at,
      mfeR: null, mfeROccurredAt: null, maeR: null, maeROccurredAt: null, captureRate: null,
    };
    expect(service.serializeExcursion(result)).toEqual({
      scope: 'trade', status: 'success',
      attempt: { calculationVersion: 3, inputFingerprint: 'input', attemptedAt: '2026-08-12T00:00:00.000Z' },
      success: { calculationVersion: 3, inputFingerprint: 'input', succeededAt: '2026-08-12T00:00:00.000Z', priceSource: 'mt5_copy_ticks_range', rawRange: { fromMsc: 1, toMsc: 2 }, displayRange: { fromAt: '2026-08-12T00:00:00.000Z', toAt: '2026-08-12T00:00:00.000Z' }, tickSnapshotToMsc: 2, pathDigest: 'path', tickCount: 2, valuationVersion: 1, valuationDigest: 'valuation', accountCurrency: 'USD' },
      metrics: { price: { mfe: { value: 3, occurredAt: '2026-08-12T00:00:00.000Z', markPrice: 1.103 }, mae: { value: -2, occurredAt: '2026-08-12T00:00:00.000Z', markPrice: 1.098 } }, percent: { mfe: { value: 3, occurredAt: '2026-08-12T00:00:00.000Z', markPrice: 1.103 }, mae: { value: -2, occurredAt: '2026-08-12T00:00:00.000Z', markPrice: 1.098 } }, unrealizedPnl: { mfe: { value: 30, occurredAt: '2026-08-12T00:00:00.000Z' }, mae: { value: -20, occurredAt: '2026-08-12T00:00:00.000Z' } }, rAvailability: 'risk_unavailable' },
    });
    expect(() => service.serializeExcursion({ ...result, lastSucceededAt: null })).toThrow('missing persisted provenance');
    expect(service.serializeExcursion({
      status: 'FAILED', attemptCalculationVersion: 4, attemptInputFingerprint: 'changed',
      lastAttemptedAt: at, failureReason: 'MEMBERSHIP_MUTATED',
    })).toEqual({
      scope: 'trade', status: 'failed',
      attempt: { calculationVersion: 4, inputFingerprint: 'changed', attemptedAt: '2026-08-12T00:00:00.000Z', failureReason: 'INPUT_CHANGED' },
    });
  });
  it('does not fail statistics when a legacy stale campaign family has no prior metrics', () => {
    const service = new TradeLogService(prisma() as never) as any;
    const result = service.serializeCampaignExcursion({
      attemptCalculationVersion: 1,
      attemptInputFingerprint: 'changed',
      lastAttemptedAt: new Date('2026-08-12T00:00:00.000Z'),
      priceFamilyStatus: 'STALE',
      priceFamilyReason: 'MEMBER_INPUT_MUTATED',
      pnlFamilyStatus: 'UNSUPPORTED',
      pnlFamilyReason: 'UNSUPPORTED_VALUATION',
    });
    expect(result.price).toEqual({
      family: 'campaign_price',
      status: 'failed',
      attempt: { calculationVersion: 1, inputFingerprint: 'changed', attemptedAt: '2026-08-12T00:00:00.000Z', failureReason: 'INPUT_CHANGED' },
    });
    expect(result.unrealizedPnl).toEqual({
      family: 'campaign_unrealized_pnl',
      status: 'unsupported',
      attempt: { calculationVersion: 1, inputFingerprint: 'changed', attemptedAt: '2026-08-12T00:00:00.000Z', failureReason: 'VALUATION_UNSUPPORTED' },
    });
  });
  it('uses only current successes and deterministic R-7 excursion distributions', () => {
    const service = new TradeLogService(prisma() as never) as any;
    const success = (value: number, status: 'success' | 'stale' = 'success') => ({ scope: 'trade', status, attempt: {}, success: {}, metrics: { price: { mfe: { value }, mae: { value: -value } }, percent: { mfe: { value }, mae: { value: -value } }, unrealizedPnl: { mfe: { value }, mae: { value: -value } }, rAvailability: 'risk_unavailable' } });
    const samples = [{ trades: [{ excursion: success(0) }, { excursion: success(10) }, { excursion: success(20) }, { excursion: success(30) }, { excursion: success(40) }, { excursion: success(50) }, { excursion: success(60) }, { excursion: success(70) }, { excursion: success(80) }, { excursion: success(90) }, { excursion: success(100) }, { excursion: success(999, 'stale') }] }];
    const family = service.statsExcursions(samples, new Map(), 'trade').families[0];
    expect(family).toMatchObject({ status: { success: 11, stale: 1, failed: 0, unsupported: 0, missing: 0 }, counts: { eligibleSuccessCount: 11 } });
    expect(family.price.mfe).toMatchObject({ sampleCount: 11, q1: 25, q3: 75 });
    expect(family.price.mfe.bins).toHaveLength(10);
    const constant = service.statsExcursions([{ trades: [{ excursion: success(1) }, { excursion: success(1) }] }], new Map(), 'trade').families[0].price.mfe;
    expect(constant.bins).toEqual([{ min: 1, max: 1, includeMax: true, count: 2 }]);
  });
});
