import { Prisma } from '@prisma/client';
import { Mt5SyncService } from './mt5-sync.service';

const account = { id: 'account-1', ownerId: 'owner-1', active: true, canonicalServer: 'broker', accountLogin: 7n, credentialCiphertext: Buffer.from('x'), credentialIv: Buffer.alloc(12), credentialTag: Buffer.alloc(16), credentialVersion: 1 };
const deal = { ticket: '11', order: '10', positionId: '9', time: 1, timeMsc: 1000, type: 0, entry: 0, magic: '0', reason: 0, volume: 1, price: 2, commission: 0, swap: 0, profit: 0, fee: 0, symbol: 'XAUUSD', comment: '', externalId: '' };

function statefulDb() {
  const state = { lease: undefined as any, cursor: undefined as string | undefined, deals: [] as any[], orders: [] as any[], trade: undefined as any, campaign: undefined as any, membership: undefined as any };
  const db: any = {
    $queryRaw: jest.fn(), $transaction: jest.fn(async (value: any) => {
      if (typeof value !== 'function') return Promise.all(value);
      const before = structuredClone(state);
      try { return await value(db); } catch (error) { Object.assign(state, before); throw error; }
    }),
    mt5Account: { findFirst: jest.fn(async ({ where }: any) => where.ownerId === account.ownerId && account.active ? account : null) },
    mt5SyncLease: {
      deleteMany: jest.fn(async ({ where }: any) => {
        if (where.expiresAt && state.lease?.expiresAt > where.expiresAt.lte) return { count: 0 };
        if (state.lease && state.lease.accountId === where.accountId && (!where.leaseId || state.lease.leaseId === where.leaseId)) { state.lease = undefined; return { count: 1 }; }
        return { count: 0 };
      }),
      create: jest.fn(async ({ data }: any) => { if (state.lease) throw new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: 'test' }); state.lease = data; return data; }),
    },
    mt5SyncStatus: {
      findUnique: jest.fn(async () => state.cursor !== undefined ? { cursor: state.cursor } : null),
      upsert: jest.fn(async ({ create, update }: any) => { state.cursor = state.cursor !== undefined ? update.cursor : create.cursor; }),
      updateMany: jest.fn(),
    },
    mt5Deal: {
      upsert: jest.fn(async ({ create }: any) => { const existing = state.deals.find((row) => row.ticket === create.ticket); if (!existing) state.deals.push(create); return create; }),
      findMany: jest.fn(async ({ where }: any) => state.deals.filter((row) => row.positionId === where.positionId)),
    },
    mt5Order: {
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
    trade: { upsert: jest.fn(async ({ create, update }: any) => { state.trade = state.trade ? { ...state.trade, ...update, analysis: state.trade.analysis } : { id: 'trade-1', ...create, analysis: { thesis: 'keep me' } }; return state.trade; }) },
    tradeCampaign: { upsert: jest.fn(async ({ create }: any) => state.campaign ??= { id: 'campaign-1', ...create }) },
    campaignMembership: { upsert: jest.fn(async ({ create }: any) => state.membership ??= create) },
  };
  return { db, state };
}

const bridge = (batches: any[]) => ({ sync: jest.fn(async (_request: any) => batches.shift()) });
const cipher = { decrypt: jest.fn(() => 'secret') };

describe('Mt5SyncService stateful persistence boundary', () => {
  it('imports once, builds projection relations, preserves analysis, advances exact cursors including empty batches, and replays idempotently', async () => {
    const { db, state } = statefulDb();
    const upstream = bridge([
      { server: 'broker', accountLogin: 7, cursor: 'opaque:first', deals: [deal], orders: [] },
      { server: 'broker', accountLogin: 7, cursor: '', deals: [], orders: [] },
      { server: 'broker', accountLogin: 7, cursor: 'opaque:replay', deals: [deal], orders: [] },
    ]);
    const service = new Mt5SyncService(db, cipher as never, upstream as never);
    await expect(service.sync('owner-1', 'account-1')).resolves.toMatchObject({ state: 'completed', importedCount: 1, cursor: 'opaque:first' });
    expect(state.trade.analysis.thesis).toBe('keep me');
    expect(state.campaign.rootTradeId).toBe('trade-1');
    expect(state.membership).toMatchObject({ tradeId: 'trade-1', campaignId: 'campaign-1' });
    await expect(service.sync('owner-1', 'account-1')).resolves.toMatchObject({ cursor: '', receivedCount: 0 });
    await expect(service.sync('owner-1', 'account-1')).resolves.toMatchObject({ cursor: 'opaque:replay' });
    expect(state.deals).toHaveLength(1);
    expect(state.trade.analysis.thesis).toBe('keep me');
    expect(upstream.sync.mock.calls[1][0].cursor).toBe('opaque:first');
    expect(upstream.sync.mock.calls[2][0].cursor).toBe('');
  });

  it('projects the newest persisted non-zero TP and SL independently and keeps them stable on replay', async () => {
    const { db, state } = statefulDb();
    const older = { ticket: '20', positionId: '9', timeSetup: 1, timeSetupMsc: 1000, timeDone: 1, timeDoneMsc: 1000, type: 0, state: 0, reason: 0, volumeInitial: 1, volumeCurrent: 0, priceOpen: 2, sl: 1.5, tp: 3, priceCurrent: 2, priceStopLimit: 0, symbol: 'XAUUSD', comment: '', externalId: '' };
    const newer = { ...older, ticket: '21', timeSetupMsc: 2000, timeDoneMsc: 2000, sl: 0, tp: 4 };
    const upstream = bridge([
      { server: 'broker', accountLogin: 7, cursor: 'first', deals: [deal], orders: [older, newer] },
      { server: 'broker', accountLogin: 7, cursor: 'replay', deals: [deal], orders: [] },
    ]);
    const service = new Mt5SyncService(db, cipher as never, upstream as never);

    await service.sync('owner-1', 'account-1');
    expect(state.trade).toMatchObject({ takeProfitPrice: 4, stopLossPrice: 1.5 });
    state.trade.analysis = { thesis: 'authored' };

    await service.sync('owner-1', 'account-1');
    expect(state.trade).toMatchObject({ takeProfitPrice: 4, stopLossPrice: 1.5 });
    expect(state.trade.analysis).toEqual({ thesis: 'authored' });
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
      { server: 'broker', accountLogin: 7, cursor: 'must-not-commit', deals: [deal], orders: [] },
    ]) as never);
    await expect(service.sync('owner-1', 'account-1')).resolves.toMatchObject({ state: 'failed', message: 'Synchronization result expired' });
    expect(state.cursor).toBeUndefined();
    expect(state.deals).toHaveLength(0);
    expect(state.trade).toBeUndefined();
  });
});
