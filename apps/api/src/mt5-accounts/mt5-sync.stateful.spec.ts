import { Prisma } from '@prisma/client';
import { Mt5SyncService } from './mt5-sync.service';

const account = { id: 'account-1', ownerId: 'owner-1', active: true, server: 'Broker', canonicalServer: 'broker', accountLogin: 7n, credentialCiphertext: Buffer.from('x'), credentialIv: Buffer.alloc(12), credentialTag: Buffer.alloc(16), credentialVersion: 1 };
const deal = { ticket: '11', order: '10', positionId: '9', time: 1, timeMsc: 1000, type: 0, entry: 0, magic: '0', reason: 0, volume: 1, price: 2, commission: 0, swap: 0, profit: 0, fee: 0, symbol: 'XAUUSD', comment: '', externalId: '' };

function statefulDb() {
  const state = { lease: undefined as any, cursor: undefined as string | undefined, deals: [] as any[], orders: [] as any[], balances: [] as any[], plans: [] as any[], trade: undefined as any, campaign: undefined as any, membership: undefined as any };
  const db: any = {
    $queryRaw: jest.fn(async (query: any) => {
      const sql = query.strings?.join('') ?? '';
      if (sql.includes('canonical_server AS "canonicalServer"')) {
        return [{ id: account.id, canonicalServer: account.canonicalServer, accountLogin: account.accountLogin }];
      }
      return [];
    }),
    $transaction: jest.fn(async (value: any) => {
      if (typeof value !== 'function') return Promise.all(value);
      const before = {
        ...state,
        deals: state.deals.map((row) => ({ ...row })),
        orders: state.orders.map((row) => ({ ...row })),
        balances: state.balances.map((row) => ({ ...row })),
        plans: state.plans.map((row) => ({ ...row })),
        trade: state.trade ? { ...state.trade } : undefined,
        campaign: state.campaign ? { ...state.campaign } : undefined,
        membership: state.membership ? { ...state.membership } : undefined,
      };
      try { return await value(db); } catch (error) { Object.assign(state, before); throw error; }
    }),
    mt5Account: {
      findFirst: jest.fn(async ({ where }: any) => {
        if (where.id !== account.id || where.ownerId !== account.ownerId || (where.active === true && !account.active)) return null;
        if (where.canonicalServer && where.canonicalServer !== account.canonicalServer) return null;
        if (where.server && where.server !== account.server) return null;
        if (where.accountLogin && where.accountLogin !== account.accountLogin) return null;
        if (where.credentialVersion && where.credentialVersion !== account.credentialVersion) return null;
        return account;
      }),
    },
    mt5SyncLease: {
      deleteMany: jest.fn(async ({ where }: any) => {
        if (where.expiresAt && state.lease?.expiresAt > where.expiresAt.lte) return { count: 0 };
        if (state.lease && state.lease.accountId === where.accountId && (!where.leaseId || state.lease.leaseId === where.leaseId)) { state.lease = undefined; return { count: 1 }; }
        return { count: 0 };
      }),
      create: jest.fn(async ({ data }: any) => { if (state.lease) throw new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: 'test' }); state.lease = data; return data; }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        if (state.lease?.accountId === where.accountId && state.lease.leaseId === where.leaseId && state.lease.expiresAt > where.expiresAt.gt) {
          state.lease.expiresAt = data.expiresAt;
          return { count: 1 };
        }
        return { count: 0 };
      }),
    },
    mt5SyncStatus: {
      findUnique: jest.fn(async () => state.cursor !== undefined ? { cursor: state.cursor } : null),
      upsert: jest.fn(async ({ create, update }: any) => { state.cursor = state.cursor !== undefined ? update.cursor : create.cursor; }),
      updateMany: jest.fn(),
    },
    mt5Deal: {
      findUnique: jest.fn(async ({ where }: any) => state.deals.find((row) => row.ticket === where.server_accountLogin_ticket.ticket) ?? null),
      upsert: jest.fn(async ({ create }: any) => {
        const existing = state.deals.find((row) => row.ticket === create.ticket);
        if (existing) Object.assign(existing, create);
        else state.deals.push(create);
        return create;
      }),
      findMany: jest.fn(async ({ where }: any) => state.deals.filter((row) => where.positionId === undefined || row.positionId === where.positionId)),
    },
    mt5Order: {
      findUnique: jest.fn(async ({ where }: any) => state.orders.find((row) => row.ticket === where.server_accountLogin_ticket.ticket) ?? null),
      upsert: jest.fn(async ({ create }: any) => {
        const existing = state.orders.find((row) => row.ticket === create.ticket);
        if (existing) Object.assign(existing, create);
        else state.orders.push(create);
        return create;
      }),
      findMany: jest.fn(async ({ where }: any) => state.orders
        .filter((row) => row.positionId === where.positionId)
        .sort((a, b) => Number(b.timeSetupMsc - a.timeSetupMsc) || Number(b.ticket - a.ticket))),
    },
    mt5PositionEntryBalance: {
      findUnique: jest.fn(async ({ where }: any) => state.balances.find((row) => row.positionId === where.server_accountLogin_positionId.positionId) ?? null),
      create: jest.fn(async ({ data }: any) => { state.balances.push({ ...data, preEntryBalance: data.preEntryBalance === null ? null : new Prisma.Decimal(data.preEntryBalance) }); }),
      update: jest.fn(async ({ where, data }: any) => {
        const existing = state.balances.find((row) => row.positionId === where.server_accountLogin_positionId.positionId);
        if (existing) Object.assign(existing, data);
      }),
    },
    mt5PositionEntryPlan: {
      findUnique: jest.fn(async ({ where }: any) => state.plans.find((row) => row.positionId === where.server_accountLogin_positionId.positionId) ?? null),
      create: jest.fn(async ({ data }: any) => {
        const row = {
          id: `plan-${data.positionId}`,
          ...data,
          entryAt: new Date(data.entryAt),
          entryPrice: new Prisma.Decimal(data.entryPrice),
          quantityLots: new Prisma.Decimal(data.quantityLots),
          takeProfitPrice: new Prisma.Decimal(data.takeProfitPrice),
          stopLossPrice: new Prisma.Decimal(data.stopLossPrice),
          preEntryBalance: new Prisma.Decimal(data.preEntryBalance),
          tickSize: new Prisma.Decimal(data.tickSize),
          tickValueProfit: new Prisma.Decimal(data.tickValueProfit),
          tickValueLoss: new Prisma.Decimal(data.tickValueLoss),
        };
        state.plans.push(row);
        return row;
      }),
    },
    trade: {
      findUnique: jest.fn(async () => state.trade ?? null),
      upsert: jest.fn(async ({ create, update }: any) => {
        const normalize = (data: any) => data.seedBalance === undefined ? data : {
          ...data,
          seedBalance: data.seedBalance === null ? null : new Prisma.Decimal(data.seedBalance),
        };
        state.trade = state.trade
          ? { ...state.trade, ...normalize(update), analysis: state.trade.analysis }
          : { id: 'trade-1', ...normalize(create), analysis: { thesis: 'keep me' } };
        return state.trade;
      }),
    },
    tradeCampaign: { upsert: jest.fn(async ({ create }: any) => state.campaign ??= { id: 'campaign-1', ...create }) },
    campaignMembership: {
      findUnique: jest.fn(async ({ where }: any) => state.membership?.tradeId === where.tradeId ? state.membership : null),
      create: jest.fn(async ({ data }: any) => state.membership ??= data),
    },
  };
  return { db, state };
}

