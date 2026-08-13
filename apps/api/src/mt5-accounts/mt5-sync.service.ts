import { ConflictException, Inject, Injectable, Logger, NotFoundException, Optional, UnauthorizedException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { CampaignClassificationPreview, Mt5SyncResponse, TradeExitReason } from '@trading-journal/shared';
import { Prisma, TradeSide, TradeStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CredentialCipherService } from './credential-cipher.service';
import { lockOwnedMt5Account } from './mt5-account-lock';
import { Mt5AccountAuthorizationRejected, Mt5BridgeClient, Mt5BridgeUnauthorized, Mt5DealFact, Mt5OrderFact, Mt5PositionEntryPlanFact } from './mt5-bridge.client';
import { calculateTradePlanMetrics } from '../trade-log/trade-plan-metrics';

const LEASE_MS = 5 * 60_000;
const UNCORRECTED_TIME_LOOKAHEAD_MS = 24 * 60 * 60 * 1000;
class StaleSyncResult extends Error {}
const DEAL_FACT_FIELDS = ['ticket', 'order', 'positionId', 'time', 'timeMsc', 'type', 'entry', 'magic', 'reason', 'volume', 'price', 'commission', 'swap', 'profit', 'fee', 'symbol', 'comment', 'externalId'] as const;
const ORDER_FACT_FIELDS = ['ticket', 'positionId', 'timeSetup', 'timeSetupMsc', 'timeDone', 'timeDoneMsc', 'type', 'state', 'reason', 'volumeInitial', 'volumeCurrent', 'priceOpen', 'sl', 'tp', 'priceCurrent', 'priceStopLimit', 'symbol', 'comment', 'externalId'] as const;

function canonicalFact(value: unknown, fields: readonly string[]): string {
  const fact = value as Record<string, unknown>;
  return JSON.stringify(fields.map((field) => [field, fact[field]]));
}
const METRIC_CONTRACT_VERSION = 1;
const BALANCE_LEDGER_VERSION = 1;
const FULL_HISTORY_FROM_MSC = 0;
const INCREMENTAL_OVERLAP_MS = 72 * 60 * 60 * 1000;
const CAMPAIGN_RECLASSIFICATION_TIMEOUT_MS = 60_000;

export const EXCURSION_WORK_PRODUCER = Symbol('EXCURSION_WORK_PRODUCER');
export const EXCURSION_WORKER_WAKE = Symbol('EXCURSION_WORKER_WAKE');

export type SyncExcursionTarget = {
  scope: 'TRADE' | 'CAMPAIGN';
  targetId: string;
  generation: number;
  baseInputFingerprint: string;
  tickSnapshotToMsc: bigint;
};

export interface ExcursionWorkProducer {
  dirtyTargets(
    tx: Prisma.TransactionClient,
    accountId: string,
    snapshotToMsc: bigint,
    targets: readonly SyncExcursionTarget[],
    reason: string,
  ): Promise<{ queued: number }>;
}

export interface ExcursionWorkerWake {
  runOne(): Promise<Partial<{
    processed: number;
    succeeded: number;
    stale: number;
    failed: number;
    deferred: number;
    reasons: Array<{ reason: string; count: number }>;
  }>>;
}

export function mt5DealReason(reason: number): TradeExitReason {
  switch (reason) {
    case 0:
    case 1:
    case 2:
      return 'manual';
    case 3:
      return 'automated';
    case 4:
      return 'stop_loss';
    case 5:
      return 'target_hit';
    case 6:
      return 'forced_liquidation';
    case 7:
      return 'rollover';
    case 8:
      return 'variation_margin';
    case 9:
      return 'split';
    case 10:
      return 'corporate_action';
    default:
      return 'other';
  }
}


export const seoulTradingDate = (value: Date): Date => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  return new Date(`${part('year')}-${part('month')}-${part('day')}T00:00:00.000Z`);
};

export type CampaignOpeningKey = { timeMsc: bigint; ticket: bigint; positionId: bigint };
export const compareCampaignOpeningKey = (left: CampaignOpeningKey, right: CampaignOpeningKey): number => {
  if (left.timeMsc !== right.timeMsc) return left.timeMsc < right.timeMsc ? -1 : 1;
  if (left.ticket !== right.ticket) return left.ticket < right.ticket ? -1 : 1;
  if (left.positionId !== right.positionId) return left.positionId < right.positionId ? -1 : 1;
  return 0;
};

@Injectable()
export class Mt5SyncService {
  private readonly logger = new Logger(Mt5SyncService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: CredentialCipherService,
    private readonly bridge: Mt5BridgeClient,
    @Optional() @Inject(EXCURSION_WORK_PRODUCER) private readonly excursionWorkProducer?: ExcursionWorkProducer,
    @Optional() @Inject(EXCURSION_WORKER_WAKE) private readonly excursionWorkerWake?: ExcursionWorkerWake,
  ) {}

