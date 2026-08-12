import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient, type Prisma } from '@prisma/client';
import { Mt5SyncService } from './mt5-sync.service';
import { TradeLogService } from '../trade-log/trade-log.service';
import { CampaignImageService } from '../trade-log/campaign-image.service';

type Gate = {
  acquired: Promise<void>;
  entered(): void;
  release(): void;
  waitForRelease(): Promise<void>;
};

function gate(): Gate {
  let entered!: () => void;
  let release!: () => void;
  let released = false;
  const acquired = new Promise<void>((resolve) => { entered = resolve; });
  const releaseRequested = new Promise<void>((resolve) => { release = resolve; });
  return {
    acquired,
    entered,
    release: () => {
      if (!released) {
        released = true;
        release();
      }
    },
    waitForRelease: () => releaseRequested,
  };
}

function isAdvisoryLock(query: Prisma.Sql | TemplateStringsArray): boolean {
  const strings = 'strings' in query ? query.strings : query;
  return strings.join('').includes('pg_advisory_xact_lock');
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
            return async <T>(query: Prisma.Sql | TemplateStringsArray, ...values: unknown[]): Promise<T> => {
              const result = await value.call(transactionTarget, query, ...values) as T;
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
  void promise.then(
    () => { settled = true; },
    () => { settled = true; },
  );
  await new Promise((resolve) => setTimeout(resolve, 25));
  expect(settled).toBe(false);
}

describe('MT5 campaign serialization on disposable PostgreSQL', () => {
  jest.setTimeout(30_000);
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
      sync: async (request: { server: string; accountLogin: number; mode: 'bootstrap' | 'incremental'; snapshotToMsc: number }) => ({
        contractVersion: 5,
        server: request.server,
        accountLogin: request.accountLogin,
        mode: request.mode,
        snapshotToMsc: request.snapshotToMsc,
        page: { hasMore: false, bytes: 1 },
        account: { currency: 'USD', currencyDigits: 2, currentBalance: '11' },
        deals: [{
          ticket: '9001', order: '8001', positionId: '5001', time: 1_760_000_000, timeMsc: 1_760_000_000_000,
          type: 0, entry: 0, magic: '0', reason: 0, volume: 1, price: 100, commission: -1, swap: 0, profit: 12, fee: 0,
          symbol: 'EURUSD', comment: 'fixture', externalId: 'fixture-deal',
        }],
        orders: [],
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
    await database.campaignConflict.deleteMany({ where: { trade: { ownerId: { startsWith: prefix } } } });
    await database.campaignMembership.deleteMany({ where: { trade: { ownerId: { startsWith: prefix } } } });
    await database.tradeCampaign.deleteMany({ where: { ownerId: { startsWith: prefix } } });
    await database.mt5PositionEntryBalance.deleteMany({ where: { accountId: { startsWith: prefix } } });
    await database.mt5AccountBalanceEvent.deleteMany({ where: { accountId: { startsWith: prefix } } });
    await database.mt5AccountBalanceLedgerState.deleteMany({ where: { accountId: { startsWith: prefix } } });
    await database.mt5PositionEntryPlan.deleteMany({ where: { accountId: { startsWith: prefix } } });
    await database.mt5Deal.deleteMany({ where: { accountId: { startsWith: prefix } } });
    await database.mt5Order.deleteMany({ where: { accountId: { startsWith: prefix } } });
    await database.mt5SyncStatus.deleteMany({ where: { accountId: { startsWith: prefix } } });
    await database.mt5SyncLease.deleteMany({ where: { accountId: { startsWith: prefix } } });
    await database.trade.deleteMany({ where: { ownerId: { startsWith: prefix } } });
    await database.mt5Account.deleteMany({ where: { id: { startsWith: prefix } } });
    await database.appUser.deleteMany({ where: { id: { startsWith: prefix } } });
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
      const results = await Promise.all([winning, contending]);
      const syncResult = winner === 'sync' ? results[0] : results[1];
      expect(syncResult).toMatchObject({ state: 'completed' });
      expect(await database.mt5AccountBalanceLedgerState.findUniqueOrThrow({
        where: { accountId: fixture.accountId },
      })).toMatchObject({ status: 'VERIFIED', historyFromMsc: 0n });
      expect((await database.trade.findFirstOrThrow({
        where: { mt5AccountId: fixture.accountId, mt5PositionId: 5001n },
      })).seedBalance?.toString()).toBe('0');
      await assertOutcome(fixture, kind === 'resolve');
    } finally {
      lockGate.release();
      await Promise.allSettled([winnerClient.$disconnect(), contenderClient.$disconnect()]);
    }
  }

  async function seedRepairRace(): Promise<{
    ownerId: string; accountId: string; targetId: string; alternateId: string;
    candidateConflictId: string; resolvedConflictId: string; targetImageIds: string[];
  }> {
    const ownerId = fixtureId('repair-owner');
    const accountId = fixtureId('repair-account');
    const targetId = fixtureId('repair-target');
    const alternateId = fixtureId('repair-alternate');
    const openedAt = new Date('2026-08-01T00:00:00.000Z');
    await database.appUser.create({ data: { id: ownerId, username: ownerId, normalizedUsername: ownerId, passwordHash: 'fixture', status: 'ACTIVE' } });
    await database.mt5Account.create({
      data: {
        id: accountId, ownerId, nickname: 'fixture', server: 'Broker Server', canonicalServer: 'broker server', accountLogin: 7101n,
        credentialCiphertext: Buffer.from('ciphertext'), credentialIv: Buffer.from('iv'), credentialTag: Buffer.from('tag'), credentialVersion: 1,
      },
    });
    const rootIds = [fixtureId('repair-target-root'), fixtureId('repair-alternate-root')];
    const conflictTradeIds = [fixtureId('repair-candidate-trade'), fixtureId('repair-resolved-trade')];
    for (const [index, id] of [...rootIds, ...conflictTradeIds].entries()) {
      await database.trade.create({
        data: {
          id, ownerId, mt5AccountId: accountId, symbol: 'EURUSD', side: 'LONG', status: 'OPEN',
          openedAt: new Date(openedAt.getTime() + index * 60_000), analysis: { create: { baseTimeframe: '1h' } },
        },
      });
    }
    await database.tradeCampaign.create({
      data: {
        id: targetId, ownerId, mt5AccountId: accountId, rootTradeId: rootIds[0], tradingDate: openedAt,
        memo: 'canonical memo', analysis: { create: { primaryTrend: 'UP', entryReason: 'canonical review' } },
        memberships: { create: { tradeId: rootIds[0], source: 'AUTO' } },
      },
    });
    await database.tradeCampaign.create({
      data: {
        id: alternateId, ownerId, mt5AccountId: accountId, rootTradeId: rootIds[1], tradingDate: openedAt,
        analysis: { create: {
          primaryTrend: 'DOWN', entryReason: 'losing review',
          economicIndicators: { create: { type: 'CPI', impact: 'POSITIVE', position: 0 } },
          archives: { create: { source: 'seeded-authored-archive', content: { note: 'losing archive' } } },
        } },
        memberships: { create: { tradeId: rootIds[1], source: 'AUTO' } },
      },
    });
    const targetImageIds = [fixtureId('repair-image-a'), fixtureId('repair-image-b')];
    for (const [position, id] of targetImageIds.entries()) {
      await database.tradeCampaignImage.create({
        data: {
          id, campaignId: targetId, position, uploadId: randomUUID(), fileName: `${randomUUID()}.webp`, mimeType: 'image/webp',
          byteSize: 1, contentSha256: '0'.repeat(64), width: 1, height: 1, publishedAt: new Date(),
        },
      });
    }
    const candidateConflictId = fixtureId('repair-candidate-conflict');
    const resolvedConflictId = fixtureId('repair-resolved-conflict');
    await database.campaignConflict.create({ data: { id: candidateConflictId, tradeId: conflictTradeIds[0], candidateCampaignIds: [alternateId, targetId] } });
    await database.campaignConflict.create({
      data: {
        id: resolvedConflictId, tradeId: conflictTradeIds[1], candidateCampaignIds: [alternateId],
        status: 'RESOLVED', resolvedCampaignId: alternateId, resolvedAt: new Date(),
      },
    });
    return { ownerId, accountId, targetId, alternateId, candidateConflictId, resolvedConflictId, targetImageIds };
  }

  async function repairRace(
    writer: 'analysis' | 'review' | 'memo' | 'upload' | 'reorder' | 'remove',
    winner: 'repair' | 'writer',
  ): Promise<void> {
    const fixture = await seedRepairRace();
    const previousImageDir = process.env.TRADE_IMAGE_DIR;
    const imageDir = writer === 'upload' ? await mkdtemp(join(tmpdir(), 'campaign-race-images-')) : undefined;
    if (imageDir) process.env.TRADE_IMAGE_DIR = imageDir;
    const repairClient = new PrismaClient({ datasources: { db: { url: url! } } });
    const writerClient = new PrismaClient({ datasources: { db: { url: url! } } });
    const lockGate = gate();
    const repair = new Mt5SyncService(
      transactionAwarePrisma(repairClient, winner === 'repair' ? lockGate : undefined) as never, {} as never, {} as never,
    );
    const log = new TradeLogService(transactionAwarePrisma(writerClient, winner === 'writer' ? lockGate : undefined) as never);
    const campaign = await database.tradeCampaign.findUniqueOrThrow({ where: { id: fixture.targetId }, include: { analysis: true } });
    const writerCall = () => {
      if (writer === 'analysis') return log.patchCampaignAnalysis(fixture.ownerId, fixture.accountId, fixture.targetId, {
        expectedUpdatedAt: campaign.analysis!.updatedAt.toISOString(), primaryTrend: 'up_sideways',
      });
      if (writer === 'review') return log.patchCampaignReview(fixture.ownerId, fixture.accountId, fixture.targetId, {
        expectedReviewUpdatedAt: campaign.analysis!.reviewUpdatedAt.toISOString(), entryReason: 'writer review',
      });
      if (writer === 'memo') return log.patchCampaignMemo(fixture.ownerId, fixture.accountId, fixture.targetId, {
        expectedUpdatedAt: campaign.updatedAt.toISOString(), memo: 'writer memo',
      });
      const gallery = new CampaignImageService(transactionAwarePrisma(writerClient, winner === 'writer' ? lockGate : undefined) as never);
      if (writer === 'upload') return gallery.upload(fixture.ownerId, fixture.accountId, fixture.targetId, randomUUID(), {
        buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64'),
        mimetype: 'image/png', originalname: 'writer.png',
      } as Express.Multer.File);
      return writer === 'reorder'
        ? gallery.reorder(fixture.ownerId, fixture.accountId, fixture.targetId, [...fixture.targetImageIds].reverse())
        : gallery.remove(fixture.ownerId, fixture.accountId, fixture.targetId, fixture.targetImageIds[0]);
    };
    try {
      const first = winner === 'repair'
        ? repair.reclassifyOwnedAccount(fixture.ownerId, fixture.accountId, true)
        : writerCall();
      await lockGate.acquired;
      const second = winner === 'repair'
        ? writerCall()
        : repair.reclassifyOwnedAccount(fixture.ownerId, fixture.accountId, true);
      await waitForPending(second);
      lockGate.release();
      await Promise.all([first, second]);
      const canonical = await database.tradeCampaign.findUniqueOrThrow({
        where: { id: fixture.targetId }, include: { analysis: { include: { archives: true } }, images: { orderBy: { position: 'asc' } } },
      });
      expect(await database.tradeCampaign.findUnique({ where: { id: fixture.alternateId } })).toBeNull();
      expect(canonical.analysis!.archives).toEqual(expect.arrayContaining([
        expect.objectContaining({ source: `campaign-merge:${fixture.alternateId}` }),
      ]));
      expect(canonical.analysis!.archives.find((archive) => archive.source === `campaign-merge:${fixture.alternateId}`)?.content).toEqual(
        expect.objectContaining({
          campaignId: fixture.alternateId,
          memo: null,
          analysis: expect.objectContaining({
            economicIndicators: expect.arrayContaining([expect.objectContaining({ type: 'CPI' })]),
          }),
        }),
      );
      expect(canonical.images.map((image) => image.position)).toEqual(canonical.images.map((_, position) => position));
      expect(new Set(canonical.images.map((image) => image.id)).size).toBe(canonical.images.length);
      expect(await database.tradeCampaignImage.count({ where: { campaignId: fixture.alternateId } })).toBe(0);
      expect(await database.tradeCampaignImage.count({ where: { campaign: { ownerId: fixture.ownerId } } })).toBe(canonical.images.length);
      expect((await database.campaignConflict.findUniqueOrThrow({ where: { id: fixture.candidateConflictId } })).candidateCampaignIds).toEqual([fixture.targetId]);
      expect(await database.campaignConflict.findUniqueOrThrow({ where: { id: fixture.resolvedConflictId } })).toMatchObject({
        resolvedCampaignId: fixture.targetId, candidateCampaignIds: [fixture.targetId],
      });
      const memberships = await database.campaignMembership.findMany({ where: { campaign: { ownerId: fixture.ownerId } } });
      expect(memberships).toHaveLength(2);
      expect(memberships.every((membership) => membership.campaignId === fixture.targetId && membership.source === 'AUTO')).toBe(true);
      if (writer === 'analysis') expect(canonical.analysis!.primaryTrend).toBe('UP_SIDEWAYS');
      if (writer === 'review') expect(canonical.analysis!.entryReason).toBe('writer review');
      if (writer === 'memo') expect(canonical.memo).toContain('writer memo');
      if (writer === 'upload') expect(canonical.images).toHaveLength(3);
      if (writer === 'reorder') expect(canonical.images.slice(0, 2).map((image) => image.id)).toEqual([...fixture.targetImageIds].reverse());
      if (writer === 'remove') expect(canonical.images.map((image) => image.id)).not.toContain(fixture.targetImageIds[0]);
      await expect(repair.reclassifyOwnedAccount(fixture.ownerId, fixture.accountId, true)).resolves.toEqual({
        moved: 0, deletedCampaigns: 0, conflicts: 0,
      });
    } finally {
      lockGate.release();
      await Promise.allSettled([repairClient.$disconnect(), writerClient.$disconnect()]);
      if (previousImageDir === undefined) delete process.env.TRADE_IMAGE_DIR;
      else process.env.TRADE_IMAGE_DIR = previousImageDir;
      if (imageDir) await rm(imageDir, { recursive: true, force: true });
    }
  }

  async function losingAlternateRace(
    writer: 'analysis' | 'review' | 'memo' | 'upload',
    winner: 'repair' | 'writer',
  ): Promise<void> {
    const fixture = await seedRepairRace();
    const previousImageDir = process.env.TRADE_IMAGE_DIR;
    const imageDir = await mkdtemp(join(tmpdir(), 'campaign-losing-race-images-'));
    process.env.TRADE_IMAGE_DIR = imageDir;
    const initialImages = await database.tradeCampaignImage.findMany({
      where: { campaignId: fixture.targetId },
      orderBy: { position: 'asc' },
    });
    await Promise.all(initialImages.map((image) => writeFile(join(imageDir, image.fileName), 'seed')));
    const repairClient = new PrismaClient({ datasources: { db: { url: url! } } });
    const writerClient = new PrismaClient({ datasources: { db: { url: url! } } });
    const lockGate = gate();
    const repair = new Mt5SyncService(
      transactionAwarePrisma(repairClient, winner === 'repair' ? lockGate : undefined) as never, {} as never, {} as never,
    );
    const log = new TradeLogService(transactionAwarePrisma(writerClient, winner === 'writer' ? lockGate : undefined) as never);
    const alternate = await database.tradeCampaign.findUniqueOrThrow({
      where: { id: fixture.alternateId },
      include: { analysis: true },
    });
    const uploadId = randomUUID();
    const writerCall = () => {
      if (writer === 'analysis') return log.patchCampaignAnalysis(fixture.ownerId, fixture.accountId, fixture.alternateId, {
        expectedUpdatedAt: alternate.analysis!.updatedAt.toISOString(), primaryTrend: 'down_sideways',
      });
      if (writer === 'review') return log.patchCampaignReview(fixture.ownerId, fixture.accountId, fixture.alternateId, {
        expectedReviewUpdatedAt: alternate.analysis!.reviewUpdatedAt.toISOString(), entryReason: 'alternate writer review',
      });
      if (writer === 'memo') return log.patchCampaignMemo(fixture.ownerId, fixture.accountId, fixture.alternateId, {
        expectedUpdatedAt: alternate.updatedAt.toISOString(), memo: 'alternate writer memo',
      });
      const gallery = new CampaignImageService(transactionAwarePrisma(writerClient, winner === 'writer' ? lockGate : undefined) as never);
      return gallery.upload(fixture.ownerId, fixture.accountId, fixture.alternateId, uploadId, {
        buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64'),
        mimetype: 'image/png', originalname: 'alternate-writer.png',
      } as Express.Multer.File);
    };
    try {
      const first = winner === 'repair'
        ? repair.reclassifyOwnedAccount(fixture.ownerId, fixture.accountId, true)
        : writerCall();
      await lockGate.acquired;
      const second = winner === 'repair'
        ? writerCall()
        : repair.reclassifyOwnedAccount(fixture.ownerId, fixture.accountId, true);
      await waitForPending(second);
      lockGate.release();

      if (winner === 'repair') {
        await first;
        try {
          await second;
          throw new Error('writer unexpectedly succeeded after losing campaign deletion');
        } catch (error) {
          expect([404, 409]).toContain((error as { status?: unknown }).status);
        }
      } else {
        await Promise.all([first, second]);
      }

      const canonical = await database.tradeCampaign.findUniqueOrThrow({
        where: { id: fixture.targetId },
        include: { analysis: { include: { archives: true } }, images: { orderBy: { position: 'asc' } } },
      });
      const archive = canonical.analysis!.archives.find((item) => item.source === `campaign-merge:${fixture.alternateId}`);
      expect(archive).toBeDefined();
      expect(await database.tradeCampaign.findUnique({ where: { id: fixture.alternateId } })).toBeNull();
      expect(await database.tradeCampaignImage.count({ where: { campaignId: fixture.alternateId } })).toBe(0);
      expect(await database.tradeCampaignImage.count({ where: { campaign: { ownerId: fixture.ownerId } } })).toBe(canonical.images.length);
      expect(canonical.images.map((image) => image.position)).toEqual(canonical.images.map((_, position) => position));
      expect(new Set(canonical.images.map((image) => image.id)).size).toBe(canonical.images.length);

      if (winner === 'writer') {
        if (writer === 'analysis') {
          expect(archive!.content).toEqual(expect.objectContaining({
            analysis: expect.objectContaining({ primaryTrend: 'DOWN_SIDEWAYS' }),
          }));
        }
        if (writer === 'review') {
          expect(archive!.content).toEqual(expect.objectContaining({
            analysis: expect.objectContaining({ entryReason: 'alternate writer review' }),
          }));
        }
        if (writer === 'memo') {
          expect(archive!.content).toEqual(expect.objectContaining({ memo: 'alternate writer memo' }));
        }
        if (writer === 'upload') {
          const uploaded = canonical.images.find((image) => image.uploadId === uploadId);
          expect(uploaded).toMatchObject({
            campaignId: fixture.targetId,
            uploadId,
            mimeType: 'image/webp',
            originalName: 'alternate-writer.png',
            publishedAt: expect.any(Date),
          });
        }
      } else {
        expect(canonical.memo).toBe('canonical memo');
        expect(canonical.analysis).toMatchObject({ primaryTrend: 'UP', entryReason: 'canonical review' });
        expect(canonical.images.map((image) => image.id)).toEqual(fixture.targetImageIds);
        if (writer === 'analysis') {
          expect(archive!.content).toEqual(expect.not.objectContaining({
            analysis: expect.objectContaining({ primaryTrend: 'DOWN_SIDEWAYS' }),
          }));
        }
        if (writer === 'review') {
          expect(archive!.content).toEqual(expect.not.objectContaining({
            analysis: expect.objectContaining({ entryReason: 'alternate writer review' }),
          }));
        }
        if (writer === 'memo') {
          expect(archive!.content).toEqual(expect.not.objectContaining({ memo: 'alternate writer memo' }));
        }
      }

      const fileNames = (await readdir(imageDir)).filter((name) => !name.endsWith('.tmp')).sort();
      expect(fileNames).toEqual(canonical.images.map((image) => image.fileName).sort());
      expect(await readdir(imageDir)).toEqual(expect.not.arrayContaining([expect.stringMatching(/\.tmp$/)]));
      await expect(repair.reclassifyOwnedAccount(fixture.ownerId, fixture.accountId, true)).resolves.toEqual({
        moved: 0, deletedCampaigns: 0, conflicts: 0,
      });
    } finally {
      lockGate.release();
      await Promise.allSettled([repairClient.$disconnect(), writerClient.$disconnect()]);
      if (previousImageDir === undefined) delete process.env.TRADE_IMAGE_DIR;
      else process.env.TRADE_IMAGE_DIR = previousImageDir;
      await rm(imageDir, { recursive: true, force: true });
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

  run('uses opening ticket before position ID when repairing equal-time campaigns', async () => {
    const ownerId = fixtureId('order-owner');
    const accountId = fixtureId('order-account');
    const openedAt = new Date('2026-08-01T00:00:00.000Z');
    await database.appUser.create({
      data: { id: ownerId, username: ownerId, normalizedUsername: ownerId, passwordHash: 'fixture', status: 'ACTIVE' },
    });
    await database.mt5Account.create({
      data: {
        id: accountId, ownerId, nickname: 'fixture', server: 'Broker Server', canonicalServer: 'broker server',
        accountLogin: 7201n, credentialCiphertext: Buffer.from('ciphertext'), credentialIv: Buffer.from('iv'),
        credentialTag: Buffer.from('tag'), credentialVersion: 1,
      },
    });
    for (const row of [
      { tradeId: fixtureId('ticket-root'), campaignId: fixtureId('ticket-campaign'), positionId: 99n, ticket: 10n },
      { tradeId: fixtureId('position-root'), campaignId: fixtureId('position-campaign'), positionId: 1n, ticket: 20n },
    ]) {
      await database.trade.create({
        data: {
          id: row.tradeId, ownerId, mt5AccountId: accountId, symbol: 'EURUSD', side: 'LONG', status: 'OPEN',
          openedAt, mt5Server: 'Broker Server', mt5ServerCanonical: 'broker server', mt5AccountLogin: 7201n,
          mt5PositionId: row.positionId, analysis: { create: { baseTimeframe: '1h' } },
          campaignRoot: { create: { id: row.campaignId, ownerId, mt5AccountId: accountId, tradingDate: openedAt } },
          campaignMembership: { create: { campaignId: row.campaignId, source: 'AUTO' } },
        },
      });
      await database.mt5Deal.create({
        data: {
          accountId, server: 'Broker Server', accountLogin: 7201n, ticket: row.ticket, order: row.ticket,
          positionId: row.positionId, time: 1_754_006_400n, timeMsc: 1_754_006_400_000n, timeUtc: openedAt,
          timeMscUtc: openedAt, type: 0, entry: 0, magic: 0n, reason: 0, volume: 1, price: 1,
          commission: 0, swap: 0, profit: 0, fee: 0, symbol: 'EURUSD', comment: '', externalId: '',
          fetchedAt: openedAt, rawJson: {},
        },
      });
    }
    const service = new Mt5SyncService(database as never, {} as never, {} as never);
    await expect(service.reclassifyOwnedAccount(ownerId, accountId, true)).resolves.toEqual({
      moved: 1, deletedCampaigns: 1, conflicts: 0,
    });
    const memberships = await database.campaignMembership.findMany({
      where: { trade: { ownerId } },
      orderBy: { trade: { mt5PositionId: 'desc' } },
    });
    expect(memberships.map((membership) => membership.campaignId)).toEqual([
      fixtureId('ticket-campaign'), fixtureId('ticket-campaign'),
    ]);
  });

  for (const writer of ['analysis', 'review', 'memo', 'upload', 'reorder', 'remove'] as const) {
    run(`serializes authored campaign repair before the ${writer} writer`, async () => {
      await repairRace(writer, 'repair');
    });
    run(`serializes the ${writer} writer before authored campaign repair`, async () => {
      await repairRace(writer, 'writer');
    });
  }

  for (const writer of ['analysis', 'review', 'memo', 'upload'] as const) {
    run(`serializes the losing alternate ${writer} writer before authored campaign repair`, async () => {
      await losingAlternateRace(writer, 'writer');
    });
    run(`rejects the losing alternate ${writer} writer after authored campaign repair`, async () => {
      await losingAlternateRace(writer, 'repair');
    });
  }
});
