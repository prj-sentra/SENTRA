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
      upsert: jest.fn(async ({ create, update }: any) => {
        state.status = state.status ? { ...state.status, ...update } : create;
        return state.status;
      }),
      update: jest.fn(async ({ data }: any) => {
        state.status = { ...state.status, ...data };
        return state.status;
      }),
      updateMany: jest.fn(async ({ data }: any) => {
        if (!state.status) return { count: 0 };
        state.status = { ...state.status, ...data };
        return { count: 1 };
      }),
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
      update: jest.fn(async ({ where, data }: any) => {
        const row = state.deals.find((item) => item.ticket === where.server_accountLogin_ticket.ticket);
        Object.assign(row, data);
        return row;
      }),
      deleteMany: jest.fn(async ({ where }: any) => {
        const retained = state.deals.filter((row) => row.accountId !== where.accountId || row.fetchedAt >= where.fetchedAt.lt);
        const count = state.deals.length - retained.length;
        state.deals = retained;
        return { count };
      }),
      findMany: jest.fn(async ({ where }: any) => state.deals.filter((row) => {
        const positionMatches = where.positionId === undefined
          ? true
          : typeof where.positionId === 'object' && Array.isArray(where.positionId.in)
            ? where.positionId.in.includes(row.positionId)
            : typeof where.positionId === 'object' && where.positionId.gt !== undefined
              ? row.positionId > where.positionId.gt
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
      update: jest.fn(async ({ where, data }: any) => {
        const row = state.orders.find((item) => item.ticket === where.server_accountLogin_ticket.ticket);
        Object.assign(row, data);
        return row;
      }),
      deleteMany: jest.fn(async ({ where }: any) => {
        const retained = state.orders.filter((row) => row.accountId !== where.accountId || row.fetchedAt >= where.fetchedAt.lt);
        const count = state.orders.length - retained.length;
        state.orders = retained;
        return { count };
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
      updateMany: jest.fn(async () => ({ count: 0 })),
    },
    tradeCampaign: {
      findMany: jest.fn(async () => []),
      upsert: jest.fn(async ({ create }: any) => state.campaign ??= { id: 'campaign-1', version: 1, ...create }),
      update: jest.fn(async ({ where, data }: any) => {
        if (!state.campaign || state.campaign.id !== where.id) throw new Error('campaign not found');
        const version = data.version?.increment;
        const { version: _version, ...rest } = data;
        state.campaign = { ...state.campaign, ...rest, ...(version !== undefined && { version: state.campaign.version + version }) };
        return state.campaign;
      }),
    },
    campaignMembership: {
      findUnique: jest.fn(async ({ where }: any) => state.membership?.tradeId === where.tradeId ? state.membership : null),
      create: jest.fn(async ({ data }: any) => state.membership ??= { headSource: 'AUTO', ...data }),
    },
    excursionWorkItem: {
      findMany: jest.fn(async () => []),
      updateMany: jest.fn(async () => ({ count: 0 })),
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
  it('does not enqueue or wake work for a non-final v5 page', async () => {
    const { db } = statefulDb();
    const producer = { dirtyTargets: jest.fn() };
    const wake = { runOne: jest.fn() };
    const service = new Mt5SyncService(
      db, cipher as never, bridge([{ page: { hasMore: true, nextCursor: 'next', bytes: 100 } }]) as never,
      producer as never, wake as never,
    );

    await expect(service.sync('owner-1', 'account-1')).resolves.toMatchObject({ state: 'in_progress' });
    expect(producer.dirtyTargets).not.toHaveBeenCalled();
    expect(wake.runOne).not.toHaveBeenCalled();
  });

  it('durably enqueues final closed targets before releasing the lease and isolates a failed wake', async () => {
    process.env.MT5_EXCURSION_WRITE_ENABLED = 'true';
    const { db, state } = statefulDb();
    db.trade.findMany.mockImplementation(async ({ where }: any) => where.closedAt
      ? [{ id: 'closed-trade', updatedAt: new Date(1), openedAt: new Date(1), closedAt: new Date(2), status: 'CLOSED', side: 'LONG', symbol: 'EURUSD', quantityLots: null, entryPrice: null, exitPrice: null, riskAmount: null, riskPercent: null, initialPlanId: null, initialPlanMetricContractVersion: null }]
      : []);
    const producer = {
      dirtyTargets: jest.fn(async () => {
        expect(state.status?.lastSuccessfulSnapshotMsc).toBeDefined();
        expect(state.lease).toBeDefined();
        return { queued: 1 };
      }),
    };
    const wake = { runOne: jest.fn(async () => { throw new Error('crash after commit'); }) };
    const service = new Mt5SyncService(db, cipher as never, bridge([{}]) as never, producer as never, wake as never);

    await expect(service.sync('owner-1', 'account-1')).resolves.toMatchObject({
      state: 'completed',
      excursions: { mode: 'queued', queued: 1, deferred: 1, reasons: [{ reason: 'WORKER_WAKE_FAILED', count: 1 }] },
    });
    delete process.env.MT5_EXCURSION_WRITE_ENABLED;
    expect(producer.dirtyTargets).toHaveBeenCalledWith(
      db, 'account-1', expect.any(BigInt), expect.arrayContaining([expect.objectContaining({ targetId: 'closed-trade', scope: 'TRADE' })]), 'SYNC_CHANGED',
    );
    expect(wake.runOne).toHaveBeenCalledTimes(1);
    expect(state.lease).toBeUndefined();
  });

  it('does not enqueue a successful unchanged excursion for a newer sync snapshot', async () => {
    const previous = process.env.MT5_EXCURSION_WRITE_ENABLED;
    process.env.MT5_EXCURSION_WRITE_ENABLED = 'true';
    try {
      const { db } = statefulDb();
      const trade = {
        id: 'closed-trade', mt5PositionId: 10n, openedAt: new Date(1), closedAt: new Date(2),
        status: 'CLOSED', side: 'LONG', symbol: 'EURUSD', quantityLots: null, entryPrice: null,
        exitPrice: null, realizedPnl: 5, riskAmount: null, riskPercent: null,
        initialPlanId: null, initialPlanMetricContractVersion: null, excursionResult: null as any,
      };
      db.trade.findMany.mockResolvedValue([trade]);
      db.tradeCampaign.findMany.mockResolvedValue([]);
      const producer = { dirtyTargets: jest.fn(async (_tx: any, _accountId: string, _snapshot: bigint, targets: any[]) => ({ queued: targets.length })) };
      const service = new Mt5SyncService(db, cipher as never, {} as never, producer as never) as any;

      await expect(service.enqueueFinalExcursionWork(db, 'account-1', 100n, 'SYNC_CHANGED', [])).resolves.toMatchObject({ queued: 1 });
      const fingerprint = producer.dirtyTargets.mock.calls[0][3][0].baseInputFingerprint;
      trade.excursionResult = {
        status: 'SUCCESS', attemptCalculationVersion: 1, attemptInputFingerprint: fingerprint,
        successCalculationVersion: 1, successInputFingerprint: fingerprint,
      };
      producer.dirtyTargets.mockClear();

      await expect(service.enqueueFinalExcursionWork(db, 'account-1', 200n, 'SYNC_CHANGED', [])).resolves.toMatchObject({ queued: 0 });
      expect(producer.dirtyTargets).not.toHaveBeenCalled();

      trade.realizedPnl = 6;
      await expect(service.enqueueFinalExcursionWork(db, 'account-1', 300n, 'SYNC_CHANGED', ['10'])).resolves.toMatchObject({ queued: 1 });
      expect(producer.dirtyTargets).toHaveBeenCalledWith(
        db, 'account-1', 300n,
        [expect.objectContaining({ targetId: 'closed-trade', generation: 1, tickSnapshotToMsc: 300n })],
        'SYNC_CHANGED',
      );
    } finally {
      if (previous === undefined) delete process.env.MT5_EXCURSION_WRITE_ENABLED;
      else process.env.MT5_EXCURSION_WRITE_ENABLED = previous;
    }
  });

  it('invalidates both a trade and its campaign when a raw deal input changes', async () => {
    const previous = process.env.MT5_EXCURSION_WRITE_ENABLED;
    process.env.MT5_EXCURSION_WRITE_ENABLED = 'true';
    try {
      const { db } = statefulDb();
      const trade = {
        id: 'closed-trade', mt5PositionId: 10n, openedAt: new Date(1), closedAt: new Date(2),
        status: 'CLOSED', side: 'LONG', symbol: 'EURUSD', quantityLots: 1, entryPrice: 1,
        exitPrice: 2, realizedPnl: 5, riskAmount: null, riskPercent: null,
        initialPlanId: null, initialPlanMetricContractVersion: null, excursionResult: null as any,
      };
      const campaign = {
        id: 'campaign-1', version: 1, rootTradeId: trade.id,
        memberships: [{ tradeId: trade.id }], excursionResult: null as any,
      };
      const deals = [{ ticket: 1n, positionId: 10n, symbol: 'EURUSD', timeMsc: 1n, entry: 0, type: 0, volume: '1', price: '1' }];
      db.trade.findMany.mockResolvedValue([trade]);
      db.tradeCampaign.findMany.mockResolvedValue([campaign]);
      db.mt5Deal.findMany.mockResolvedValue(deals);
      const producer = { dirtyTargets: jest.fn(async (_tx: any, _accountId: string, _snapshot: bigint, targets: any[]) => ({ queued: targets.length })) };
      const service = new Mt5SyncService(db, cipher as never, {} as never, producer as never) as any;

      await expect(service.enqueueFinalExcursionWork(db, 'account-1', 100n, 'SYNC_CHANGED', [])).resolves.toMatchObject({ queued: 2 });
      const initialTargets = producer.dirtyTargets.mock.calls[0][3];
      const tradeFingerprint = initialTargets.find((target: any) => target.scope === 'TRADE').baseInputFingerprint;
      const campaignFingerprint = initialTargets.find((target: any) => target.scope === 'CAMPAIGN').baseInputFingerprint;
      trade.excursionResult = {
        status: 'SUCCESS', attemptCalculationVersion: 1, attemptInputFingerprint: tradeFingerprint,
        successCalculationVersion: 1, successInputFingerprint: tradeFingerprint,
      };
      campaign.excursionResult = {
        status: 'SUCCESS', attemptCalculationVersion: 1, attemptInputFingerprint: campaignFingerprint,
        successCalculationVersion: 1, successInputFingerprint: campaignFingerprint,
      };
      producer.dirtyTargets.mockClear();

      await expect(service.enqueueFinalExcursionWork(db, 'account-1', 200n, 'SYNC_CHANGED', [])).resolves.toMatchObject({ queued: 0 });
      deals[0].price = '1.1';
      await expect(service.enqueueFinalExcursionWork(db, 'account-1', 300n, 'SYNC_CHANGED', ['10'])).resolves.toMatchObject({ queued: 2 });
      expect(producer.dirtyTargets.mock.calls[0][3]).toEqual(expect.arrayContaining([
        expect.objectContaining({ scope: 'TRADE', targetId: trade.id }),
        expect.objectContaining({ scope: 'CAMPAIGN', targetId: campaign.id }),
      ]));
    } finally {
      if (previous === undefined) delete process.env.MT5_EXCURSION_WRITE_ENABLED;
      else process.env.MT5_EXCURSION_WRITE_ENABLED = previous;
    }
  });

  it('preserves compatible durable work but revives cancellation and fences version drift', async () => {
    const previous = process.env.MT5_EXCURSION_WRITE_ENABLED;
    process.env.MT5_EXCURSION_WRITE_ENABLED = 'true';
    try {
      const { db } = statefulDb();
      const trade = {
        id: 'closed-trade', mt5PositionId: 10n, openedAt: new Date(1), closedAt: new Date(2),
        status: 'CLOSED', side: 'LONG', symbol: 'EURUSD', quantityLots: 1, entryPrice: 1,
        exitPrice: 2, realizedPnl: 5, riskAmount: null, riskPercent: null,
        initialPlanId: null, initialPlanMetricContractVersion: null, excursionResult: null,
      };
      db.trade.findMany.mockResolvedValue([trade]);
      db.tradeCampaign.findMany.mockResolvedValue([]);
      const producer = { dirtyTargets: jest.fn(async (_tx: any, _accountId: string, _snapshot: bigint, targets: any[]) => ({ queued: targets.length })) };
      const service = new Mt5SyncService(db, cipher as never, {} as never, producer as never) as any;

      await service.enqueueFinalExcursionWork(db, 'account-1', 100n, 'SYNC_CHANGED', []);
      const fingerprint = producer.dirtyTargets.mock.calls[0][3][0].baseInputFingerprint;
      const work = {
        scope: 'TRADE', targetId: trade.id, generation: 5, baseInputFingerprint: fingerprint,
        tickSnapshotToMsc: 100n, state: 'RETRY_WAIT',
      };
      db.excursionWorkItem.findMany.mockResolvedValue([work]);
      producer.dirtyTargets.mockClear();

      await expect(service.enqueueFinalExcursionWork(db, 'account-1', 200n, 'SYNC_CHANGED', [])).resolves.toMatchObject({ queued: 0 });
      expect(producer.dirtyTargets).not.toHaveBeenCalled();

      work.state = 'CANCELLED';
      await expect(service.enqueueFinalExcursionWork(db, 'account-1', 300n, 'SYNC_CHANGED', [])).resolves.toMatchObject({ queued: 1 });
      expect(producer.dirtyTargets.mock.calls[0][3][0]).toMatchObject({ generation: 5, baseInputFingerprint: fingerprint, tickSnapshotToMsc: 300n });

      work.state = 'BLOCKED';
      work.baseInputFingerprint = fingerprint.replace(':calc-1:', ':calc-0:');
      producer.dirtyTargets.mockClear();
      await expect(service.enqueueFinalExcursionWork(db, 'account-1', 400n, 'SYNC_CHANGED', [])).resolves.toMatchObject({ queued: 1 });
      expect(producer.dirtyTargets.mock.calls[0][3][0]).toMatchObject({ generation: 6, baseInputFingerprint: fingerprint, tickSnapshotToMsc: 400n });
    } finally {
      if (previous === undefined) delete process.env.MT5_EXCURSION_WRITE_ENABLED;
      else process.env.MT5_EXCURSION_WRITE_ENABLED = previous;
    }
  });

  it('keeps a current unsupported result terminal but recovers an orphaned stale result', async () => {
    const previous = process.env.MT5_EXCURSION_WRITE_ENABLED;
    process.env.MT5_EXCURSION_WRITE_ENABLED = 'true';
    try {
      const { db } = statefulDb();
      const trade = {
        id: 'closed-trade', mt5PositionId: 10n, openedAt: new Date(1), closedAt: new Date(2),
        status: 'CLOSED', side: 'LONG', symbol: 'EURUSD', quantityLots: 1, entryPrice: 1,
        exitPrice: 2, realizedPnl: 5, riskAmount: null, riskPercent: null,
        initialPlanId: null, initialPlanMetricContractVersion: null, excursionResult: null as any,
      };
      db.trade.findMany.mockResolvedValue([trade]);
      db.tradeCampaign.findMany.mockResolvedValue([]);
      const producer = { dirtyTargets: jest.fn(async (_tx: any, _accountId: string, _snapshot: bigint, targets: any[]) => ({ queued: targets.length })) };
      const service = new Mt5SyncService(db, cipher as never, {} as never, producer as never) as any;

      await service.enqueueFinalExcursionWork(db, 'account-1', 100n, 'SYNC_CHANGED', []);
      const fingerprint = producer.dirtyTargets.mock.calls[0][3][0].baseInputFingerprint;
      trade.excursionResult = {
        status: 'UNSUPPORTED', attemptCalculationVersion: 1, attemptInputFingerprint: fingerprint,
        successCalculationVersion: null, successInputFingerprint: null,
      };
      producer.dirtyTargets.mockClear();
      await expect(service.enqueueFinalExcursionWork(db, 'account-1', 200n, 'SYNC_CHANGED', [])).resolves.toMatchObject({ queued: 0 });

      trade.excursionResult.status = 'STALE';
      await expect(service.enqueueFinalExcursionWork(db, 'account-1', 300n, 'SYNC_CHANGED', [])).resolves.toMatchObject({ queued: 1 });
    } finally {
      if (previous === undefined) delete process.env.MT5_EXCURSION_WRITE_ENABLED;
      else process.env.MT5_EXCURSION_WRITE_ENABLED = previous;
    }
  });

  it('preserves current membership-trigger campaign work across ordinary sync', async () => {
    const previous = process.env.MT5_EXCURSION_WRITE_ENABLED;
    process.env.MT5_EXCURSION_WRITE_ENABLED = 'true';
    try {
      const { db } = statefulDb();
      const trade = {
        id: 'closed-trade', mt5PositionId: 10n, openedAt: new Date(1), closedAt: new Date(2),
        status: 'CLOSED', side: 'LONG', symbol: 'EURUSD', quantityLots: 1, entryPrice: 1,
        exitPrice: 2, realizedPnl: 5, riskAmount: null, riskPercent: null,
        initialPlanId: null, initialPlanMetricContractVersion: null, excursionResult: null as any,
      };
      const campaign = {
        id: 'campaign-1', version: 2, rootTradeId: trade.id,
        memberships: [{ tradeId: trade.id }], excursionResult: null as any,
      };
      db.trade.findMany.mockResolvedValue([trade]);
      db.tradeCampaign.findMany.mockResolvedValue([campaign]);
      const producer = { dirtyTargets: jest.fn(async (_tx: any, _accountId: string, _snapshot: bigint, targets: any[]) => ({ queued: targets.length })) };
      const service = new Mt5SyncService(db, cipher as never, {} as never, producer as never) as any;

      await service.enqueueFinalExcursionWork(db, 'account-1', 100n, 'SYNC_CHANGED', []);
      const initial = producer.dirtyTargets.mock.calls[0][3];
      const tradeFingerprint = initial.find((target: any) => target.scope === 'TRADE').baseInputFingerprint;
      const campaignFingerprint = initial.find((target: any) => target.scope === 'CAMPAIGN').baseInputFingerprint;
      trade.excursionResult = {
        status: 'SUCCESS', attemptCalculationVersion: 1, attemptInputFingerprint: tradeFingerprint,
        successCalculationVersion: 1, successInputFingerprint: tradeFingerprint,
      };
      campaign.excursionResult = {
        status: 'STALE', attemptCalculationVersion: 1, attemptInputFingerprint: campaignFingerprint,
        successCalculationVersion: 1, successInputFingerprint: campaignFingerprint,
      };
      const work = {
        scope: 'CAMPAIGN', targetId: campaign.id, generation: 3,
        baseInputFingerprint: 'excursion-trigger-v1:calc-1:membership',
        tickSnapshotToMsc: 100n, state: 'PENDING',
      };
      db.excursionWorkItem.findMany.mockResolvedValue([work]);

      for (const state of ['PENDING', 'CLAIMED', 'RETRY_WAIT', 'BLOCKED']) {
        work.state = state;
        producer.dirtyTargets.mockClear();
        await expect(service.enqueueFinalExcursionWork(db, 'account-1', 200n, 'SYNC_CHANGED', [])).resolves.toMatchObject({ queued: 0 });
        expect(producer.dirtyTargets).not.toHaveBeenCalled();
      }

      db.excursionWorkItem.findMany.mockResolvedValue([
        {
          scope: 'TRADE', targetId: trade.id, generation: 2, baseInputFingerprint: tradeFingerprint,
          tickSnapshotToMsc: 100n, state: 'RETRY_WAIT',
        },
        work,
      ]);
      producer.dirtyTargets.mockClear();
      await expect(service.enqueueFinalExcursionWork(db, 'account-1', 300n, 'SYNC_CHANGED', [])).resolves.toMatchObject({ queued: 0 });
      expect(producer.dirtyTargets).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.MT5_EXCURSION_WRITE_ENABLED;
      else process.env.MT5_EXCURSION_WRITE_ENABLED = previous;
    }
  });

  it('cancels worker work for open trades and campaigns before selecting closed targets', async () => {
    const previous = process.env.MT5_EXCURSION_WRITE_ENABLED;
    process.env.MT5_EXCURSION_WRITE_ENABLED = 'true';
    try {
      const { db } = statefulDb();
      const producer = { dirtyTargets: jest.fn() };
      const service = new Mt5SyncService(db, cipher as never, {} as never, producer as never) as any;

      await expect(service.enqueueFinalExcursionWork(db, 'account-1', 100n, 'SYNC_CHANGED', [])).resolves.toMatchObject({ queued: 0 });

      expect(db.excursionWorkItem.updateMany).toHaveBeenCalledWith({
        where: {
          accountId: 'account-1',
          state: { in: ['PENDING', 'CLAIMED', 'RETRY_WAIT', 'BLOCKED'] },
          OR: [
            { scope: 'TRADE', trade: { is: { closedAt: null } } },
            { scope: 'CAMPAIGN', campaign: { is: { memberships: { some: { trade: { closedAt: null } } } } } },
          ],
        },
        data: {
          state: 'CANCELLED',
          reason: 'TARGET_OPEN',
          claimId: null,
          claimExpiresAt: null,
          notBefore: null,
        },
      });
      expect(producer.dirtyTargets).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.MT5_EXCURSION_WRITE_ENABLED;
      else process.env.MT5_EXCURSION_WRITE_ENABLED = previous;
    }
  });

  it('does not wake the excursion worker when final sync has no changed targets', async () => {
    const previous = process.env.MT5_EXCURSION_WRITE_ENABLED;
    process.env.MT5_EXCURSION_WRITE_ENABLED = 'true';
    try {
      const { db, state } = statefulDb();
      const producer = { dirtyTargets: jest.fn() };
      const wake = { runOne: jest.fn() };
      const service = new Mt5SyncService(db, cipher as never, bridge([{}]) as never, producer as never, wake as never);

      await expect(service.sync('owner-1', 'account-1')).resolves.toMatchObject({
        state: 'completed',
        excursions: { mode: 'queued', queued: 0, processed: 0 },
      });
      expect(producer.dirtyTargets).not.toHaveBeenCalled();
      expect(wake.runOne).not.toHaveBeenCalled();
      expect(state.status.excursionDirtyPositionIds).toBe(Prisma.JsonNull);
    } finally {
      if (previous === undefined) delete process.env.MT5_EXCURSION_WRITE_ENABLED;
      else process.env.MT5_EXCURSION_WRITE_ENABLED = previous;
    }
  });

  it('retains durable dirty positions while excursion writes are disabled', async () => {
    const previous = process.env.MT5_EXCURSION_WRITE_ENABLED;
    process.env.MT5_EXCURSION_WRITE_ENABLED = 'false';
    try {
      const { db, state } = statefulDb();
      state.status = {
        accountId: account.id, server: account.canonicalServer, accountLogin: account.accountLogin,
        lastSuccessfulSnapshotMsc: 1000n, mode: null, snapshotToMsc: null, pageCursor: null,
        changedSinceMsc: null, excursionDirtyPositionIds: ['9'],
      };
      const producer = { dirtyTargets: jest.fn() };
      const wake = { runOne: jest.fn() };
      const service = new Mt5SyncService(db, cipher as never, bridge([{}]) as never, producer as never, wake as never);

      await expect(service.sync('owner-1', 'account-1')).resolves.toMatchObject({
        state: 'completed',
        excursions: { mode: 'disabled', queued: 0 },
      });
      expect(state.status.excursionDirtyPositionIds).toEqual(['9']);
      expect(producer.dirtyTargets).not.toHaveBeenCalled();
      expect(wake.runOne).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.MT5_EXCURSION_WRITE_ENABLED;
      else process.env.MT5_EXCURSION_WRITE_ENABLED = previous;
    }
  });

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
    expect(db.trade.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        ownerId: 'owner-1',
        mt5AccountId: 'account-1',
        symbol: 'XAUUSD',
        side: 'LONG',
        campaignMembership: { isNot: null },
      }),
    }));
  });

  it('registers sync priority before the bridge call and releases it after completion', async () => {
    const { db } = statefulDb();
    const upstream = bridge([{ deals: [deposit, deal] }]);
    const activity = {
      registerSyncIntent: jest.fn().mockResolvedValue('sync-priority-1'),
      waitForWorkerYield: jest.fn().mockResolvedValue(true),
      releaseSyncIntent: jest.fn().mockResolvedValue(undefined),
    };
    const service = new Mt5SyncService(db, cipher as never, upstream as never, undefined, undefined, activity as never);

    await expect(service.sync('owner-1', 'account-1')).resolves.toMatchObject({ state: 'completed' });
    expect(activity.registerSyncIntent.mock.invocationCallOrder[0]).toBeLessThan(upstream.sync.mock.invocationCallOrder[0]);
    expect(activity.waitForWorkerYield).toHaveBeenCalledWith('sync-priority-1');
    expect(activity.releaseSyncIntent).toHaveBeenCalledWith('sync-priority-1');
  });

  it('drains an in-flight priority heartbeat before releasing intent without a false halt', async () => {
    jest.useFakeTimers();
    const { db } = statefulDb();
    let releaseSync!: (value: any) => void;
    let releaseHeartbeat!: (value: boolean) => void;
    const activity = {
      registerSyncIntent: jest.fn().mockResolvedValue('sync-priority-1'),
      waitForWorkerYield: jest.fn().mockResolvedValue(true),
      refreshSyncIntent: jest.fn(() => new Promise<boolean>((resolve) => { releaseHeartbeat = resolve; })),
      releaseSyncIntent: jest.fn().mockResolvedValue(undefined),
      haltWorker: jest.fn().mockResolvedValue(undefined),
    };
    const service = new Mt5SyncService(db, cipher as never, {} as never, undefined, undefined, activity as never);
    jest.spyOn(service as any, 'syncCoordinated').mockImplementation(() => new Promise((resolve) => { releaseSync = resolve; }));
    const running = service.sync('owner-1', 'account-1');
    while (!releaseSync) await Promise.resolve();
    await jest.advanceTimersByTimeAsync(30_000);
    expect(activity.refreshSyncIntent).toHaveBeenCalledTimes(1);
    releaseSync({ state: 'completed', accountId: 'account-1' });
    await Promise.resolve();
    expect(activity.releaseSyncIntent).not.toHaveBeenCalled();
    releaseHeartbeat(false);
    await running;
    expect(activity.haltWorker).not.toHaveBeenCalled();
    expect(activity.releaseSyncIntent).toHaveBeenCalledWith('sync-priority-1');
    jest.useRealTimers();
  });

  it('reports account-scoped excursion calculation progress', async () => {
    const { db } = statefulDb();
    db.mt5Account.findFirst.mockResolvedValue({ id: 'account-1' });
    db.excursionWorkItem.groupBy = jest.fn().mockResolvedValue([
      { state: 'PENDING', _count: 3 },
      { state: 'CLAIMED', _count: 1 },
      { state: 'RETRY_WAIT', _count: 2 },
      { state: 'BLOCKED', _count: 2 },
    ]);
    db.tradeExcursionResult = { groupBy: jest.fn().mockResolvedValue([{ status: 'SUCCESS', _count: 4 }, { status: 'STALE', _count: 1 }]) };
    db.tradeCampaignExcursionResult = { groupBy: jest.fn().mockResolvedValue([{ status: 'UNSUPPORTED', _count: 2 }]) };
    db.mt5BridgeActivity = { count: jest.fn().mockResolvedValue(1) };
    const service = new Mt5SyncService(db, cipher as never, {} as never);

    await expect(service.getExcursionProgress('owner-1', 'account-1')).resolves.toEqual({
      accountId: 'account-1',
      total: 14,
      completed: 4,
      pending: 6,
      recalculationNeeded: 1,
      unsupported: 2,
      failed: 2,
      calculating: true,
      syncHasPriority: true,
    });
  });

  it('full rebuild marks seen facts, removes only unseen raw facts, and preserves authored trade state', async () => {
    const { db, state } = statefulDb();
    const upstream = bridge([{ deals: [deposit, deal] }, { deals: [deposit, deal] }]);
    const service = new Mt5SyncService(db, cipher as never, upstream as never);
    await service.sync('owner-1', 'account-1');
    const old = new Date(0);
    for (const row of state.deals) row.fetchedAt = old;
    state.deals.push({
      ...state.deals.find((row) => row.ticket === 11n),
      ticket: 99n,
      positionId: 99n,
      fetchedAt: old,
    });
    const analysis = state.trade.analysis;

    await expect(service.sync('owner-1', 'account-1', true)).resolves.toMatchObject({
      state: 'completed',
      fullRebuild: { removedDeals: 1, removedOrders: 0, sourceMissingTrades: 0 },
    });

    expect(upstream.sync.mock.calls[1][0]).toMatchObject({ mode: 'bootstrap' });
    expect(state.deals.map((row) => row.ticket)).toEqual([1n, 11n]);
    expect(state.trade.analysis).toBe(analysis);
    expect(state.membership).toMatchObject({ tradeId: 'trade-1', campaignId: 'campaign-1' });
    expect(state.status.rebuildStartedAt).toBeNull();
  });

  it('rolls back the full rebuild sweep when the reconstructed balance does not match MT5', async () => {
    const { db, state } = statefulDb();
    const service = new Mt5SyncService(db, cipher as never, bridge([
      { deals: [deposit, deal] },
      { deals: [deposit, deal], account: { currency: 'USD', currencyDigits: 2, currentBalance: '999' } },
    ]) as never);
    await service.sync('owner-1', 'account-1');
    const stale = {
      ...state.deals.find((row) => row.ticket === 11n),
      ticket: 99n,
      positionId: 99n,
      fetchedAt: new Date(0),
    };
    state.deals.push(stale);

    await expect(service.sync('owner-1', 'account-1', true)).resolves.toMatchObject({ state: 'failed' });
    expect(state.deals).toContainEqual(stale);
    expect(state.status.rebuildStartedAt).toBeInstanceOf(Date);
    expect(state.status.lastError).toBeDefined();
  });

  it('passes positions removed by a full rebuild to excursion invalidation', async () => {
    const previous = process.env.MT5_EXCURSION_WRITE_ENABLED;
    process.env.MT5_EXCURSION_WRITE_ENABLED = 'true';
    try {
      const { db, state } = statefulDb();
      const producer = { dirtyTargets: jest.fn(async () => ({ queued: 0 })) };
      const service = new Mt5SyncService(db, cipher as never, bridge([
        { deals: [deposit, deal] },
        { deals: [deposit, deal] },
      ]) as never, producer as never) as any;
      await service.sync('owner-1', 'account-1');
      state.deals.push({
        ...state.deals.find((row) => row.ticket === 11n),
        ticket: 99n,
        positionId: 99n,
        fetchedAt: new Date(0),
      });
      const enqueue = jest.spyOn(service, 'enqueueFinalExcursionWork');

      await expect(service.sync('owner-1', 'account-1', true)).resolves.toMatchObject({ state: 'completed' });

      expect(enqueue.mock.calls.at(-1)?.[4]).toEqual(expect.arrayContaining(['99']));
    } finally {
      if (previous === undefined) delete process.env.MT5_EXCURSION_WRITE_ENABLED;
      else process.env.MT5_EXCURSION_WRITE_ENABLED = previous;
    }
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
    expect(state.status.excursionDirtyPositionIds).toEqual(expect.arrayContaining(['9']));
    expect(upstream.sync.mock.calls[0][0]).toMatchObject({
      mode: 'incremental',
      changedSinceMsc: priorWatermark - 72 * 60 * 60 * 1000,
    });

    await expect(service.sync('owner-1', 'account-1')).resolves.toMatchObject({ state: 'completed' });
    expect(state.status.lastSuccessfulSnapshotMsc).toBe(BigInt(first.progress!.snapshotToMsc));
    expect(state.status.excursionDirtyPositionIds).toEqual(['9']);
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

  it('excludes MT5 account credit from the balance ledger', async () => {
    const { db, state } = statefulDb();
    const credit = { ...deposit, ticket: '2', timeMsc: 600, type: 3, profit: 236.8 };
    const service = new Mt5SyncService(db, cipher as never, bridge([
      { deals: [deposit, credit], account: { currency: 'USD', currencyDigits: 2, currentBalance: '1000' } },
    ]) as never);

    await expect(service.sync('owner-1', 'account-1')).resolves.toMatchObject({ state: 'completed' });

    expect(state.ledger).toMatchObject({ status: 'VERIFIED', lastError: null });
    expect(state.ledger.calculatedBalance.toString()).toBe('1000');
    expect(state.balanceEvents.at(-1).balanceDelta.toString()).toBe('0');
  });
});