  async sync(ownerId: string, accountId: string, forceFull = false): Promise<Mt5SyncResponse> {
    const claimed = await this.claim(ownerId, accountId, forceFull);
    if (!claimed) {
      const status = await this.prisma.mt5SyncStatus.findUnique({ where: { accountId }, select: { mode: true, snapshotToMsc: true, pageCursor: true } });
      return {
        state: 'in_progress', accountId, message: 'Synchronization is already in progress',
        ...(status?.mode && status.snapshotToMsc !== null && {
          progress: { mode: status.mode as 'bootstrap' | 'incremental', snapshotToMsc: Number(status.snapshotToMsc), ...(status.pageCursor && { pageCursor: status.pageCursor }) },
        }),
      };
    }

    const { account, leaseId, status } = claimed;
    try {
      const password = this.cipher.decrypt({
        ciphertext: Buffer.from(account.credentialCiphertext),
        iv: Buffer.from(account.credentialIv),
        tag: Buffer.from(account.credentialTag),
        version: account.credentialVersion,
      });
      const resumed = status?.mode && status.snapshotToMsc !== null && status.snapshotToMsc !== undefined;
      const rebuildStartedAt = status?.rebuildStartedAt ?? null;
      const mode = rebuildStartedAt
        ? 'bootstrap'
        : resumed
          ? status!.mode as 'bootstrap' | 'incremental'
          : status?.lastSuccessfulSnapshotMsc ? 'incremental' : 'bootstrap';
      const snapshotToMsc = resumed ? Number(status!.snapshotToMsc) : Date.now() + UNCORRECTED_TIME_LOOKAHEAD_MS;
      const changedSinceMsc = mode === 'incremental'
        ? (resumed ? Number(status!.changedSinceMsc) : Math.max(0, Number(status!.lastSuccessfulSnapshotMsc) - INCREMENTAL_OVERLAP_MS))
        : undefined;
      const persistedOpenPositionIds = Array.isArray(status?.openPositionIds)
        && status.openPositionIds.every((value): value is string => typeof value === 'string')
        ? status.openPositionIds
        : undefined;
      const openPositionIds = mode === 'incremental'
        ? resumed && persistedOpenPositionIds
          ? persistedOpenPositionIds
          : (await this.prisma.trade.findMany({ where: { mt5AccountId: accountId, status: TradeStatus.OPEN, mt5PositionId: { not: null } }, select: { mt5PositionId: true } }))
            .map((trade) => trade.mt5PositionId!.toString())
            .sort((left, right) => {
              const a = BigInt(left);
              const b = BigInt(right);
              return a < b ? -1 : a > b ? 1 : 0;
            })
        : undefined;
      let pageCursor = resumed ? status!.pageCursor ?? undefined : undefined;
      let receivedCount = 0;
      let importedCount = 0;
      let finalPayload: Awaited<ReturnType<Mt5BridgeClient['sync']>> | undefined;
      while (!finalPayload) {
        const payload = await this.bridge.sync({
          contractVersion: 5, server: account.server, accountLogin: Number(account.accountLogin), password, mode, snapshotToMsc,
          ...(pageCursor !== undefined && { pageCursor }),
          ...(changedSinceMsc !== undefined && { changedSinceMsc }),
          ...(openPositionIds !== undefined && { openPositionIds }),
        });
        const renewed = await this.prisma.mt5SyncLease.updateMany({
          where: { accountId, leaseId, expiresAt: { gt: new Date() } },
          data: { expiresAt: new Date(Date.now() + LEASE_MS) },
        });
        if (renewed.count !== 1) throw new StaleSyncResult();
        const syncedAt = new Date();
        const pageResult = await this.prisma.$transaction(async (tx) => {
        const lockedAccount = await lockOwnedMt5Account(tx, ownerId, accountId);
        if (lockedAccount.canonicalServer !== account.canonicalServer || lockedAccount.accountLogin !== account.accountLogin) throw new StaleSyncResult();
        const fenceAt = new Date();
        const liveAccount = await tx.mt5Account.findFirst({
          where: {
            id: accountId,
            ownerId,
            active: true,
            canonicalServer: lockedAccount.canonicalServer,
            server: account.server,
            accountLogin: lockedAccount.accountLogin,
            credentialVersion: account.credentialVersion,
            credentialCiphertext: { equals: account.credentialCiphertext },
            credentialIv: { equals: account.credentialIv },
            credentialTag: { equals: account.credentialTag },
            lease: { leaseId, expiresAt: { gt: fenceAt } },
          },
        });
        if (!liveAccount) throw new StaleSyncResult();

        const changedPositions = new Set<string>();
        for (const deal of payload.deals) if (await this.upsertDeal(tx, accountId, account.canonicalServer, account.accountLogin, deal, syncedAt, account.timeCorrectionHours ?? 0, rebuildStartedAt !== null)) changedPositions.add(deal.positionId);
        for (const order of payload.orders) if (await this.upsertOrder(tx, accountId, account.canonicalServer, account.accountLogin, order, syncedAt, account.timeCorrectionHours ?? 0, rebuildStartedAt !== null)) changedPositions.add(order.positionId);
        receivedCount += payload.deals.length;
        if (payload.page.hasMore) {
          let projected = 0;
          if (mode === 'incremental' && changedPositions.size) {
            const ledger = await this.rebuildBalanceLedger(
              tx,
              accountId,
              account.canonicalServer,
              account.accountLogin,
              payload.account.currency,
              payload.account.currencyDigits,
              payload.account.currentBalance,
              { fromMsc: changedSinceMsc!, toMsc: snapshotToMsc },
              syncedAt,
            );
            projected = await this.projectTrades(
              tx,
              ownerId,
              accountId,
              account.server,
              account.canonicalServer,
              account.accountLogin,
              [...changedPositions],
              ledger.assertions,
              [],
            );
          }
          await tx.mt5SyncStatus.upsert({
            where: { server_accountLogin: { server: account.canonicalServer, accountLogin: account.accountLogin } },
            create: { accountId, server: account.canonicalServer, accountLogin: account.accountLogin, mode, snapshotToMsc: BigInt(snapshotToMsc), pageCursor: payload.page.nextCursor, changedSinceMsc: changedSinceMsc === undefined ? null : BigInt(changedSinceMsc), openPositionIds: openPositionIds ?? Prisma.JsonNull, lastReceivedDealCount: payload.deals.length },
            update: { mode, snapshotToMsc: BigInt(snapshotToMsc), pageCursor: payload.page.nextCursor, changedSinceMsc: changedSinceMsc === undefined ? null : BigInt(changedSinceMsc), openPositionIds: openPositionIds ?? Prisma.JsonNull, lastReceivedDealCount: payload.deals.length, lastError: null },
          });
          const deleted = await tx.mt5SyncLease.deleteMany({ where: { accountId, leaseId, expiresAt: { gt: new Date() } } });
          if (deleted.count !== 1) throw new StaleSyncResult();
          return { importedCount: projected, ledger: null };
        }
        let fullRebuild: Mt5SyncResponse['fullRebuild'];
        if (rebuildStartedAt) {
          const [removedDeals, removedOrders] = await Promise.all([
            tx.mt5Deal.deleteMany({ where: { accountId, fetchedAt: { lt: rebuildStartedAt } } }),
            tx.mt5Order.deleteMany({ where: { accountId, fetchedAt: { lt: rebuildStartedAt } } }),
          ]);
          const presentPositions = await tx.mt5Deal.findMany({
            where: { accountId, positionId: { gt: 0 } },
            distinct: ['positionId'],
            select: { positionId: true },
          });
          const presentIds = presentPositions.map((row) => row.positionId);
          const sourceMissing = await tx.trade.updateMany({
            where: {
              mt5AccountId: accountId,
              mt5PositionId: presentIds.length ? { notIn: presentIds } : { not: null },
              mt5SourceMissingAt: null,
            },
            data: { mt5SourceMissingAt: syncedAt },
          });
          fullRebuild = {
            removedDeals: removedDeals.count,
            removedOrders: removedOrders.count,
            sourceMissingTrades: sourceMissing.count,
          };
        }
        const ledger = await this.rebuildBalanceLedger(tx, accountId, account.canonicalServer, account.accountLogin, payload.account.currency, payload.account.currencyDigits, payload.account.currentBalance, { fromMsc: mode === 'bootstrap' ? FULL_HISTORY_FROM_MSC : changedSinceMsc!, toMsc: snapshotToMsc }, syncedAt);
        if (rebuildStartedAt && !ledger.verified) throw new Error('MT5 full rebuild balance verification failed');
        if (mode === 'bootstrap' || ledger.verified) {
          for (const positionId of ledger.positionIds) changedPositions.add(positionId);
        }
        const projected = await this.projectTrades(tx, ownerId, accountId, account.server, account.canonicalServer, account.accountLogin, [...changedPositions], ledger.assertions, []);
        const lastDealTime = payload.deals.length ? new Date(Math.max(...payload.deals.map((deal) => deal.timeMsc))) : undefined;
        await tx.mt5SyncStatus.upsert({
          where: { server_accountLogin: { server: account.canonicalServer, accountLogin: account.accountLogin } },
          create: { accountId, server: account.canonicalServer, accountLogin: account.accountLogin, lastSyncAt: syncedAt, lastSuccessfulSnapshotMsc: BigInt(snapshotToMsc), lastDealTime, lastReceivedDealCount: payload.deals.length },
          update: { mode: null, snapshotToMsc: null, pageCursor: null, changedSinceMsc: null, openPositionIds: Prisma.JsonNull, rebuildStartedAt: null, lastSyncAt: syncedAt, lastSuccessfulSnapshotMsc: BigInt(snapshotToMsc), ...(lastDealTime && { lastDealTime }), lastReceivedDealCount: payload.deals.length, lastError: null },
        });
        const excursions = this.excursionWorkProducer
          ? await this.enqueueFinalExcursionWork(tx, accountId, BigInt(snapshotToMsc), 'SYNC_CHANGED')
          : {
            mode: 'disabled' as const,
            queued: 0,
            processed: 0,
            succeeded: 0,
            stale: 0,
            failed: 0,
            deferred: 0,
            reasons: [],
          };
        const deleted = await tx.mt5SyncLease.deleteMany({ where: { accountId, leaseId, expiresAt: { gt: new Date() } } });
        if (deleted.count !== 1) throw new StaleSyncResult();
        return { importedCount: projected, ledger, excursions, fullRebuild };
      }, { maxWait: 10_000, timeout: 4 * 60_000 });
        importedCount += pageResult.importedCount;
        if (payload.page.hasMore) {
          return {
            state: 'in_progress',
            accountId,
            receivedCount,
            message: 'Synchronization has more history pages',
            progress: { mode, snapshotToMsc, pageCursor: payload.page.nextCursor },
          };
        }
        finalPayload = payload;
        const queuedExcursions = pageResult.excursions ?? {
          mode: 'disabled' as const, queued: 0, processed: 0, succeeded: 0,
          stale: 0, failed: 0, deferred: 0, reasons: [],
        };
        let excursions: Mt5SyncResponse['excursions'] = queuedExcursions;
        if (this.excursionWorkerWake && queuedExcursions.mode !== 'disabled') {
          try {
            const summary = await this.excursionWorkerWake.runOne();
            excursions = {
              mode: 'processed',
              queued: queuedExcursions.queued,
              processed: summary.processed ?? 0,
              succeeded: summary.succeeded ?? 0,
              stale: summary.stale ?? 0,
              failed: summary.failed ?? 0,
              deferred: summary.deferred ?? 0,
              reasons: summary.reasons ?? [],
            };
          } catch {
            // Work is durable before the lease is released; startup/periodic recovery retries it.
            excursions = {
              mode: 'queued',
              queued: queuedExcursions.queued,
              processed: 0,
              succeeded: 0,
              stale: 0,
              failed: 0,
              deferred: queuedExcursions.queued,
              reasons: [{ reason: 'WORKER_WAKE_FAILED', count: 1 }],
            };
          }
        }
        return {
          state: 'completed', accountId, importedCount, receivedCount, syncedAt: syncedAt.toISOString(),
          excursions,
          balanceLedger: {
            status: pageResult.ledger!.verified ? 'verified' : 'diverged',
            currency: payload.account.currency, calculatedBalance: Number(pageResult.ledger!.calculatedBalance), currentBalance: Number(payload.account.currentBalance),
          },
          ...(pageResult.fullRebuild && { fullRebuild: pageResult.fullRebuild }),
        } as Mt5SyncResponse;
      }
      throw new Error('MT5 synchronization ended without a final page');
    } catch (error) {
      this.logger.error(`MT5 sync failed for account ${accountId}: ${this.safeErrorCategory(error)}`, error instanceof Error ? error.stack : undefined);
      if (error instanceof StaleSyncResult) {
        await this.prisma.mt5SyncLease.deleteMany({ where: { accountId, leaseId } });
        return { state: 'failed', accountId, message: 'Synchronization result expired' };
      }
      await this.prisma.$transaction([
        this.prisma.mt5SyncLease.deleteMany({ where: { accountId, leaseId } }),
        this.prisma.mt5SyncStatus.updateMany({ where: { accountId }, data: { lastError: this.safeErrorCategory(error) } }),
      ]);
      const category = this.safeErrorCategory(error);
      const message = category === 'MT5_SYNC_BRIDGE_UNAUTHORIZED'
        ? 'MT5 브리지 인증 토큰이 일치하지 않습니다. 브리지와 API의 MT5_BRIDGE_TOKEN을 동일하게 설정하세요.'
        : category === 'MT5_SYNC_ACCOUNT_AUTHORIZATION_REJECTED'
          ? 'MT5 계좌 인증에 실패했습니다. 서버명, 계좌번호, 읽기 전용 비밀번호를 확인하세요.'
        : 'MT5 synchronization failed';
      return { state: 'failed', accountId, message };
    }
  }

