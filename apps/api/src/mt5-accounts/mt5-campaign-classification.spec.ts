import { compareCampaignOpeningKey, Mt5SyncService } from './mt5-sync.service';

const emptyAnalysis = () => ({
  primaryTrend: null, maTimeframes: {}, marketZoneEnabled: false, retailPositionEnabled: false,
  fibonacciEnabled: false, entryReason: null, invalidationCondition: null, takeProfitCondition: null,
  additionalEntryPlan: null, tradeScore: null, strengths: null, weaknesses: null,
  economicIndicators: [], archives: [],
});

function fixture(rows: Array<{
  id: string; open: number; close?: number; campaign: string; source?: 'AUTO' | 'MANUAL'; headSource?: 'AUTO' | 'MANUAL'; authored?: boolean;
  ticket?: number; positionId?: number; side?: 'LONG' | 'SHORT'; symbol?: string;
}>) {
  const campaigns = new Map<string, any>();
  for (const row of rows) {
    if (!campaigns.has(row.campaign)) {
      campaigns.set(row.campaign, {
        id: row.campaign, memo: null, rootTrade: { id: row.id, openedAt: new Date(row.open), mt5PositionId: BigInt(row.positionId ?? row.open) },
        updatedAt: new Date(row.open),
        analysis: row.authored ? { id: `analysis-${row.campaign}`, ...emptyAnalysis(), entryReason: 'authored' } : { id: `analysis-${row.campaign}`, ...emptyAnalysis() }, images: [], conflicts: [],
      });
    }
  }
  const memberships = new Map(rows.map((row) => [row.id, { tradeId: row.id, campaignId: row.campaign, source: row.source ?? 'AUTO', headSource: row.headSource ?? 'AUTO', updatedAt: new Date(row.open) }]));
  const trades = rows.map((row) => ({
    id: row.id, openedAt: new Date(row.open), closedAt: row.close === undefined ? null : new Date(row.close),
    mt5PositionId: BigInt(row.positionId ?? row.open), symbol: row.symbol ?? 'EURUSD', side: row.side ?? 'LONG', updatedAt: new Date(row.open),
    get campaignMembership() { const membership = memberships.get(row.id); return membership ? { ...membership, campaign: campaigns.get(membership.campaignId)! } : null; },
  }));
  const deleted: string[] = [];
  const conflicts: string[] = [];
  const tx: any = {
    mt5Account: { findFirst: jest.fn(async () => ({ id: 'account' })) },
    trade: { findMany: jest.fn(async () => trades) },
    mt5Deal: { findMany: jest.fn(async () => trades.map((trade, index) => ({
      positionId: trade.mt5PositionId,
      timeMsc: BigInt(trade.openedAt.getTime()),
      ticket: BigInt(rows[index]!.ticket ?? index + 1),
    }))) },
    campaignMembership: {
      update: jest.fn(async ({ where, data }: any) => { memberships.get(where.tradeId)!.campaignId = data.campaignId; }),
      count: jest.fn(async ({ where }: any) => [...memberships.values()].filter((row) => row.campaignId === where.campaignId).length),
    },
    campaignConflict: { upsert: jest.fn(async ({ where }: any) => { conflicts.push(where.tradeId); }), findMany: jest.fn(async () => []), update: jest.fn() },
    tradeCampaignAnalysisArchive: { upsert: jest.fn() },
    tradeCampaignAnalysis: { create: jest.fn(), deleteMany: jest.fn() },
    tradeCampaignImage: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []), update: jest.fn() },
    tradeCampaign: {
      create: jest.fn(async ({ data }: any) => {
        const root = trades.find((trade) => trade.id === data.rootTradeId)!;
        const campaign = { id: `split-${data.rootTradeId}`, memo: null, rootTrade: { id: root.id, openedAt: root.openedAt, mt5PositionId: root.mt5PositionId }, updatedAt: root.updatedAt, analysis: { id: `analysis-split-${root.id}`, ...emptyAnalysis() }, images: [], conflicts: [] };
        campaigns.set(campaign.id, campaign);
        return campaign;
      }),
      update: jest.fn(),
      delete: jest.fn(async ({ where }: any) => { deleted.push(where.id); campaigns.delete(where.id); }),
    },
  };
  return { tx, memberships, deleted, conflicts };
}

