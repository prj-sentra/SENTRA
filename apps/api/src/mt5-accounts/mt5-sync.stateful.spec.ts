import { Prisma } from '@prisma/client';
import { Mt5SyncService } from './mt5-sync.service';

const account = { id: 'account-1', ownerId: 'owner-1', active: true, server: 'Broker', canonicalServer: 'broker', accountLogin: 7n, credentialCiphertext: Buffer.from('x'), credentialIv: Buffer.alloc(12), credentialTag: Buffer.alloc(16), credentialVersion: 1 };
const deal = { ticket: '11', order: '10', positionId: '9', time: 1, timeMsc: 1000, type: 0, entry: 0, magic: '0', reason: 0, volume: 1, price: 2, commission: 0, swap: 0, profit: 0, fee: 0, symbol: 'XAUUSD', comment: '', externalId: '' };
const secondDeal = { ...deal, ticket: '21', order: '20', positionId: '19', timeMsc: 1500, symbol: 'EURUSD' };

function statefulDb() {
  const state = { lease: undefined as any, status: undefined as any, deals: [] as any[], orders: [] as any[], balances: [] as any[], balanceEvents: [] as any[], ledger: undefined as any, plans: [] as any[], trade: undefined as any, campaign: undefined as any, membership: undefined as any };
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
        balanceEvents: state.balanceEvents.map((row) => ({ ...row })),
        ledger: state.ledger ? { ...state.ledger } : undefined,
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
      findUnique: jest.fn(async () => state.status ?? null),
      upsert: jest.fn(async ({ create, update }: any) => { state.status = state.status ? { ...state.status, ...update } : create; }),
      updateMany: jest.fn(),
    },
    mt5Deal: {
      findUnique: jest.fn(async ({ where }: any) => state.deals.find((row) => row.ticket === where.server_accountLogin_ticket.ticket) ?? null),
      upsert: jest.fn(async ({ create }: any) => {
        const decimalFields = ['volume', 'price', 'commission', 'swap', 'profit', 'fee'];
        const normalized = { ...create };
        for (const field of decimalFields) normalized[field] = new Prisma.Decimal(create[field]);
        const existing = state.deals.find((row) => row.ticket === create.ticket);
        if (existing) Object.assign(existing, normalized);
        else state.deals.push(normalized);
        return normalized;
      }),
      findMany: jest.fn(async ({ where }: any) => state.deals.filter((row) => {
        const positionMatches = where.positionId === undefined
          ? true
          : typeof where.positionId === 'object' && Array.isArray(where.positionId.in)
            ? where.positionId.in.includes(row.positionId)
            : row.positionId === where.positionId;
        return (where.accountId === undefined || row.accountId === where.accountId)
          && positionMatches
          && (where.entry === undefined || row.entry === where.entry)
          && (where.type === undefined || where.type.in.includes(row.type));
      })),
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
      findMany: jest.fn(async ({ where }: any) => state.balances.filter((row) =>
        row.accountId === where.accountId
        && row.state === where.state
        && row.preEntryBalance !== null)),
      deleteMany: jest.fn(async () => { const count = state.balances.length; state.balances = []; return { count }; }),
      create: jest.fn(async ({ data }: any) => { state.balances.push({ ...data, preEntryBalance: data.preEntryBalance === null ? null : new Prisma.Decimal(data.preEntryBalance) }); }),
    },
    mt5AccountBalanceEvent: {
      deleteMany: jest.fn(async () => { const count = state.balanceEvents.length; state.balanceEvents = []; return { count }; }),
      createMany: jest.fn(async ({ data }: any) => { state.balanceEvents.push(...data); return { count: data.length }; }),
    },
    mt5AccountBalanceLedgerState: {
      upsert: jest.fn(async ({ create, update }: any) => {
        state.ledger = state.ledger ? { ...state.ledger, ...update } : create;
        return state.ledger;
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
      findMany: jest.fn(async () => []),
      findFirst: jest.fn(async () => null),
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

const deposit = { ...deal, ticket: '1', order: '0', positionId: '0', time: 0, timeMsc: 500, type: 2, symbol: '', volume: 0, price: 0, profit: 1000 };
const bridge = (batches: any[]) => ({
  sync: jest.fn(async (request: any) => ({
    contractVersion: 5,
    server: request.server,
    accountLogin: request.accountLogin,
    mode: request.mode,
    snapshotToMsc: request.snapshotToMsc,
    page: { hasMore: false, bytes: 100 },
    account: { currency: 'USD', currencyDigits: 2, currentBalance: '1000' },
    deals: [],
    orders: [],
    ...batches.shift(),
  })),
});
const cipher = { decrypt: jest.fn(() => 'secret') };

describe('Mt5SyncService account-scoped balance ledger', () => {
  it('reconstructs a verified ledger from zero and projects the position entry seed', async () => {
    const { db, state } = statefulDb();
    const upstream = bridge([{ deals: [deposit, deal] }]);
    const service = new Mt5SyncService(db, cipher as never, upstream as never);

    await expect(service.sync('owner-1', 'account-1')).resolves.toMatchObject({
      state: 'completed', importedCount: 1, receivedCount: 2,
    });

    expect(upstream.sync.mock.calls[0][0]).toMatchObject({ contractVersion: 5, mode: 'bootstrap' });
    expect(state.ledger).toMatchObject({
      accountId: 'account-1', currency: 'USD', status: 'VERIFIED', lastError: null,
    });
    expect(state.ledger.calculatedBalance.toString()).toBe('1000');
    expect(state.balanceEvents.map((event) => ({
      ticket: event.dealTicket.toString(),
      before: event.balanceBefore.toString(),
      delta: event.balanceDelta.toString(),
      after: event.balanceAfter.toString(),
    }))).toEqual([
      { ticket: '1', before: '0', delta: '1000', after: '1000' },
      { ticket: '11', before: '1000', delta: '0', after: '1000' },
    ]);
    expect(state.trade.seedBalance.toString()).toBe('1000');
    expect(state.trade.analysis.thesis).toBe('keep me');
  });


  it('projects the latest MT5 closing deal reason onto the trade and exit', async () => {
    const { db, state } = statefulDb();
    const closingDeal = {
      ...deal,
      ticket: '12',
      order: '12',
      entry: 1,
      type: 1,
      reason: 1,
      time: 2,
      timeMsc: 2000,
      price: 3,
      profit: 10,
    };
    const service = new Mt5SyncService(db, cipher as never, bridge([{ deals: [deposit, deal, closingDeal] }]) as never);

    await service.sync('owner-1', 'account-1');

    expect(state.trade.exitReason).toBe('manual');
    expect(state.trade.exit.create.reason).toBe('manual');
  });

  it('uses the successful snapshot overlap for incremental sync', async () => {
    const { db, state } = statefulDb();
    const upstream = bridge([
      { deals: [deposit, deal] },
      {},
    ]);
    const service = new Mt5SyncService(db, cipher as never, upstream as never);

    await service.sync('owner-1', 'account-1');
    await expect(service.sync('owner-1', 'account-1')).resolves.toMatchObject({
      state: 'completed', receivedCount: 0,
    });

    expect(state.deals).toHaveLength(2);
    expect(state.balanceEvents).toHaveLength(2);
    expect(state.trade.seedBalance.toString()).toBe('1000');
    expect(state.ledger).toMatchObject({ status: 'VERIFIED', historyFromMsc: 0n });
    expect(upstream.sync.mock.calls[1][0]).toMatchObject({ mode: 'incremental', changedSinceMsc: expect.any(Number) });
  });

  it('restores a missing trade seed from a verified full persisted ledger during incremental sync', async () => {
    const { db, state } = statefulDb();
    const service = new Mt5SyncService(db, cipher as never, bridge([
      { deals: [deposit, deal] },
      {},
    ]) as never);

    await service.sync('owner-1', 'account-1');
    state.trade.seedBalance = null;

    await expect(service.sync('owner-1', 'account-1')).resolves.toMatchObject({
      state: 'completed',
      balanceLedger: { status: 'verified' },
    });

    expect(state.trade.seedBalance.toString()).toBe('1000');
  });

  it('projects every persisted position after verified incremental reconstruction', async () => {
    const { db } = statefulDb();
    const projected: string[][] = [];
    const service = new Mt5SyncService(db, cipher as never, bridge([
      { deals: [deposit, deal, secondDeal] },
      {},
    ]) as never);
    const originalUpsert = db.trade.upsert;
    db.trade.upsert = jest.fn(async (args: any) => {
      projected.push([args.create.mt5PositionId.toString(), args.create.seedBalance.toString()]);
      return originalUpsert(args);
    });

    await service.sync('owner-1', 'account-1');
    projected.length = 0;
    await expect(service.sync('owner-1', 'account-1')).resolves.toMatchObject({
      state: 'completed',
      balanceLedger: { status: 'verified' },
    });

    expect(projected).toEqual(expect.arrayContaining([['9', '1000'], ['19', '1000']]));
  });

  it('persists a bootstrap cursor and releases its lease before resuming the same snapshot', async () => {
    const { db, state } = statefulDb();
    const upstream = bridge([
      { page: { hasMore: true, nextCursor: 'bootstrap-page-2', bytes: 100 }, deals: [deposit, deal] },
      {},
    ]);
    const service = new Mt5SyncService(db, cipher as never, upstream as never);

    const first = await service.sync('owner-1', 'account-1');

    expect(first).toMatchObject({ state: 'in_progress', progress: { mode: 'bootstrap', pageCursor: 'bootstrap-page-2' } });
    expect(state.status).toMatchObject({ mode: 'bootstrap', pageCursor: 'bootstrap-page-2' });
    expect(state.status.lastSuccessfulSnapshotMsc).toBeUndefined();
    expect(state.lease).toBeUndefined();
    expect(state.trade).toBeUndefined();

    const second = await service.sync('owner-1', 'account-1');

    expect(second).toMatchObject({ state: 'completed', importedCount: 1 });
    expect(upstream.sync.mock.calls[1][0]).toMatchObject({
      mode: 'bootstrap',
      pageCursor: 'bootstrap-page-2',
      snapshotToMsc: first.progress!.snapshotToMsc,
    });
    expect(state.status).toMatchObject({ mode: null, pageCursor: null, lastSuccessfulSnapshotMsc: BigInt(first.progress!.snapshotToMsc) });
    expect(state.trade).toBeDefined();
  });

  it('projects incremental earlier-page changes without advancing its watermark until the final page', async () => {
    const { db, state } = statefulDb();
    const priorWatermark = 1_700_000_000_000;
    state.status = {
      accountId: account.id, server: account.canonicalServer, accountLogin: account.accountLogin,
      lastSuccessfulSnapshotMsc: BigInt(priorWatermark), mode: null, snapshotToMsc: null, pageCursor: null, changedSinceMsc: null,
    };
    const upstream = bridge([
      { page: { hasMore: true, nextCursor: 'incremental-page-2', bytes: 100 }, deals: [deposit, deal] },
      {},
    ]);
    const service = new Mt5SyncService(db, cipher as never, upstream as never);

    const first = await service.sync('owner-1', 'account-1');

    expect(first).toMatchObject({ state: 'in_progress', progress: { mode: 'incremental', pageCursor: 'incremental-page-2' } });
    expect(state.trade).toBeDefined();
    expect(state.status.lastSuccessfulSnapshotMsc).toBe(BigInt(priorWatermark));
    expect(upstream.sync.mock.calls[0][0]).toMatchObject({
      mode: 'incremental',
      changedSinceMsc: priorWatermark - 72 * 60 * 60 * 1000,
    });

    await expect(service.sync('owner-1', 'account-1')).resolves.toMatchObject({ state: 'completed' });
    expect(state.status.lastSuccessfulSnapshotMsc).toBe(BigInt(first.progress!.snapshotToMsc));
  });

  it('records divergence and withholds every derived seed instead of guessing', async () => {
    const { db, state } = statefulDb();
    const service = new Mt5SyncService(db, cipher as never, bridge([
      { deals: [deposit, deal], account: { currency: 'USD', currencyDigits: 2, currentBalance: '999' } },
    ]) as never);

    await expect(service.sync('owner-1', 'account-1')).resolves.toMatchObject({ state: 'completed' });

    expect(state.ledger).toMatchObject({ status: 'DIVERGED', lastError: 'CALCULATED_BALANCE_MISMATCH' });
    expect(state.balances).toHaveLength(0);
    expect(state.trade.seedBalance).toBeNull();
  });

  it('preserves proven position and trade balances when a later account snapshot genuinely diverges', async () => {
    const { db, state } = statefulDb();
    const upstream = bridge([
      { deals: [deposit, deal] },
      { account: { currency: 'USD', currencyDigits: 2, currentBalance: '999' } },
    ]);
    const service = new Mt5SyncService(db, cipher as never, upstream as never);

    await expect(service.sync('owner-1', 'account-1')).resolves.toMatchObject({ state: 'completed' });
    const provenBalance = state.balances[0].preEntryBalance.toString();
    const tradeBalance = state.trade.seedBalance.toString();

    await expect(service.sync('owner-1', 'account-1')).resolves.toMatchObject({ state: 'completed' });

    expect(state.ledger).toMatchObject({ status: 'DIVERGED', lastError: 'CALCULATED_BALANCE_MISMATCH' });
    expect(state.balances[0]).toMatchObject({ state: 'PROVEN' });
    expect(state.balances[0].preEntryBalance.toString()).toBe(provenBalance);
    expect(state.trade.seedBalance.toString()).toBe(tradeBalance);
  });

  it('includes deposits, withdrawals, commissions, swap, fees, and realized profit in exact deal order', async () => {
    const { db, state } = statefulDb();
    const withdrawal = { ...deposit, ticket: '2', timeMsc: 600, profit: -100 };
    const close = { ...deal, ticket: '12', timeMsc: 2000, entry: 1, type: 1, commission: -2, swap: -1, profit: 30, fee: -1 };
    const service = new Mt5SyncService(db, cipher as never, bridge([
      { deals: [deposit, withdrawal, deal, close], account: { currency: 'USD', currencyDigits: 2, currentBalance: '926' } },
    ]) as never);

    await expect(service.sync('owner-1', 'account-1')).resolves.toMatchObject({ state: 'completed' });

    expect(state.ledger.status).toBe('VERIFIED');
    expect(state.ledger.calculatedBalance.toString()).toBe('926');
    expect(state.trade.seedBalance.toString()).toBe('900');
    expect(state.trade.realizedPnl).toBe(26);
    expect(state.balanceEvents.at(-1).balanceAfter.toString()).toBe('926');
  });
});