  private async enqueueFinalExcursionWork(
    tx: Prisma.TransactionClient,
    accountId: string,
    snapshotToMsc: bigint,
    reason: string,
  ): Promise<NonNullable<Mt5SyncResponse['excursions']>> {
    if (process.env.MT5_EXCURSION_WRITE_ENABLED !== 'true') {
      return { mode: 'disabled', queued: 0, processed: 0, succeeded: 0, stale: 0, failed: 0, deferred: 0, reasons: [] };
    }
    const trades = await tx.trade.findMany({
      where: { mt5AccountId: accountId, closedAt: { not: null } },
      select: {
        id: true, updatedAt: true, openedAt: true, closedAt: true, status: true, side: true, symbol: true,
        quantityLots: true, entryPrice: true, exitPrice: true, riskAmount: true, riskPercent: true,
        initialPlanId: true, initialPlanMetricContractVersion: true,
      },
    });
    const campaigns = await tx.tradeCampaign.findMany({
      where: {
        mt5AccountId: accountId,
        memberships: { some: {}, every: { trade: { closedAt: { not: null } } } },
      },
      select: { id: true, version: true, updatedAt: true, rootTradeId: true },
    });
    const existing = await tx.excursionWorkItem.findMany({
      where: { accountId, OR: [{ targetId: { in: trades.map((trade) => trade.id) } }, { targetId: { in: campaigns.map((campaign) => campaign.id) } }] },
      select: { targetId: true, generation: true, baseInputFingerprint: true, tickSnapshotToMsc: true },
    });
    const previous = new Map(existing.map((work) => [work.targetId, work]));
    const target = (scope: SyncExcursionTarget['scope'], targetId: string, basis: unknown): SyncExcursionTarget => {
      const baseInputFingerprint = createHash('sha256').update(JSON.stringify(basis, (_, value) =>
        typeof value === 'bigint' ? value.toString() : value,
      )).digest('hex');
      const prior = previous.get(targetId);
      const unchanged = prior?.baseInputFingerprint === baseInputFingerprint && prior.tickSnapshotToMsc === snapshotToMsc;
      return {
        scope,
        targetId,
        generation: unchanged ? prior!.generation : (prior?.generation ?? 0) + 1,
        baseInputFingerprint,
        tickSnapshotToMsc: snapshotToMsc,
      };
    };
    const targets = [
      ...trades.map((trade) => target('TRADE', trade.id, trade)),
      ...campaigns.map((campaign) => target('CAMPAIGN', campaign.id, campaign)),
    ];
    const result = await this.excursionWorkProducer!.dirtyTargets(tx, accountId, snapshotToMsc, targets, reason);
    return {
      mode: 'queued',
      queued: result.queued,
      processed: 0,
      succeeded: 0,
      stale: 0,
      failed: 0,
      deferred: 0,
      reasons: [],
    };
  }

