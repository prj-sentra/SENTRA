import { randomUUID } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import { Mt5SyncService } from './mt5-sync.service';
import { TradeLogService } from '../trade-log/trade-log.service';

type Gate = {
  acquired: Promise<void>;
  entered(): void;
  release(): void;
  waitForRelease(): Promise<void>;
};

function gate(): Gate {
  let entered!: () => void;
  let released: () => void = () => {};
  return {
    acquired: new Promise((resolve) => { entered = resolve; }),
    entered,
    release: () => released(),
    waitForRelease: () => new Promise((resolve) => { released = resolve; }),
  };
}

function isAdvisoryLock(query: Prisma.Sql): boolean {
  return query.strings.join('').includes('pg_advisory_xact_lock');
}

function transactionAwarePrisma(client: PrismaClient, lockGate?: Gate): PrismaClient {
  return new Proxy(client, {
    get(target, property, receiver) {
      if (property !== '$transaction') return Reflect.get(target, property, receiver);
      return async (input: unknown, options?: unknown) => {
        if (typeof input !== 'function') return target.$transaction(input as never, options as never);
        return target.$transaction(async (transaction) => input(new Proxy(transaction, {
          get(transactionTarget, transactionProperty, transactionReceiver) {
            const value = Reflect.get(transactionTarget, transactionProperty, transactionReceiver);
            if (transactionProperty !== '$queryRaw' || !lockGate) return value;
            return async <T>(query: Prisma.Sql): Promise<T> => {
              const result = await value.call(transactionTarget, query) as T;
              if (isAdvisoryLock(query)) {
                lockGate.entered();
                await lockGate.waitForRelease();
              }
              return result;
            };
          },
        })), options as never);
      };
    },
  }) as PrismaClient;
}

async function waitForPending(promise: Promise<unknown>): Promise<void> {
  let settled = false;
  void promise.finally(() => { settled = true; });
  await new Promise((resolve) => setTimeout(resolve, 25));
  expect(settled).toBe(false);
}