const bridge = (batches: any[]) => ({ sync: jest.fn(async (_request: any) => ({ contractVersion: 3, ledgerSemanticsVersion: 1, positionEntryPlans: [], unsupportedPositionEntryBalances: [], ...batches.shift() })) });
const cipher = { decrypt: jest.fn(() => 'secret') };
const plan = { positionId: '9', side: 'long', entryAt: 1000, entryPrice: '2', quantityLots: '1', takeProfitPrice: '3', stopLossPrice: '1.5', preEntryBalance: '1000', accountCurrency: 'USD', tickSize: '0.01', tickValueProfit: '1', tickValueLoss: '1' };
const proven = (balance = '1000') => ({ positionId: '9', entryDealTicket: '11', entryOrderTicket: '10', entryTimeMsc: 1000, preEntryBalance: balance, ledgerSemanticsVersion: 1 });

describe('Mt5SyncService stateful persistence boundary', () => {
  it('imports once, builds projection relations, preserves analysis, advances exact cursors including empty batches, and replays idempotently', async () => {
    const { db, state } = statefulDb();
    const upstream = bridge([
      { server: 'Broker', accountLogin: 7, cursor: 'opaque:first', deals: [deal], orders: [], positionEntryBalances: [proven('1000')] },
      { server: 'Broker', accountLogin: 7, cursor: '', deals: [], orders: [], positionEntryBalances: [proven('1000')] },
      { server: 'Broker', accountLogin: 7, cursor: 'opaque:replay', deals: [deal], orders: [], positionEntryBalances: [proven('1000')] },
    ]);
    const service = new Mt5SyncService(db, cipher as never, upstream as never);
    await expect(service.sync('owner-1', 'account-1')).resolves.toMatchObject({ state: 'completed', importedCount: 1, cursor: 'opaque:first' });
    expect(state.trade.analysis.thesis).toBe('keep me');
    expect(state.campaign.rootTradeId).toBe('trade-1');
    expect(state.membership).toMatchObject({ tradeId: 'trade-1', campaignId: 'campaign-1' });
    await expect(service.sync('owner-1', 'account-1')).resolves.toMatchObject({ cursor: '', receivedCount: 0, importedCount: 0 });
    expect(state.trade.seedBalance).toEqual(new Prisma.Decimal('1000'));
    await expect(service.sync('owner-1', 'account-1')).resolves.toMatchObject({ cursor: 'opaque:replay' });
    expect(state.deals).toHaveLength(1);
    expect(state.trade.analysis.thesis).toBe('keep me');
    expect(upstream.sync.mock.calls[1][0].cursor).toBe('opaque:first');
    expect(upstream.sync.mock.calls[2][0].cursor).toBe('');
  });
  it('preserves an existing manual membership during full-history replay without creating a campaign', async () => {
    const { db, state } = statefulDb();
    state.membership = { tradeId: 'trade-1', campaignId: 'manual-campaign', source: 'MANUAL' };
    const service = new Mt5SyncService(db, cipher as never, bridge([
      { server: 'Broker', accountLogin: 7, cursor: 'replay', deals: [deal], orders: [], positionEntryBalances: [proven('1000')] },
    ]) as never);

    await expect(service.sync('owner-1', 'account-1')).resolves.toMatchObject({ state: 'completed', importedCount: 1 });
    expect(state.membership).toEqual({ tradeId: 'trade-1', campaignId: 'manual-campaign', source: 'MANUAL' });
    expect(state.campaign).toBeUndefined();
    expect(db.tradeCampaign.upsert).not.toHaveBeenCalled();
    expect(db.campaignMembership.create).not.toHaveBeenCalled();
  });
  it('treats reordered MT5 fact JSON keys as an unchanged fact', async () => {
    const { db, state } = statefulDb();
    const reorderedDeal = Object.fromEntries(Object.entries(deal).reverse());
    const upstream = bridge([
      { server: 'Broker', accountLogin: 7, cursor: 'first', deals: [deal], orders: [], positionEntryBalances: [proven('1000')] },
      { server: 'Broker', accountLogin: 7, cursor: 'reordered', deals: [reorderedDeal], orders: [], positionEntryBalances: [proven('1000')] },
    ]);
    const service = new Mt5SyncService(db, cipher as never, upstream as never);

    await service.sync('owner-1', 'account-1');
    await expect(service.sync('owner-1', 'account-1')).resolves.toMatchObject({ importedCount: 0 });
    expect(db.mt5Deal.upsert).toHaveBeenCalledTimes(1);
    expect(state.deals).toHaveLength(1);
  });
  it('updates changed persisted deals and reprojects their position', async () => {
    const { db, state } = statefulDb();
    const changedDeal = { ...deal, profit: 12 };
    const service = new Mt5SyncService(db, cipher as never, bridge([
      { server: 'Broker', accountLogin: 7, cursor: 'first', deals: [deal], orders: [], positionEntryBalances: [proven('1000')] },
      { server: 'Broker', accountLogin: 7, cursor: 'changed', deals: [changedDeal], orders: [], positionEntryBalances: [proven('1000')] },
    ]) as never);

    await service.sync('owner-1', 'account-1');
    await expect(service.sync('owner-1', 'account-1')).resolves.toMatchObject({ importedCount: 1 });
    expect(state.deals[0].profit).toBe(12);
    expect(state.trade.realizedPnl).toBe(12);
    expect(db.mt5Deal.upsert).toHaveBeenCalledTimes(2);
  });
  it('recovers an all-null metric pair from a plan-only response using the persisted balance and freezes the HALF_UP result on replay', async () => {
    const { db, state } = statefulDb();
    const upstream = bridge([
      { server: 'Broker', accountLogin: 7, cursor: 'first', deals: [deal], orders: [], positionEntryBalances: [proven('1000')] },
      { server: 'Broker', accountLogin: 7, cursor: 'plan-only', deals: [], orders: [], positionEntryBalances: [proven('1000')], positionEntryPlans: [plan] },
      { server: 'Broker', accountLogin: 7, cursor: 'replay', deals: [], orders: [], positionEntryBalances: [proven('1000')], positionEntryPlans: [plan] },
    ]);
    const service = new Mt5SyncService(db, cipher as never, upstream as never);

    await service.sync('owner-1', 'account-1');
    await expect(service.sync('owner-1', 'account-1')).resolves.toMatchObject({ importedCount: 1 });
    expect(state.trade.riskAmount.toString()).toBe('50');
    expect(state.trade.riskPercent.toString()).toBe('5');
    expect(state.trade.returnPercent.toString()).toBe('10');
    expect(state.trade).toMatchObject({ initialPlanId: 'plan-9', initialPlanMetricContractVersion: 1 });

    await expect(service.sync('owner-1', 'account-1')).resolves.toMatchObject({ state: 'completed', importedCount: 1 });
    expect(state.trade.returnPercent.toString()).toBe('10');
  });
  it('rejects a changed bridge plan after immutable metrics are proven', async () => {
    const { db, state } = statefulDb();
    const service = new Mt5SyncService(db, cipher as never, bridge([
      { server: 'Broker', accountLogin: 7, cursor: 'first', deals: [deal], orders: [], positionEntryBalances: [proven('1000')], positionEntryPlans: [plan] },
      { server: 'Broker', accountLogin: 7, cursor: 'conflict', deals: [], orders: [], positionEntryBalances: [proven('1000')], positionEntryPlans: [{ ...plan, takeProfitPrice: '4' }] },
    ]) as never);

    await service.sync('owner-1', 'account-1');
    await expect(service.sync('owner-1', 'account-1')).resolves.toMatchObject({ state: 'failed' });
    expect(state.trade.initialPlanId).toBe('plan-9');
  });
  it('rejects an immutable proven-balance replay conflict without changing the seed', async () => {
    const { db, state } = statefulDb();
    const service = new Mt5SyncService(db, cipher as never, bridge([
      { server: 'Broker', accountLogin: 7, cursor: 'first', deals: [deal], orders: [], positionEntryBalances: [proven('1000')] },
      { server: 'Broker', accountLogin: 7, cursor: 'same', deals: [], orders: [], positionEntryBalances: [proven('1000')] },
      { server: 'Broker', accountLogin: 7, cursor: 'changed', deals: [], orders: [], positionEntryBalances: [proven('1250')] },
    ]) as never);
    await service.sync('owner-1', 'account-1');
    await expect(service.sync('owner-1', 'account-1')).resolves.toMatchObject({ importedCount: 0 });
    await expect(service.sync('owner-1', 'account-1')).resolves.toMatchObject({ state: 'failed' });
    expect(state.trade.seedBalance).toEqual(new Prisma.Decimal('1000'));
  });
  it('rejects missing execution balances before writing facts', async () => {
    const { db, state } = statefulDb();
    const service = new Mt5SyncService(db, cipher as never, bridge([
      { server: 'Broker', accountLogin: 7, cursor: 'missing', deals: [deal], orders: [], positionEntryBalances: [] },
    ]) as never);
    await expect(service.sync('owner-1', 'account-1')).resolves.toMatchObject({ state: 'failed' });
    expect(state.deals).toHaveLength(0);
  });

  it('projects the newest persisted non-zero TP and SL independently and keeps them stable on replay', async () => {
    const { db, state } = statefulDb();
    const older = { ticket: '20', positionId: '9', timeSetup: 1, timeSetupMsc: 1000, timeDone: 1, timeDoneMsc: 1000, type: 0, state: 0, reason: 0, volumeInitial: 1, volumeCurrent: 0, priceOpen: 2, sl: 1.5, tp: 3, priceCurrent: 2, priceStopLimit: 0, symbol: 'XAUUSD', comment: '', externalId: '' };
    const newer = { ...older, ticket: '21', timeSetupMsc: 2000, timeDoneMsc: 2000, sl: 0, tp: 4 };
    const upstream = bridge([
      { server: 'Broker', accountLogin: 7, cursor: 'first', deals: [deal], orders: [older, newer], positionEntryBalances: [proven('1000')] },
      { server: 'Broker', accountLogin: 7, cursor: 'order-only', deals: [], orders: [{ ...newer, ticket: '22', timeSetupMsc: 3000, timeDoneMsc: 3000, tp: 5 }], positionEntryBalances: [proven('1000')] },
    ]);
    const service = new Mt5SyncService(db, cipher as never, upstream as never);

    await service.sync('owner-1', 'account-1');
    expect(state.trade).toMatchObject({ takeProfitPrice: 4, stopLossPrice: 1.5 });
    state.trade.analysis = { thesis: 'authored' };

    await service.sync('owner-1', 'account-1');
    expect(state.trade).toMatchObject({ takeProfitPrice: 5, stopLossPrice: 1.5 });
    expect(state.trade.analysis).toEqual({ thesis: 'authored' });
  });
  it('does not count an unknown order-only position as an imported trade', async () => {
    const { db, state } = statefulDb();
    const order = { ticket: '30', positionId: '99', timeSetup: 1, timeSetupMsc: 1000, timeDone: 1, timeDoneMsc: 1000, type: 0, state: 0, reason: 0, volumeInitial: 1, volumeCurrent: 0, priceOpen: 2, sl: 1.5, tp: 3, priceCurrent: 2, priceStopLimit: 0, symbol: 'XAUUSD', comment: '', externalId: '' };
    const service = new Mt5SyncService(db, cipher as never, bridge([
      { server: 'Broker', accountLogin: 7, cursor: 'order-only', deals: [], orders: [order], positionEntryBalances: [] },
    ]) as never);

    await expect(service.sync('owner-1', 'account-1')).resolves.toMatchObject({ state: 'completed', importedCount: 0 });
    expect(state.trade).toBeUndefined();
  });

  it.each(['UNSUPPORTED_ACCOUNT_NOT_APPROVED', 'UNSUPPORTED_CHECKPOINT', 'UNSUPPORTED_INOUT'])('persists anchored %s and projects a seedless trade', async (reason) => {
    const { db, state } = statefulDb();
    const service = new Mt5SyncService(db, cipher as never, bridge([
      { server: 'Broker', accountLogin: 7, cursor: reason, deals: [deal], orders: [], positionEntryBalances: [], unsupportedPositionEntryBalances: [{ kind: 'ANCHORED', positionId: '9', entryDealTicket: '11', entryOrderTicket: '10', entryTimeMsc: 1000, reason, ledgerSemanticsVersion: 1 }] },
    ]) as never);
    await expect(service.sync('owner-1', 'account-1')).resolves.toMatchObject({ state: 'completed', importedCount: 1, cursor: reason });
    expect(state.trade.seedBalance).toBeNull();
    expect(state.balances[0]).toMatchObject({ state: 'UNSUPPORTED_ANCHORED', reason });
  });

  it('rejects an anchor whose deal is IN but not BUY or SELL', async () => {
    const { db, state } = statefulDb();
    const service = new Mt5SyncService(db, cipher as never, bridge([
      { server: 'Broker', accountLogin: 7, cursor: 'cash', deals: [{ ...deal, type: 2 }], orders: [], positionEntryBalances: [proven('1000')] },
    ]) as never);
    await expect(service.sync('owner-1', 'account-1')).resolves.toMatchObject({ state: 'failed' });
    expect(state.deals).toHaveLength(0);
  });
  it('persists a valid unanchored unsupported assertion without fabricating a trade', async () => {
    const { db, state } = statefulDb();
    const exitOnly = { ...deal, entry: 1 };
    const service = new Mt5SyncService(db, cipher as never, bridge([
      { server: 'Broker', accountLogin: 7, cursor: 'exit-only', deals: [exitOnly], orders: [], positionEntryBalances: [], unsupportedPositionEntryBalances: [{ kind: 'UNANCHORED', positionId: '9', reason: 'OPENING_DEAL_OUTSIDE_HISTORY', ledgerSemanticsVersion: 1 }] },
    ]) as never);
    await expect(service.sync('owner-1', 'account-1')).resolves.toMatchObject({ state: 'completed', importedCount: 0 });
    expect(state.trade).toBeUndefined();
    expect(state.balances[0]).toMatchObject({ state: 'UNSUPPORTED_UNANCHORED', reason: 'OPENING_DEAL_OUTSIDE_HISTORY', entryDealTicket: null });
  });
  it('rejects a duplicate live claim without calling upstream', async () => {
    const { db, state } = statefulDb(); state.lease = { accountId: 'account-1', leaseId: 'live', expiresAt: new Date(Date.now() + 60_000) };
    const upstream = bridge([]); const service = new Mt5SyncService(db, cipher as never, upstream as never);
    await expect(service.sync('owner-1', 'account-1')).resolves.toMatchObject({ state: 'in_progress' });
    expect(upstream.sync).not.toHaveBeenCalled();
  });
  it('rolls back facts and cursor when the claimed lease is reclaimed before fenced commit', async () => {
    const { db, state } = statefulDb();
    db.mt5Account.findFirst.mockResolvedValueOnce(account).mockResolvedValueOnce(null);
    const service = new Mt5SyncService(db, cipher as never, bridge([
      { server: 'Broker', accountLogin: 7, cursor: 'must-not-commit', deals: [deal], orders: [], positionEntryBalances: [proven('1000')] },
    ]) as never);
    await expect(service.sync('owner-1', 'account-1')).resolves.toMatchObject({ state: 'failed', message: 'Synchronization result expired' });
    expect(state.cursor).toBeUndefined();
    expect(state.deals).toHaveLength(0);
    expect(state.trade).toBeUndefined();
  });
  it('rejects an account deactivated after claim at the post-lock active fence without persisting sync output', async () => {
    const { db, state } = statefulDb();
    const upstream = { sync: jest.fn(async () => {
      account.active = false;
      return { server: 'Broker', accountLogin: 7, cursor: 'inactive', deals: [deal], orders: [], positionEntryBalances: [proven('1000')] };
    }) };
    const service = new Mt5SyncService(db, cipher as never, upstream as never);

    try {
      await expect(service.sync('owner-1', 'account-1')).resolves.toMatchObject({ state: 'failed', message: 'Synchronization result expired' });
      expect(state.deals).toHaveLength(0);
      expect(state.trade).toBeUndefined();
      expect(state.campaign).toBeUndefined();
      expect(state.membership).toBeUndefined();
      expect(state.cursor).toBeUndefined();
    } finally {
      account.active = true;
    }
  });
});