  private async claim(ownerId: string, accountId: string, forceFull: boolean) {
    const now = new Date();
    const leaseId = randomUUID();
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM mt5_accounts WHERE id = ${accountId} FOR UPDATE`);
      const account = await tx.mt5Account.findFirst({ where: { id: accountId, ownerId, active: true } });
      if (!account) throw new NotFoundException('MT5 account not found');
      await tx.mt5SyncLease.deleteMany({ where: { accountId, expiresAt: { lte: now } } });
      try {
        await tx.mt5SyncLease.create({ data: { accountId, leaseId, claimedAt: now, expiresAt: new Date(now.getTime() + LEASE_MS) } });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return null;
        throw error;
      }
      let status = await tx.mt5SyncStatus.findUnique({ where: { accountId } });
      if (forceFull && !status?.rebuildStartedAt) {
        status = await tx.mt5SyncStatus.upsert({
          where: { server_accountLogin: { server: account.canonicalServer, accountLogin: account.accountLogin } },
          create: {
            accountId,
            server: account.canonicalServer,
            accountLogin: account.accountLogin,
            mode: 'bootstrap',
            rebuildStartedAt: now,
          },
          update: {
            mode: 'bootstrap',
            snapshotToMsc: null,
            pageCursor: null,
            changedSinceMsc: null,
            openPositionIds: Prisma.JsonNull,
            rebuildStartedAt: now,
            lastError: null,
          },
        });
      }
      return { account, leaseId, status };
    });
  }

  private async upsertDeal(tx: Prisma.TransactionClient, accountId: string, server: string, accountLogin: bigint, deal: Mt5DealFact, fetchedAt: Date, correctionHours: number, touchFetchedAt = false) {
    const key = { server_accountLogin_ticket: { server, accountLogin, ticket: BigInt(deal.ticket) } };
    const existing = await tx.mt5Deal.findUnique({ where: key, select: { rawJson: true, timeMscUtc: true } });
    const correctedTimeMsc = new Date(deal.timeMsc + correctionHours * 3_600_000);
    if (existing && canonicalFact(existing.rawJson, DEAL_FACT_FIELDS) === canonicalFact(deal, DEAL_FACT_FIELDS)
      && existing.timeMscUtc.getTime() === correctedTimeMsc.getTime()) {
      if (touchFetchedAt) await tx.mt5Deal.update({ where: key, data: { fetchedAt } });
      return false;
    }
    const data = {
      accountId, server, accountLogin, ticket: BigInt(deal.ticket), order: BigInt(deal.order), positionId: BigInt(deal.positionId),
      time: BigInt(deal.time), timeMsc: BigInt(deal.timeMsc), timeUtc: new Date(deal.time * 1000 + correctionHours * 3_600_000), timeMscUtc: correctedTimeMsc,
      type: deal.type, entry: deal.entry, magic: BigInt(deal.magic), reason: deal.reason, volume: deal.volume, price: deal.price,
      commission: deal.commission, swap: deal.swap, profit: deal.profit, fee: deal.fee, symbol: deal.symbol, comment: deal.comment,
      externalId: deal.externalId, fetchedAt, rawJson: deal as unknown as Prisma.InputJsonValue,
    };
    await tx.mt5Deal.upsert({ where: key, create: data, update: data });
    return true;
  }

  private async upsertOrder(tx: Prisma.TransactionClient, accountId: string, server: string, accountLogin: bigint, order: Mt5OrderFact, fetchedAt: Date, correctionHours: number, touchFetchedAt = false) {
    const key = { server_accountLogin_ticket: { server, accountLogin, ticket: BigInt(order.ticket) } };
    const existing = await tx.mt5Order.findUnique({ where: key, select: { rawJson: true, timeSetupMscUtc: true, timeDoneMscUtc: true } });
    const correctedSetup = new Date(order.timeSetupMsc + correctionHours * 3_600_000);
    const correctedDone = new Date(order.timeDoneMsc + correctionHours * 3_600_000);
    if (existing && canonicalFact(existing.rawJson, ORDER_FACT_FIELDS) === canonicalFact(order, ORDER_FACT_FIELDS)
      && existing.timeSetupMscUtc.getTime() === correctedSetup.getTime()
      && existing.timeDoneMscUtc.getTime() === correctedDone.getTime()) {
      if (touchFetchedAt) await tx.mt5Order.update({ where: key, data: { fetchedAt } });
      return false;
    }
    const data = {
      accountId, server, accountLogin, ticket: BigInt(order.ticket), positionId: BigInt(order.positionId),
      timeSetup: BigInt(order.timeSetup), timeSetupMsc: BigInt(order.timeSetupMsc), timeSetupUtc: new Date(order.timeSetup * 1000 + correctionHours * 3_600_000), timeSetupMscUtc: correctedSetup,
      timeDone: BigInt(order.timeDone), timeDoneMsc: BigInt(order.timeDoneMsc), timeDoneUtc: new Date(order.timeDone * 1000 + correctionHours * 3_600_000), timeDoneMscUtc: correctedDone,
      type: order.type, state: order.state, reason: order.reason, volumeInitial: order.volumeInitial, volumeCurrent: order.volumeCurrent,
      priceOpen: order.priceOpen, sl: order.sl, tp: order.tp, priceCurrent: order.priceCurrent, priceStopLimit: order.priceStopLimit,
      symbol: order.symbol, comment: order.comment, externalId: order.externalId, fetchedAt, rawJson: order as unknown as Prisma.InputJsonValue,
    };
    await tx.mt5Order.upsert({ where: key, create: data, update: data });
    return true;
  }

  private isOpeningExecution(deal: { entry: number; type: number }): boolean {
    return deal.entry === 0 && (deal.type === 0 || deal.type === 1);
  }

  private async rebuildBalanceLedger(
    tx: Prisma.TransactionClient,
    accountId: string,
    server: string,
    accountLogin: bigint,
    currency: string,
    currencyDigits: number,
    currentBalanceValue: string,
    historyRange: { fromMsc: number; toMsc: number },
    fetchedAt: Date,
  ): Promise<{
    positionIds: string[];
    assertions: Array<{ positionId: string; state: string; preEntryBalance?: string }>;
    verified: boolean;
    calculatedBalance: Prisma.Decimal;
  }> {
    const deals = await tx.mt5Deal.findMany({
      where: { accountId, server, accountLogin },
      orderBy: [{ timeMsc: 'asc' }, { ticket: 'asc' }],
      select: {
        ticket: true, order: true, positionId: true, timeMsc: true, timeMscUtc: true,
        type: true, entry: true, profit: true, commission: true, swap: true, fee: true,
      },
    });
    let balance = new Prisma.Decimal(0);
    const events: Prisma.Mt5AccountBalanceEventCreateManyInput[] = [];
    const balancesBefore = new Map<string, Prisma.Decimal>();
    for (const deal of deals) {
      const before = balance;
      balancesBefore.set(deal.ticket.toString(), before);
      // MT5 DEAL_TYPE_CREDIT (3) is reported separately as account credit and
      // is not part of account_info().balance. All other deal types can carry
      // balance-affecting profit/cost components.
      const delta = (deal.type === 3 ? new Prisma.Decimal(0) : deal.profit.plus(deal.commission).plus(deal.swap).plus(deal.fee))
        .toDecimalPlaces(currencyDigits, Prisma.Decimal.ROUND_HALF_UP);
      balance = before.plus(delta).toDecimalPlaces(currencyDigits, Prisma.Decimal.ROUND_HALF_UP);
      events.push({
        accountId, server, accountLogin, dealTicket: deal.ticket,
        occurredAtMsc: deal.timeMsc, occurredAtUtc: deal.timeMscUtc,
        balanceDelta: delta, balanceBefore: before, balanceAfter: balance,
        currency, ledgerVersion: BALANCE_LEDGER_VERSION, fetchedAt,
      });
    }

    const currentBalance = new Prisma.Decimal(currentBalanceValue).toDecimalPlaces(currencyDigits, Prisma.Decimal.ROUND_HALF_UP);
    // This ledger is rebuilt from every raw Deal persisted for the account.
    // The bridge request overlap is therefore not the ledger coverage boundary.
    const verified = balance.equals(currentBalance);
    await tx.mt5AccountBalanceEvent.deleteMany({ where: { accountId } });
    if (events.length) await tx.mt5AccountBalanceEvent.createMany({ data: events });
    await tx.mt5AccountBalanceLedgerState.upsert({
      where: { accountId },
      create: {
        accountId, server, accountLogin, currency, currencyDigits, calculatedBalance: balance, currentBalance,
        historyFromMsc: BigInt(FULL_HISTORY_FROM_MSC), historyToMsc: BigInt(historyRange.toMsc),
        ledgerVersion: BALANCE_LEDGER_VERSION, status: verified ? 'VERIFIED' : 'DIVERGED',
        lastVerifiedAt: verified ? fetchedAt : null,
        lastError: verified ? null : 'CALCULATED_BALANCE_MISMATCH',
      },
      update: {
        server, accountLogin, currency, currencyDigits, calculatedBalance: balance, currentBalance,
        historyFromMsc: BigInt(FULL_HISTORY_FROM_MSC), historyToMsc: BigInt(historyRange.toMsc),
        ledgerVersion: BALANCE_LEDGER_VERSION, status: verified ? 'VERIFIED' : 'DIVERGED',
        ...(verified && { lastVerifiedAt: fetchedAt }),
        lastError: verified ? null : 'CALCULATED_BALANCE_MISMATCH',
      },
    });

    const byPosition = new Map<string, typeof deals>();
    for (const deal of deals) {
      if (deal.positionId <= 0n) continue;
      const positionId = deal.positionId.toString();
      const rows = byPosition.get(positionId) ?? [];
      rows.push(deal);
      byPosition.set(positionId, rows);
    }
    if (!verified) {
      const persisted = await tx.mt5PositionEntryBalance.findMany({
        where: { accountId, state: 'PROVEN', preEntryBalance: { not: null } },
        select: { positionId: true, state: true, preEntryBalance: true },
      });
      return {
        positionIds: [...byPosition.keys()],
        assertions: persisted.map((row) => ({
          positionId: row.positionId.toString(),
          state: row.state,
          preEntryBalance: row.preEntryBalance!.toString(),
        })),
        verified,
        calculatedBalance: balance,
      };
    }
    await tx.mt5PositionEntryBalance.deleteMany({ where: { accountId } });
    const assertions: Array<{ positionId: string; state: string; preEntryBalance?: string }> = [];
    for (const [positionId, positionDeals] of byPosition) {
      const opening = positionDeals.find((deal) => this.isOpeningExecution(deal));
      if (!opening) {
        await tx.mt5PositionEntryBalance.create({
          data: {
            accountId, server, accountLogin, positionId: BigInt(positionId),
            entryDealTicket: null, entryOrderTicket: null, entryTimeMsc: null, entryTimeMscUtc: null,
            ledgerSemanticsVersion: BALANCE_LEDGER_VERSION, state: 'UNSUPPORTED_UNANCHORED',
            preEntryBalance: null, reason: 'OPENING_DEAL_OUTSIDE_HISTORY', fetchedAt,
          },
        });
        assertions.push({ positionId, state: 'UNSUPPORTED_UNANCHORED' });
        continue;
      }
      const preEntryBalance = balancesBefore.get(opening.ticket.toString());
      const state = verified && preEntryBalance ? 'PROVEN' : 'UNSUPPORTED_ANCHORED';
      await tx.mt5PositionEntryBalance.create({
        data: {
          accountId, server, accountLogin, positionId: BigInt(positionId),
          entryDealTicket: opening.ticket, entryOrderTicket: opening.order,
          entryTimeMsc: opening.timeMsc, entryTimeMscUtc: opening.timeMscUtc,
          ledgerSemanticsVersion: BALANCE_LEDGER_VERSION, state,
          preEntryBalance: state === 'PROVEN' ? preEntryBalance : null,
          reason: state === 'PROVEN' ? null : 'UNSUPPORTED_CHECKPOINT', fetchedAt,
        },
      });
      assertions.push({
        positionId,
        state,
        ...(state === 'PROVEN' && { preEntryBalance: preEntryBalance!.toString() }),
      });
    }
    return { positionIds: [...byPosition.keys()], assertions, verified, calculatedBalance: balance };
  }
  private async projectTrades(tx: Prisma.TransactionClient, ownerId: string, accountId: string, exactServer: string, canonicalServer: string, accountLogin: bigint, positionIds: string[], assertions: Array<{ positionId: string; state: string; preEntryBalance?: string }>, incomingPlans: Mt5PositionEntryPlanFact[]): Promise<number> {
    const requestedPositionIds = [...new Set(positionIds.filter((id) => BigInt(id) > 0n))];
    const openingDeals = await tx.mt5Deal.findMany({
      where: {
        server: canonicalServer,
        accountLogin,
        positionId: { in: requestedPositionIds.map(BigInt) },
        entry: 0,
        type: { in: [0, 1] },
      },
      orderBy: [{ timeMsc: 'asc' }, { ticket: 'asc' }],
      select: { positionId: true, timeMsc: true, ticket: true },
    });
    const openingByPosition = new Map<string, { timeMsc: bigint; ticket: bigint }>();
    for (const deal of openingDeals) {
      const id = deal.positionId.toString();
      if (!openingByPosition.has(id)) openingByPosition.set(id, deal);
    }
    const uniquePositionIds = requestedPositionIds.sort((left, right) => {
      const a = openingByPosition.get(left);
      const b = openingByPosition.get(right);
      if (a && b) return compareCampaignOpeningKey(
        { ...a, positionId: BigInt(left) },
        { ...b, positionId: BigInt(right) },
      );
      if (a) return -1;
      else if (b) return 1;
      const leftId = BigInt(left);
      const rightId = BigInt(right);
      return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
    });
    let projectedCount = 0;
    const balances = new Map(assertions.filter((row) => row.state === 'PROVEN').map((balance) => [balance.positionId, balance]));
    const plans = new Map(incomingPlans.map((plan) => [plan.positionId, plan]));
    for (const positionId of uniquePositionIds) {
      const deals = await tx.mt5Deal.findMany({ where: { server: canonicalServer, accountLogin, positionId: BigInt(positionId) }, orderBy: [{ timeMsc: 'asc' }, { ticket: 'asc' }] });
      const orders = await tx.mt5Order.findMany({
        where: { server: canonicalServer, accountLogin, positionId: BigInt(positionId) },
        orderBy: [{ timeSetupMsc: 'desc' }, { ticket: 'desc' }],
      });
      const takeProfitPrice = orders.find((order) => Number(order.tp) !== 0)?.tp;
      const stopLossPrice = orders.find((order) => Number(order.sl) !== 0)?.sl;
      if (!deals.length) continue;
      const incomingBalance = balances.get(positionId);
      const persistedBalance = incomingBalance ? null : await tx.mt5PositionEntryBalance.findUnique({
        where: { server_accountLogin_positionId: { server: canonicalServer, accountLogin, positionId: BigInt(positionId) } },
        select: { state: true, preEntryBalance: true },
      });
      const balance = incomingBalance ?? (persistedBalance?.state === 'PROVEN' ? persistedBalance : null);
      const entries = deals.filter((deal) => this.isOpeningExecution(deal));
      if (!entries.length) continue;
      const exits = deals.filter((deal) => deal.entry === 1 || deal.entry === 2);
      const opened = entries[0];
      const entryVolume = entries.reduce((sum, deal) => sum + Number(deal.volume), 0);
      const exitVolume = exits.reduce((sum, deal) => sum + Number(deal.volume), 0);
      const weighted = (rows: typeof deals) => rows.reduce((sum, deal) => sum + Number(deal.price) * Number(deal.volume), 0) / rows.reduce((sum, deal) => sum + Number(deal.volume), 0);
      const closed = entryVolume > 0 && exitVolume >= entryVolume;
      const latestExit = exits[exits.length - 1];
      const exitReason = latestExit ? mt5DealReason(latestExit.reason) : undefined;
      const incomingPlan = plans.get(positionId);
      let initialPlan = await tx.mt5PositionEntryPlan.findUnique({
        where: { server_accountLogin_positionId: { server: canonicalServer, accountLogin, positionId: BigInt(positionId) } },
      });
      if (initialPlan && incomingPlan && !this.sameEntryPlan(initialPlan, incomingPlan)) {
        throw new Error(`MT5 bridge entry plan conflicts for position ${positionId}`);
      }
      if (!initialPlan && incomingPlan) {
        initialPlan = await tx.mt5PositionEntryPlan.create({
          data: {
            accountId, server: canonicalServer, accountLogin, positionId: BigInt(positionId),
            side: incomingPlan.side === 'short' ? TradeSide.SHORT : TradeSide.LONG,
            entryAt: new Date(incomingPlan.entryAt), entryPrice: incomingPlan.entryPrice,
            quantityLots: incomingPlan.quantityLots, takeProfitPrice: incomingPlan.takeProfitPrice,
            stopLossPrice: incomingPlan.stopLossPrice, preEntryBalance: incomingPlan.preEntryBalance,
            accountCurrency: incomingPlan.accountCurrency, tickSize: incomingPlan.tickSize,
            tickValueProfit: incomingPlan.tickValueProfit, tickValueLoss: incomingPlan.tickValueLoss,
            metricContractVersion: METRIC_CONTRACT_VERSION, capturedAt: new Date(),
          },
        });
      }
      const existingTrade = await tx.trade.findUnique({
        where: { mt5ServerCanonical_mt5AccountLogin_mt5PositionId: { mt5ServerCanonical: canonicalServer, mt5AccountLogin: accountLogin, mt5PositionId: BigInt(positionId) } },
        select: {
          riskAmount: true, riskPercent: true, returnPercent: true, initialPlanId: true,
          initialPlanMetricContractVersion: true, plannedTakeProfitPrice: true, plannedStopLossPrice: true,
          seedBalance: true,
        },
      });
      const manualMetrics = Boolean(existingTrade?.plannedTakeProfitPrice && existingTrade.plannedStopLossPrice
        && existingTrade.riskAmount && existingTrade.riskPercent && existingTrade.returnPercent);
      const metrics = initialPlan
        ? existingTrade?.plannedTakeProfitPrice && existingTrade.plannedStopLossPrice
          ? calculateTradePlanMetrics(initialPlan, existingTrade.plannedTakeProfitPrice, existingTrade.plannedStopLossPrice)
          : this.initialPlanMetrics(initialPlan)
        : null;
      const metricData = manualMetrics
        ? {
          riskAmount: existingTrade!.riskAmount, riskPercent: existingTrade!.riskPercent,
          returnPercent: existingTrade!.returnPercent, initialPlanId: existingTrade!.initialPlanId,
          initialPlanMetricContractVersion: existingTrade!.initialPlanMetricContractVersion,
        }
        : initialPlan && metrics
        ? {
          accountCurrency: initialPlan.accountCurrency,
          riskAmount: metrics.riskAmount,
          riskPercent: metrics.riskPercent,
          returnPercent: metrics.returnPercent,
          initialPlanId: initialPlan.id,
          initialPlanMetricContractVersion: initialPlan.metricContractVersion,
        }
        : {
          riskAmount: null, riskPercent: null, returnPercent: null,
          initialPlanId: null, initialPlanMetricContractVersion: null,
        };
      this.assertMetricState(existingTrade, initialPlan, metrics);
      const data = {
        ownerId, mt5AccountId: accountId, symbol: opened.symbol, side: opened.type === 1 ? TradeSide.SHORT : TradeSide.LONG,
        mt5SourceMissingAt: null,
        status: closed ? TradeStatus.CLOSED : TradeStatus.OPEN, quantityLots: entryVolume, entryPrice: entries.length ? weighted(entries) : Number(opened.price),
        ...(exits.length && { exitPrice: weighted(exits), exitReason }), realizedPnl: deals.reduce((sum, deal) => sum + Number(deal.profit) + Number(deal.commission) + Number(deal.swap) + Number(deal.fee), 0),
        openedAt: opened.timeMscUtc, ...(closed && { closedAt: exits[exits.length - 1].timeMscUtc }),
        takeProfitPrice: takeProfitPrice ?? null,
        stopLossPrice: stopLossPrice ?? null,
        seedBalance: balance?.preEntryBalance ?? existingTrade?.seedBalance ?? null,
        ...metricData,
      };
      const trade = await tx.trade.upsert({
        where: { mt5ServerCanonical_mt5AccountLogin_mt5PositionId: { mt5ServerCanonical: canonicalServer, mt5AccountLogin: accountLogin, mt5PositionId: BigInt(positionId) } },
        create: {
          ...data, mt5Server: exactServer, mt5ServerCanonical: canonicalServer, mt5AccountLogin: accountLogin, mt5PositionId: BigInt(positionId),
          analysis: { create: {} },
          entry: { create: { price: entries.length ? weighted(entries) : Number(opened.price), quantity: entryVolume || Number(opened.volume), occurredAt: opened.timeMscUtc } },
          ...(exits.length && { exit: { create: { price: weighted(exits), quantity: exitVolume, occurredAt: latestExit.timeMscUtc, reason: exitReason } } }),
        },
        update: {
          ...data,
          analysis: { upsert: { create: {}, update: {} } },
          entry: { upsert: { create: { price: entries.length ? weighted(entries) : Number(opened.price), quantity: entryVolume || Number(opened.volume), occurredAt: opened.timeMscUtc }, update: { price: entries.length ? weighted(entries) : Number(opened.price), quantity: entryVolume || Number(opened.volume), occurredAt: opened.timeMscUtc } } },
          ...(exits.length && { exit: { upsert: { create: { price: weighted(exits), quantity: exitVolume, occurredAt: latestExit.timeMscUtc, reason: exitReason }, update: { price: weighted(exits), quantity: exitVolume, occurredAt: latestExit.timeMscUtc, reason: exitReason } } } }),
        },
      });
      const membership = await tx.campaignMembership.findUnique({ where: { tradeId: trade.id } });
      if (!membership) {
        const tradingDate = seoulTradingDate(opened.timeMscUtc);
        const overlapping = await tx.trade.findMany({
          where: {
            ownerId,
            mt5AccountId: accountId,
            side: data.side,
            id: { not: trade.id },
            openedAt: { lte: opened.timeMscUtc },
            OR: [{ closedAt: null }, { closedAt: { gte: opened.timeMscUtc } }],
            campaignMembership: { isNot: null },
          },
          select: {
            mt5PositionId: true,
            campaignMembership: { select: { campaignId: true, headSource: true } },
          },
        });
        const manualHeads = await tx.trade.findMany({
          where: { ownerId, mt5AccountId: accountId, side: data.side, openedAt: { not: null }, campaignMembership: { headSource: 'MANUAL' } },
          select: { mt5PositionId: true, campaignMembership: { select: { campaignId: true } } },
        });
        const openingIds = [...overlapping, ...manualHeads].map((row) => row.mt5PositionId).filter((id): id is bigint => id !== null);
        const overlapOpenings = openingIds.length ? await tx.mt5Deal.findMany({
          where: {
            server: canonicalServer,
            accountLogin,
            positionId: { in: openingIds },
            entry: 0,
            type: { in: [0, 1] },
          },
          orderBy: [{ timeMsc: 'asc' }, { ticket: 'asc' }],
          select: { positionId: true, timeMsc: true, ticket: true },
        }) : [];
        const overlapOpeningByPosition = new Map<string, CampaignOpeningKey>();
        for (const deal of overlapOpenings) {
          const key = deal.positionId.toString();
          if (!overlapOpeningByPosition.has(key)) overlapOpeningByPosition.set(key, deal);
        }
        const newOpening: CampaignOpeningKey = { timeMsc: opened.timeMsc, ticket: opened.ticket, positionId: opened.positionId };
        const boundary = manualHeads
          .filter((row) => row.mt5PositionId !== null && overlapOpeningByPosition.has(row.mt5PositionId.toString()))
          .map((row) => ({ row, key: overlapOpeningByPosition.get(row.mt5PositionId!.toString())! }))
          .filter(({ key }) => compareCampaignOpeningKey(key, newOpening) <= 0)
          .sort((left, right) => compareCampaignOpeningKey(right.key, left.key))[0];
        const earliestOverlap = overlapping
          .filter((row) => row.mt5PositionId !== null && row.campaignMembership && overlapOpeningByPosition.has(row.mt5PositionId.toString()))
          .filter((row) => !boundary || compareCampaignOpeningKey(overlapOpeningByPosition.get(row.mt5PositionId!.toString())!, boundary.key) >= 0)
          .sort((left, right) => compareCampaignOpeningKey(
            overlapOpeningByPosition.get(left.mt5PositionId!.toString())!,
            overlapOpeningByPosition.get(right.mt5PositionId!.toString())!,
          ))[0];
        const campaign = earliestOverlap?.campaignMembership
          ? { id: earliestOverlap.campaignMembership.campaignId }
          : await tx.tradeCampaign.upsert({
            where: { rootTradeId: trade.id },
            create: { rootTradeId: trade.id, tradingDate, ownerId, mt5AccountId: accountId, analysis: { create: {} } },
            update: {},
          });
        await tx.campaignMembership.create({
          data: { tradeId: trade.id, campaignId: campaign.id, source: 'AUTO' },
        });
        // Campaign membership is aggregate state exposed to optimistic clients.
        await tx.tradeCampaign.update({ where: { id: campaign.id }, data: { version: { increment: 1 } } });
      }
      projectedCount += 1;
    }
    return projectedCount;
  }

  async reclassifyCampaigns(
    tx: Prisma.TransactionClient,
    ownerId: string,
    accountId: string,
    mergeAuthored = false,
  ): Promise<{ moved: number; deletedCampaigns: number; conflicts: number }> {
    const trades = await tx.trade.findMany({
      where: { ownerId, mt5AccountId: accountId, openedAt: { not: null } },
      orderBy: [{ openedAt: 'asc' }, { mt5PositionId: 'asc' }, { id: 'asc' }],
      include: {
        mt5Account: { select: { canonicalServer: true, accountLogin: true } },
        campaignMembership: {
          include: {
            campaign: {
              include: {
                rootTrade: { select: { id: true, openedAt: true, mt5PositionId: true } },
                analysis: { include: { economicIndicators: true, archives: true } },
                images: { select: { id: true } },
                conflicts: { select: { id: true } },
              },
            },
          },
        },
      },
    });
    const firstOpeningRows = trades.length ? await tx.mt5Deal.findMany({
      where: {
        accountId,
        positionId: { in: trades.map((trade) => trade.mt5PositionId).filter((id): id is bigint => id !== null) },
        entry: 0,
        type: { in: [0, 1] },
      },
      orderBy: [{ timeMsc: 'asc' }, { ticket: 'asc' }],
      select: { positionId: true, timeMsc: true, ticket: true },
    }) : [];
    const firstOpeningByPosition = new Map<string, CampaignOpeningKey>();
    for (const deal of firstOpeningRows) {
      const key = deal.positionId.toString();
      if (!firstOpeningByPosition.has(key)) firstOpeningByPosition.set(key, deal);
    }
    const openingKeyForTrade = (trade: { openedAt: Date | null; mt5PositionId: bigint | null }): CampaignOpeningKey => {
      const persisted = trade.mt5PositionId === null ? undefined : firstOpeningByPosition.get(trade.mt5PositionId.toString());
      if (persisted) return persisted;
      const positionId = trade.mt5PositionId ?? 0n;
      return { timeMsc: BigInt(trade.openedAt?.getTime() ?? 0), ticket: positionId, positionId };
    };
    trades.sort((left, right) => {
      const compared = compareCampaignOpeningKey(openingKeyForTrade(left), openingKeyForTrade(right));
      return compared || left.id.localeCompare(right.id);
    });
    const components: typeof trades[] = [];
    for (const side of [TradeSide.LONG, TradeSide.SHORT]) {
      let component: typeof trades = [];
      let componentEnd = Number.NEGATIVE_INFINITY;
      for (const trade of trades.filter((row) => row.side === side)) {
        const openedAt = trade.openedAt!.getTime();
        // A manual head is a durable boundary, even where intervals overlap.
        if (component.length && (trade.campaignMembership?.headSource === 'MANUAL' || openedAt > componentEnd)) {
          components.push(component);
          component = [];
          componentEnd = Number.NEGATIVE_INFINITY;
        }
        component.push(trade);
        componentEnd = trade.closedAt ? Math.max(componentEnd, trade.closedAt.getTime()) : Number.POSITIVE_INFINITY;
      }
      if (component.length) components.push(component);
    }
    components.sort((left, right) => compareCampaignOpeningKey(
      openingKeyForTrade(left[0]!),
      openingKeyForTrade(right[0]!),
    ));

    let moved = 0;
    let deletedCampaigns = 0;
    let conflicts = 0;
    for (const members of components) {
      const campaignRows = [...new Map(members
        .map((trade) => trade.campaignMembership?.campaign)
        .filter((campaign): campaign is NonNullable<typeof campaign> => Boolean(campaign))
        .map((campaign) => [campaign.id, campaign])).values()]
        .sort((left, right) => {
          const compared = compareCampaignOpeningKey(openingKeyForTrade(left.rootTrade), openingKeyForTrade(right.rootTrade));
          return compared || left.id.localeCompare(right.id);
        });
      const memberIds = new Set(members.map((trade) => trade.id));
      const canonical = campaignRows.find((campaign) => memberIds.has(campaign.rootTrade.id))
        ?? (campaignRows.length ? await tx.tradeCampaign.create({
          data: {
            rootTradeId: members[0]!.id,
            tradingDate: seoulTradingDate(members[0]!.openedAt!),
            ownerId,
            mt5AccountId: accountId,
            analysis: { create: {} },
          },
          include: {
            rootTrade: { select: { id: true, openedAt: true, mt5PositionId: true } },
            analysis: { include: { economicIndicators: true, archives: true } },
            images: { select: { id: true } },
            conflicts: { select: { id: true } },
          },
        }) : undefined);
      if (!canonical) continue;
      for (const trade of members) {
        const membership = trade.campaignMembership;
        if (!membership || membership.campaignId === canonical.id) continue;
        const directionSplit = !memberIds.has(membership.campaign.rootTrade.id);
        if (!directionSplit && (membership.source === 'MANUAL' || !mergeAuthored && this.hasAuthoredCampaignData(membership.campaign))) {
          await tx.campaignConflict.upsert({
            where: { tradeId: trade.id },
            create: { tradeId: trade.id, candidateCampaignIds: [canonical.id, membership.campaignId] },
            update: { candidateCampaignIds: [canonical.id, membership.campaignId], status: 'UNRESOLVED', resolvedCampaignId: null, resolvedAt: null },
          });
          conflicts += 1;
          continue;
        }
        await tx.campaignMembership.update({
          where: { tradeId: trade.id },
          data: { campaignId: canonical.id },
        });
        await tx.tradeCampaign.update({ where: { id: canonical.id }, data: { version: { increment: 1 } } });
        const sourceRemaining = await tx.campaignMembership.count({ where: { campaignId: membership.campaignId } });
        if (sourceRemaining) await tx.tradeCampaign.update({ where: { id: membership.campaignId }, data: { version: { increment: 1 } } });
        moved += 1;
      }
      for (const campaign of campaignRows.filter((row) => row.id !== canonical.id)) {
        const remaining = await tx.campaignMembership.count({ where: { campaignId: campaign.id } });
        if (remaining) continue;
        await this.mergeEmptyCampaign(tx, canonical, campaign);
        deletedCampaigns += 1;
      }
    }
    if (moved && this.excursionWorkProducer) {
      const status = await tx.mt5SyncStatus.findUnique({
        where: { accountId },
        select: { lastSuccessfulSnapshotMsc: true },
      });
      if (status?.lastSuccessfulSnapshotMsc != null) {
        await this.enqueueFinalExcursionWork(tx, accountId, status.lastSuccessfulSnapshotMsc, 'RECLASSIFIED');
      }
    }
    return { moved, deletedCampaigns, conflicts };
  }

  async reclassifyOwnedAccount(
    ownerId: string,
    accountId: string,
    mergeAuthored = false,
    expectedFingerprint?: string,
  ): Promise<{ moved: number; deletedCampaigns: number; conflicts: number }> {
    return this.prisma.$transaction(async (tx) => {
      await lockOwnedMt5Account(tx, ownerId, accountId);
      if (expectedFingerprint) {
        const current = await this.buildCampaignClassificationPreview(tx, ownerId, accountId);
        if (current.classificationFingerprint !== expectedFingerprint) throw new ConflictException('Campaign classification changed after preview');
      }
      return this.reclassifyCampaigns(tx, ownerId, accountId, mergeAuthored);
    }, { timeout: CAMPAIGN_RECLASSIFICATION_TIMEOUT_MS });
  }

  async previewCampaignReclassification(ownerId: string, accountId: string): Promise<CampaignClassificationPreview> {
    const account = await this.prisma.mt5Account.findFirst({ where: { id: accountId, ownerId }, select: { id: true } });
    if (!account) throw new NotFoundException('MT5 account not found');
    return this.buildCampaignClassificationPreview(this.prisma as unknown as Prisma.TransactionClient, ownerId, accountId);
  }

  private async buildCampaignClassificationPreview(
    db: Prisma.TransactionClient,
    ownerId: string,
    accountId: string,
  ): Promise<CampaignClassificationPreview> {
    const trades = await db.trade.findMany({
      where: { ownerId, mt5AccountId: accountId, openedAt: { not: null } },
      orderBy: [{ openedAt: 'asc' }, { mt5PositionId: 'asc' }, { id: 'asc' }],
      include: {
        campaignMembership: {
          include: {
            campaign: {
              include: {
                rootTrade: { select: { id: true, openedAt: true, mt5PositionId: true } },
                analysis: { include: { economicIndicators: true, archives: true } },
                images: { select: { id: true } },
                conflicts: { select: { id: true } },
              },
            },
          },
        },
      },
    });
    const firstOpeningRows = trades.length ? await db.mt5Deal.findMany({
      where: {
        accountId,
        positionId: { in: trades.map((trade) => trade.mt5PositionId).filter((id): id is bigint => id !== null) },
        entry: 0,
        type: { in: [0, 1] },
      },
      orderBy: [{ timeMsc: 'asc' }, { ticket: 'asc' }],
      select: { positionId: true, timeMsc: true, ticket: true },
    }) : [];
    const firstOpeningByPosition = new Map<string, CampaignOpeningKey>();
    for (const deal of firstOpeningRows) {
      const key = deal.positionId.toString();
      if (!firstOpeningByPosition.has(key)) firstOpeningByPosition.set(key, deal);
    }
    const openingKeyForTrade = (trade: { openedAt: Date | null; mt5PositionId: bigint | null }): CampaignOpeningKey => {
      const persisted = trade.mt5PositionId === null ? undefined : firstOpeningByPosition.get(trade.mt5PositionId.toString());
      if (persisted) return persisted;
      const positionId = trade.mt5PositionId ?? 0n;
      return { timeMsc: BigInt(trade.openedAt?.getTime() ?? 0), ticket: positionId, positionId };
    };
    trades.sort((left, right) => {
      const compared = compareCampaignOpeningKey(openingKeyForTrade(left), openingKeyForTrade(right));
      return compared || left.id.localeCompare(right.id);
    });
    const components: typeof trades[] = [];
    for (const side of [TradeSide.LONG, TradeSide.SHORT]) {
      let component: typeof trades = [];
      let componentEnd = Number.NEGATIVE_INFINITY;
      for (const trade of trades.filter((row) => row.side === side)) {
        const openedAt = trade.openedAt!.getTime();
        if (component.length && (trade.campaignMembership?.headSource === 'MANUAL' || openedAt > componentEnd)) {
          components.push(component);
          component = [];
          componentEnd = Number.NEGATIVE_INFINITY;
        }
        component.push(trade);
        componentEnd = trade.closedAt ? Math.max(componentEnd, trade.closedAt.getTime()) : Number.POSITIVE_INFINITY;
      }
      if (component.length) components.push(component);
    }
    const currentCampaignIds = new Set(trades.flatMap((trade) => trade.campaignMembership ? [trade.campaignMembership.campaignId] : []));
    const retainedCampaignIds = new Set<string>();
    let movedTrades = 0;
    let createdCampaigns = 0;
    let manualConflicts = 0;
    let authoredConflicts = 0;
    for (const members of components) {
      const memberIds = new Set(members.map((trade) => trade.id));
      const campaigns = [...new Map(members.flatMap((trade) => trade.campaignMembership
        ? [[trade.campaignMembership.campaignId, trade.campaignMembership.campaign] as const]
        : [])).values()]
        .sort((left, right) => {
          const compared = compareCampaignOpeningKey(openingKeyForTrade(left.rootTrade), openingKeyForTrade(right.rootTrade));
          return compared || left.id.localeCompare(right.id);
        });
      const canonical = campaigns.find((campaign) => memberIds.has(campaign.rootTrade.id));
      if (canonical) retainedCampaignIds.add(canonical.id);
      else createdCampaigns += 1;
      for (const trade of members) {
        const membership = trade.campaignMembership;
        if (!membership || membership.campaignId === canonical?.id) continue;
        movedTrades += 1;
        const directionSplit = !memberIds.has(membership.campaign.rootTrade.id);
        if (!directionSplit && membership.source === 'MANUAL') manualConflicts += 1;
        else if (!directionSplit && this.hasAuthoredCampaignData(membership.campaign)) authoredConflicts += 1;
      }
    }
    const mergedCampaigns = [...currentCampaignIds].filter((id) => !retainedCampaignIds.has(id)).length;
    const classificationFingerprint = createHash('sha256').update(JSON.stringify(trades.map((trade) => ({
      id: trade.id,
      updatedAt: trade.updatedAt.toISOString(),
      openedAt: trade.openedAt?.toISOString(),
      closedAt: trade.closedAt?.toISOString(),
      side: trade.side,
      campaignId: trade.campaignMembership?.campaignId ?? null,
      membershipUpdatedAt: trade.campaignMembership?.updatedAt.toISOString() ?? null,
      membershipSource: trade.campaignMembership?.source ?? null,
      headSource: trade.campaignMembership?.headSource ?? null,
      campaignUpdatedAt: trade.campaignMembership?.campaign.updatedAt.toISOString() ?? null,
      rootTradeId: trade.campaignMembership?.campaign.rootTrade.id ?? null,
    })))).digest('hex');
    return {
      accountId,
      classificationFingerprint,
      trades: trades.length,
      currentCampaigns: currentCampaignIds.size,
      proposedCampaigns: components.length,
      movedTrades,
      createdCampaigns,
      mergedCampaigns,
      manualConflicts,
      authoredConflicts,
      hasChanges: movedTrades > 0 || createdCampaigns > 0 || mergedCampaigns > 0,
    };
  }

  private hasAuthoredCampaignData(campaign: {
    memo: string | null;
    images: Array<{ id: string }>;
    conflicts: Array<{ id: string }>;
    analysis: {
      primaryTrend: unknown;
      maTimeframes: unknown;
      marketZoneEnabled: boolean;
      retailPositionEnabled: boolean;
      fibonacciEnabled: boolean;
      entryReason: string | null;
      invalidationCondition: string | null;
      takeProfitCondition: string | null;
      additionalEntryPlan: string | null;
      tradeScore: number | null;
      strengths: string | null;
      weaknesses: string | null;
      economicIndicators: unknown[];
      archives: unknown[];
    } | null;
  }): boolean {
    const analysis = campaign.analysis;
    return campaign.memo !== null
      || campaign.images.length > 0
      || campaign.conflicts.length > 0
      || Boolean(analysis && (
        analysis.primaryTrend !== null
        || JSON.stringify(analysis.maTimeframes) !== '{}'
        || analysis.marketZoneEnabled
        || analysis.retailPositionEnabled
        || analysis.fibonacciEnabled
        || analysis.entryReason !== null
        || analysis.invalidationCondition !== null
        || analysis.takeProfitCondition !== null
        || analysis.additionalEntryPlan !== null
        || analysis.tradeScore !== null
        || analysis.strengths !== null
        || analysis.weaknesses !== null
        || analysis.economicIndicators.length > 0
        || analysis.archives.length > 0
      ));
  }

  private async mergeEmptyCampaign(
    tx: Prisma.TransactionClient,
    canonical: {
      id: string;
      memo: string | null;
      analysis: { id: string } | null;
      images: Array<{ id: string }>;
    },
    losing: {
      id: string;
      memo: string | null;
      analysis: {
        id: string;
        economicIndicators: unknown[];
        archives: unknown[];
        [key: string]: unknown;
      } | null;
      images: Array<{ id: string }>;
    },
  ): Promise<void> {
    const canonicalAnalysis = canonical.analysis ?? await tx.tradeCampaignAnalysis.create({
      data: { campaignId: canonical.id },
      select: { id: true },
    });
    if (losing.memo !== null || losing.analysis) {
      await tx.tradeCampaignAnalysisArchive.upsert({
        where: {
          campaignAnalysisId_source: {
            campaignAnalysisId: canonicalAnalysis.id,
            source: `campaign-merge:${losing.id}`,
          },
        },
        create: {
          campaignAnalysisId: canonicalAnalysis.id,
          source: `campaign-merge:${losing.id}`,
          content: this.campaignArchiveContent(losing),
        },
        update: {},
      });
    }
    if (losing.memo) {
      const mergedMemo = canonical.memo
        ? `${canonical.memo}\n\n[병합된 캠페인 ${losing.id}]\n${losing.memo}`
        : losing.memo;
      await tx.tradeCampaign.update({ where: { id: canonical.id }, data: { memo: mergedMemo } });
      canonical.memo = mergedMemo;
    }
    const imageCount = await tx.tradeCampaignImage.count({ where: { campaignId: canonical.id } });
    const images = await tx.tradeCampaignImage.findMany({
      where: { campaignId: losing.id },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    for (const [offset, image] of images.entries()) {
      await tx.tradeCampaignImage.update({
        where: { id: image.id },
        data: { campaignId: canonical.id, position: imageCount + offset },
      });
    }
    const conflicts = await tx.campaignConflict.findMany({
      where: {
        OR: [
          { resolvedCampaignId: losing.id },
          { candidateCampaignIds: { array_contains: [losing.id] } },
        ],
      },
      select: { id: true, resolvedCampaignId: true, candidateCampaignIds: true },
    });
    for (const conflict of conflicts) {
      const candidates = Array.isArray(conflict.candidateCampaignIds)
        ? [...new Set(conflict.candidateCampaignIds.map((id) => id === losing.id ? canonical.id : id))]
        : [];
      await tx.campaignConflict.update({
        where: { id: conflict.id },
        data: {
          candidateCampaignIds: candidates,
          ...(conflict.resolvedCampaignId === losing.id && { resolvedCampaignId: canonical.id }),
        },
      });
    }
    await tx.tradeCampaignAnalysis.deleteMany({ where: { campaignId: losing.id } });
    await tx.tradeCampaign.delete({ where: { id: losing.id } });
  }

  private campaignArchiveContent(campaign: {
    id: string;
    memo: string | null;
    analysis: {
      economicIndicators: unknown[];
      archives: unknown[];
      [key: string]: unknown;
    } | null;
  }): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify({
      campaignId: campaign.id,
      memo: campaign.memo,
      analysis: campaign.analysis,
    })) as Prisma.InputJsonValue;
  }


  private sameEntryPlan(plan: {
    side: TradeSide;
    entryAt: Date;
    entryPrice: Prisma.Decimal;
    quantityLots: Prisma.Decimal;
    takeProfitPrice: Prisma.Decimal;
    stopLossPrice: Prisma.Decimal;
    preEntryBalance: Prisma.Decimal;
    accountCurrency: string;
    tickSize: Prisma.Decimal;
    tickValueProfit: Prisma.Decimal;
    tickValueLoss: Prisma.Decimal;
  }, incoming: Mt5PositionEntryPlanFact): boolean {
    return plan.side === (incoming.side === 'short' ? TradeSide.SHORT : TradeSide.LONG)
      && plan.entryAt.getTime() === incoming.entryAt
      && plan.entryPrice.equals(incoming.entryPrice)
      && plan.quantityLots.equals(incoming.quantityLots)
      && plan.takeProfitPrice.equals(incoming.takeProfitPrice)
      && plan.stopLossPrice.equals(incoming.stopLossPrice)
      && plan.preEntryBalance.equals(incoming.preEntryBalance)
      && plan.accountCurrency === incoming.accountCurrency
      && plan.tickSize.equals(incoming.tickSize)
      && plan.tickValueProfit.equals(incoming.tickValueProfit)
      && plan.tickValueLoss.equals(incoming.tickValueLoss);
  }

  private initialPlanMetrics(plan: {
    side: TradeSide;
    entryPrice: Prisma.Decimal;
    quantityLots: Prisma.Decimal;
    takeProfitPrice: Prisma.Decimal;
    stopLossPrice: Prisma.Decimal;
    preEntryBalance: Prisma.Decimal;
    tickSize: Prisma.Decimal;
    tickValueProfit: Prisma.Decimal;
    tickValueLoss: Prisma.Decimal;
    metricContractVersion: number;
  }): { riskAmount: Prisma.Decimal; riskPercent: Prisma.Decimal; returnPercent: Prisma.Decimal } | null {
    if (plan.metricContractVersion !== METRIC_CONTRACT_VERSION
      || plan.quantityLots.lte(0)
      || plan.preEntryBalance.lte(0)
      || plan.tickSize.lte(0)
      || plan.tickValueProfit.lte(0)
      || plan.tickValueLoss.lte(0)) return null;
    const long = plan.side === TradeSide.LONG;
    if ((long && (plan.stopLossPrice.gte(plan.entryPrice) || plan.takeProfitPrice.lte(plan.entryPrice)))
      || (!long && (plan.stopLossPrice.lte(plan.entryPrice) || plan.takeProfitPrice.gte(plan.entryPrice)))) return null;
    const riskAmount = plan.entryPrice.minus(plan.stopLossPrice).abs()
      .dividedBy(plan.tickSize).times(plan.tickValueLoss).times(plan.quantityLots);
    const returnAmount = plan.takeProfitPrice.minus(plan.entryPrice).abs()
      .dividedBy(plan.tickSize).times(plan.tickValueProfit).times(plan.quantityLots);
    if (!riskAmount.isFinite() || !returnAmount.isFinite()) return null;
    const round = (value: Prisma.Decimal) => value.toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
    return {
      riskAmount: round(riskAmount),
      riskPercent: round(riskAmount.dividedBy(plan.preEntryBalance).times(100)),
      returnPercent: round(returnAmount.dividedBy(plan.preEntryBalance).times(100)),
    };
  }

  private assertMetricState(existing: {
    riskAmount: Prisma.Decimal | null;
    riskPercent: Prisma.Decimal | null;
    returnPercent: Prisma.Decimal | null;
    initialPlanId: string | null;
    initialPlanMetricContractVersion: number | null;
    plannedTakeProfitPrice?: Prisma.Decimal | null;
    plannedStopLossPrice?: Prisma.Decimal | null;
  } | null, plan: { id: string; metricContractVersion: number } | null, metrics: { riskAmount: Prisma.Decimal; riskPercent: Prisma.Decimal; returnPercent: Prisma.Decimal } | null): void {
    if (!existing) return;
    if (existing.plannedTakeProfitPrice && existing.plannedStopLossPrice
      && existing.riskAmount && existing.riskPercent && existing.returnPercent) return;
    const stored = [existing.riskAmount, existing.riskPercent, existing.returnPercent, existing.initialPlanId, existing.initialPlanMetricContractVersion];
    const populated = stored.filter((value) => value !== null).length;
    if (populated !== 0 && populated !== stored.length) throw new Error('Trade initial-plan metric state is partial');
    if (!plan || !metrics) {
      if (populated) throw new Error('Trade initial-plan metric state conflicts with unsupported plan');
      return;
    }
    if (!populated) return;
    if (existing.initialPlanId !== plan.id
      || existing.initialPlanMetricContractVersion !== plan.metricContractVersion
      || !existing.riskAmount!.equals(metrics.riskAmount)
      || !existing.riskPercent!.equals(metrics.riskPercent)
      || !existing.returnPercent!.equals(metrics.returnPercent)) {
      throw new Error('Trade initial-plan metric state conflicts with immutable plan');
    }
  }
  private safeErrorCategory(error: unknown): string {
    if (!(error instanceof Error)) return 'MT5_SYNC_UNKNOWN';
    if (error instanceof Mt5BridgeUnauthorized) return 'MT5_SYNC_BRIDGE_UNAUTHORIZED';
    if (error instanceof Mt5AccountAuthorizationRejected) return 'MT5_SYNC_ACCOUNT_AUTHORIZATION_REJECTED';
    if (error.message.includes('configuration')) return 'MT5_SYNC_CONFIGURATION';
    if (error.message.includes('too large')) return 'MT5_SYNC_RESPONSE_TOO_LARGE';
    if (error.message.includes('identity mismatch')) return 'MT5_SYNC_IDENTITY_MISMATCH';
    if (error.message.includes('invalid')) return 'MT5_SYNC_INVALID_RESPONSE';
    if (error.message.includes('request failed')) return 'MT5_SYNC_UPSTREAM_REJECTED';
    if (error.message.includes('unavailable')) return 'MT5_SYNC_UNAVAILABLE';
    return 'MT5_SYNC_INTERNAL';
  }
  assertTrustedToken(provided: string | undefined): void {
    const expected = process.env.MT5_SYNC_TOKEN?.trim();
    if (!expected || !provided || provided !== expected) throw new UnauthorizedException('Trusted sync route required');
  }
}