describe('MT5 interval-overlap campaign classification', () => {
  const service = new Mt5SyncService({} as never, {} as never, {} as never);

  it('forms transitive interval components and keeps the earliest root campaign', async () => {
    const state = fixture([
      { id: 'a', open: 100, close: 200, campaign: 'ca' },
      { id: 'b', open: 150, close: 300, campaign: 'cb' },
      { id: 'c', open: 250, close: 350, campaign: 'cc' },
      { id: 'd', open: 351, close: 400, campaign: 'cd' },
    ]);
    await expect(service.reclassifyCampaigns(state.tx, 'owner', 'account')).resolves.toEqual({ moved: 2, deletedCampaigns: 2, conflicts: 0 });
    expect(state.memberships.get('a')!.campaignId).toBe('ca');
    expect(state.memberships.get('b')!.campaignId).toBe('ca');
    expect(state.memberships.get('c')!.campaignId).toBe('ca');
    expect(state.memberships.get('d')!.campaignId).toBe('cd');
  });

  it('treats touching endpoints and an open interval as overlapping', async () => {
    const state = fixture([
      { id: 'a', open: 100, close: 200, campaign: 'ca' },
      { id: 'b', open: 200, campaign: 'cb' },
      { id: 'c', open: 999, close: 1000, campaign: 'cc' },
    ]);
    await service.reclassifyCampaigns(state.tx, 'owner', 'account');
    expect([...state.memberships.values()].map((row) => row.campaignId)).toEqual(['ca', 'ca', 'ca']);
  });

  it('separates overlapping trades with opposite directions', async () => {
    const state = fixture([
      { id: 'long', open: 100, campaign: 'mixed', side: 'LONG' },
      { id: 'short', open: 200, close: 300, campaign: 'mixed', side: 'SHORT' },
    ]);
    await expect(service.reclassifyCampaigns(state.tx, 'owner', 'account')).resolves.toEqual({
      moved: 1, deletedCampaigns: 0, conflicts: 0,
    });
    expect(state.memberships.get('long')!.campaignId).toBe('mixed');
    expect(state.memberships.get('short')!.campaignId).toBe('split-short');
  });

  it('separates overlapping trades with different symbols', async () => {
    const state = fixture([
      { id: 'gold', open: 100, campaign: 'mixed', symbol: 'GOLD#', side: 'SHORT' },
      { id: 'nasdaq', open: 200, close: 300, campaign: 'mixed', symbol: 'US100Cash#', side: 'SHORT' },
    ]);
    await expect(service.reclassifyCampaigns(state.tx, 'owner', 'account')).resolves.toEqual({
      moved: 1, deletedCampaigns: 0, conflicts: 0,
    });
    expect(state.memberships.get('gold')!.campaignId).toBe('mixed');
    expect(state.memberships.get('nasdaq')!.campaignId).toBe('split-nasdaq');
  });

  it('previews a direction split without mutating campaign memberships', async () => {
    const state = fixture([
      { id: 'long', open: 100, campaign: 'mixed', side: 'LONG' },
      { id: 'short', open: 200, close: 300, campaign: 'mixed', side: 'SHORT' },
    ]);
    const previewService = new Mt5SyncService(state.tx, {} as never, {} as never);
    await expect(previewService.previewCampaignReclassification('owner', 'account')).resolves.toMatchObject({
      trades: 2,
      currentCampaigns: 1,
      proposedCampaigns: 2,
      movedTrades: 1,
      createdCampaigns: 1,
      mergedCampaigns: 0,
      hasChanges: true,
    });
    expect([...state.memberships.values()].map((membership) => membership.campaignId)).toEqual(['mixed', 'mixed']);
  });

  it('previews a symbol split without mutating campaign memberships', async () => {
    const state = fixture([
      { id: 'gold', open: 100, campaign: 'mixed', symbol: 'GOLD#', side: 'SHORT' },
      { id: 'nasdaq', open: 200, close: 300, campaign: 'mixed', symbol: 'US100Cash#', side: 'SHORT' },
    ]);
    const previewService = new Mt5SyncService(state.tx, {} as never, {} as never);
    await expect(previewService.previewCampaignReclassification('owner', 'account')).resolves.toMatchObject({
      trades: 2,
      currentCampaigns: 1,
      proposedCampaigns: 2,
      movedTrades: 1,
      createdCampaigns: 1,
      hasChanges: true,
    });
    expect([...state.memberships.values()].map((membership) => membership.campaignId)).toEqual(['mixed', 'mixed']);
  });

  it('never moves manual memberships and records an explicit conflict', async () => {
    const state = fixture([
      { id: 'a', open: 100, campaign: 'ca' },
      { id: 'b', open: 200, close: 300, campaign: 'cb', source: 'MANUAL' },
      { id: 'c', open: 250, close: 260, campaign: 'cc', source: 'MANUAL', authored: true },
    ]);
    await expect(service.reclassifyCampaigns(state.tx, 'owner', 'account')).resolves.toEqual({ moved: 0, deletedCampaigns: 0, conflicts: 2 });
    expect(state.conflicts).toEqual(['b', 'c']);
    expect([...state.memberships.values()].map((row) => row.campaignId)).toEqual(['ca', 'cb', 'cc']);
  });

  it('partitions an overlapping component at a manual head without movement or conflict', async () => {
    const state = fixture([
      { id: 'a', open: 100, close: 400, campaign: 'ca' },
      { id: 'b', open: 200, close: 300, campaign: 'ca' },
      { id: 'head', open: 250, close: 350, campaign: 'cb', headSource: 'MANUAL', source: 'MANUAL' },
      { id: 'later', open: 260, close: 360, campaign: 'cb' },
    ]);
    await expect(service.reclassifyCampaigns(state.tx, 'owner', 'account')).resolves.toEqual({ moved: 0, deletedCampaigns: 0, conflicts: 0 });
    expect([...state.memberships.values()].map((membership) => membership.campaignId)).toEqual(['ca', 'ca', 'cb', 'cb']);
  });

  it('protects authored automatic campaigns during sync but archives them during an explicit repair', async () => {
    const protectedState = fixture([
      { id: 'a', open: 100, campaign: 'ca' },
      { id: 'b', open: 200, close: 300, campaign: 'cb', authored: true },
    ]);
    await expect(service.reclassifyCampaigns(protectedState.tx, 'owner', 'account')).resolves.toEqual({
      moved: 0, deletedCampaigns: 0, conflicts: 1,
    });
    const repairState = fixture([
      { id: 'a', open: 100, campaign: 'ca' },
      { id: 'b', open: 200, close: 300, campaign: 'cb', authored: true },
    ]);
    await expect(service.reclassifyCampaigns(repairState.tx, 'owner', 'account', true)).resolves.toEqual({
      moved: 1, deletedCampaigns: 1, conflicts: 0,
    });
    expect(repairState.tx.tradeCampaignAnalysisArchive.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ source: 'campaign-merge:cb' }),
    }));
  });

  it('is idempotent after automatic memberships have converged', async () => {
    const state = fixture([
      { id: 'a', open: 100, campaign: 'ca' },
      { id: 'b', open: 200, close: 300, campaign: 'cb' },
    ]);
    await service.reclassifyCampaigns(state.tx, 'owner', 'account');
    await expect(service.reclassifyCampaigns(state.tx, 'owner', 'account')).resolves.toEqual({ moved: 0, deletedCampaigns: 0, conflicts: 0 });
  });

  it('orders equal opening times by opening ticket before position ID', () => {
    const rows = [
      { timeMsc: 100n, ticket: 20n, positionId: 1n },
      { timeMsc: 100n, ticket: 10n, positionId: 99n },
      { timeMsc: 100n, ticket: 10n, positionId: 98n },
    ].sort(compareCampaignOpeningKey);
    expect(rows.map((row) => [row.ticket, row.positionId])).toEqual([
      [10n, 98n], [10n, 99n], [20n, 1n],
    ]);
  });

  it('retains the campaign whose opening ticket is earliest when position order disagrees', async () => {
    const state = fixture([
      { id: 'ticket-first', open: 100, positionId: 99, ticket: 10, campaign: 'ticket-campaign' },
      { id: 'position-first', open: 100, positionId: 1, ticket: 20, campaign: 'position-campaign' },
    ]);
    await expect(service.reclassifyCampaigns(state.tx, 'owner', 'account')).resolves.toEqual({
      moved: 1, deletedCampaigns: 1, conflicts: 0,
    });
    expect([...state.memberships.values()].map((row) => row.campaignId)).toEqual([
      'ticket-campaign', 'ticket-campaign',
    ]);
  });
});