describe('MT5 campaign serialization on disposable PostgreSQL', () => {
  const url = process.env.TEST_DATABASE_URL;
  const run = url ? it : it.skip;
  let database: PrismaClient;
  let prefix: string;

  function fixtureId(name: string): string {
    return `${prefix}-${name}`;
  }

  async function assertDisposableDatabase(): Promise<void> {
    if (!url) throw new Error('TEST_DATABASE_URL is required');
    const [{ database: name }] = await database.$queryRaw<Array<{ database: string }>>`SELECT current_database() AS database`;
    if (!/(^|[_-])(test|testing|ci|spec)([_-]|$)/i.test(name)) {
      throw new Error(`refusing public-service integration database: ${name}`);
    }
  }

  function bridge() {
    return {
      sync: async () => ({
        contractVersion: 3,
        ledgerSemanticsVersion: 1,
        server: 'Broker Server',
        accountLogin: 7001,
        cursor: 'fixture-cursor',
        deals: [{
          ticket: '9001', order: '8001', positionId: '5001', time: 1_760_000_000, timeMsc: 1_760_000_000_000,
          type: 0, entry: 0, magic: '0', reason: 0, volume: 1, price: 100, commission: -1, swap: 0, profit: 12, fee: 0,
          symbol: 'EURUSD', comment: 'fixture', externalId: 'fixture-deal',
        }],
        orders: [],
        positionEntryBalances: [{
          positionId: '5001', entryDealTicket: '9001', entryOrderTicket: '8001',
          entryTimeMsc: 1_760_000_000_000, preEntryBalance: '10000', ledgerSemanticsVersion: 1,
        }],
        unsupportedPositionEntryBalances: [],
      }),
    };
  }

  async function seed(conflict: boolean): Promise<{ ownerId: string; accountId: string; tradeId: string; targetId: string; conflictId?: string }> {
    const ownerId = fixtureId('owner');
    const accountId = fixtureId('account');
    const tradeId = fixtureId('subject');
    const targetId = fixtureId('target');
    const alternateId = fixtureId('alternate');
    const openedAt = new Date('2026-08-01T00:00:00.000Z');
    await database.appUser.create({ data: { id: ownerId, username: ownerId, normalizedUsername: ownerId, passwordHash: 'fixture', status: 'ACTIVE' } });
    await database.mt5Account.create({
      data: {
        id: accountId, ownerId, nickname: 'fixture', server: 'Broker Server', canonicalServer: 'broker server', accountLogin: 7001n,
        credentialCiphertext: Buffer.from('ciphertext'), credentialIv: Buffer.from('iv'), credentialTag: Buffer.from('tag'), credentialVersion: 1,
      },
    });
    await database.trade.create({
      data: {
        id: tradeId, ownerId, mt5AccountId: accountId, symbol: 'EURUSD', side: 'LONG', status: 'OPEN', openedAt,
        mt5Server: 'Broker Server', mt5ServerCanonical: 'broker server', mt5AccountLogin: 7001n, mt5PositionId: 5001n,
        analysis: { create: { baseTimeframe: '1h' } },
      },
    });
    for (const [campaignId, rootId] of [[targetId, fixtureId('target-root')], [alternateId, fixtureId('alternate-root')]] as const) {
      await database.trade.create({
        data: {
          id: rootId, ownerId, mt5AccountId: accountId, symbol: 'EURUSD', side: 'LONG', status: 'OPEN', openedAt,
          analysis: { create: { baseTimeframe: campaignId === targetId ? '4h' : '1D' } },
          campaignRoot: { create: { id: campaignId, ownerId, mt5AccountId: accountId, tradingDate: openedAt } },
          campaignMembership: { create: { campaignId, source: 'AUTO' } },
        },
      });
    }
    const conflictId = conflict ? fixtureId('conflict') : undefined;
    if (conflictId) {
      await database.campaignConflict.create({
        data: { id: conflictId, tradeId, candidateCampaignIds: [targetId, alternateId], status: 'UNRESOLVED' },
      });
    }
    return { ownerId, accountId, tradeId, targetId, conflictId };
  }

  async function clean(): Promise<void> {
    if (!prefix) return;
    const ownerId = fixtureId('owner');
    const accountId = fixtureId('account');
    await database.campaignConflict.deleteMany({ where: { trade: { ownerId } } });
    await database.campaignMembership.deleteMany({ where: { trade: { ownerId } } });
    await database.tradeCampaign.deleteMany({ where: { ownerId } });
    await database.mt5PositionEntryBalance.deleteMany({ where: { accountId } });
    await database.mt5Deal.deleteMany({ where: { accountId } });
    await database.mt5Order.deleteMany({ where: { accountId } });
    await database.mt5SyncStatus.deleteMany({ where: { accountId } });
    await database.mt5SyncLease.deleteMany({ where: { accountId } });
    await database.trade.deleteMany({ where: { ownerId } });
    await database.mt5Account.deleteMany({ where: { id: accountId } });
    await database.appUser.deleteMany({ where: { id: ownerId } });
  }

  async function assertOutcome(fixture: Awaited<ReturnType<typeof seed>>, conflict: boolean): Promise<void> {
    const membership = await database.campaignMembership.findUnique({ where: { tradeId: fixture.tradeId } });
    expect(membership).toMatchObject({ campaignId: fixture.targetId, source: 'MANUAL' });
    expect(await database.tradeCampaign.count({ where: { ownerId: fixture.ownerId, memberships: { none: {} } } })).toBe(0);
    expect((await database.trade.findUniqueOrThrow({ where: { id: fixture.tradeId }, include: { analysis: true } })).analysis?.baseTimeframe).toBe('1h');
    if (conflict) {
      const resolved = await database.campaignConflict.findUniqueOrThrow({ where: { id: fixture.conflictId! } });
      expect(resolved).toMatchObject({ status: 'RESOLVED', resolvedCampaignId: fixture.targetId });
      expect(resolved.resolvedAt).toBeInstanceOf(Date);
    }
  }

  async function race(kind: 'relink' | 'resolve', winner: 'sync' | 'manual'): Promise<void> {
    const fixture = await seed(kind === 'resolve');
    const winnerClient = new PrismaClient({ datasources: { db: { url: url! } } });
    const contenderClient = new PrismaClient({ datasources: { db: { url: url! } } });
    const lockGate = gate();
    const sync = new Mt5SyncService(
      transactionAwarePrisma(winner === 'sync' ? winnerClient : contenderClient, winner === 'sync' ? lockGate : undefined) as never,
      { decrypt: () => 'fixture-password' } as never,
      bridge() as never,
    );
    const manual = new TradeLogService(transactionAwarePrisma(winner === 'manual' ? winnerClient : contenderClient, winner === 'manual' ? lockGate : undefined) as never);
    const syncCall = () => sync.sync(fixture.ownerId, fixture.accountId);
    const manualCall = () => kind === 'relink'
      ? manual.relinkCampaign(fixture.ownerId, { accountId: fixture.accountId, tradeId: fixture.tradeId, campaignId: fixture.targetId })
      : manual.resolveCampaignConflict(fixture.ownerId, fixture.conflictId!, { accountId: fixture.accountId, campaignId: fixture.targetId });
    try {
      const winning = winner === 'sync' ? syncCall() : manualCall();
      await lockGate.acquired;
      const contending = winner === 'sync' ? manualCall() : syncCall();
      await waitForPending(contending);
      lockGate.release();
      await Promise.all([winning, contending]);
      await assertOutcome(fixture, kind === 'resolve');
    } finally {
      lockGate.release();
      await Promise.allSettled([winnerClient.$disconnect(), contenderClient.$disconnect()]);
    }
  }

  beforeEach(async () => {
    database = new PrismaClient({ datasources: { db: { url: url! } } });
    await database.$connect();
    await assertDisposableDatabase();
    prefix = `campaign-race-${randomUUID()}`;
  });

  afterEach(async () => {
    await clean();
    await database.$disconnect();
  });

  run('keeps a unique manual destination when sync wins before campaign relinking', async () => {
    await race('relink', 'sync');
  });

  run('keeps a unique manual destination when relinking wins before sync', async () => {
    await race('relink', 'manual');
  });

  run('resolves a conflict into the unique manual destination when sync wins', async () => {
    await race('resolve', 'sync');
  });

  run('resolves a conflict into the unique manual destination when resolution wins before sync', async () => {
    await race('resolve', 'manual');
  });
});
