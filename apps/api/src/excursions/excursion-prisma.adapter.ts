import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { CredentialCipherService } from '../mt5-accounts/credential-cipher.service';
import { advanceMfeMaeCalculator, createMfeMaeCalculator, finalizeMfeMaeCalculator, MfeMaeCalculatorState } from '../mt5-accounts/mfe-mae.service';
import { Mt5BridgeClient } from '../mt5-accounts/mt5-bridge.client';
import { Mt5BridgeActivityService } from '../mt5-accounts/mt5-bridge-activity.service';
import { PrismaService } from '../prisma/prisma.service';
import { ExcursionWorkerLimits, ExcursionWorkerPort, ExcursionWorkerUnitResult } from './excursion-worker.service';
import { ExcursionClaim, ExcursionProgress, ExcursionScope, ExcursionWork, ExcursionWorkTransactionPort } from './excursion-work.service';

const CALCULATION_VERSION = 1;
const TICK_REQUEST_INTERVAL_MS = 150;
export class SyncPriorityYieldError extends Error {
  constructor() { super('MT5 sync priority yield'); }
}

type TickSnapshot = { id: string; sha256: string; tickCount: number };

function digestSnapshot(tickCount: number, ticks: Array<{ sequence: number; timeMsc: number; bid: string; ask: string }>): string {
  const hash = createHash('sha256');
  for (const part of ['ticks-v1-snapshot', tickCount, ...ticks.flatMap((tick) => [tick.sequence, tick.timeMsc, tick.bid, tick.ask])]) {
    if (typeof part === 'number') {
      const bytes = Buffer.alloc(8);
      bytes.writeBigUInt64BE(BigInt(part));
      hash.update(bytes);
    } else {
      const bytes = Buffer.from(part, 'utf8');
      const length = Buffer.alloc(4);
      length.writeUInt32BE(bytes.length);
      hash.update(length).update(bytes);
    }
  }
  return hash.digest('hex');
}

function work(row: any): ExcursionWork {
  return { ...row, tickSnapshotToMsc: row.tickSnapshotToMsc, notBefore: row.notBefore, claimExpiresAt: row.claimExpiresAt };
}

/** Durable Prisma implementation of the work queue and MT5 tick calculation boundary. */
@Injectable()
export class ExcursionPrismaAdapter implements ExcursionWorkerPort {
  private lastTickRequestAt = 0;
  constructor(
    private readonly prisma: PrismaService,
    private readonly bridge: Mt5BridgeClient,
    private readonly cipher: CredentialCipherService,
    private readonly bridgeActivity?: Mt5BridgeActivityService,
  ) {}

  async acquireWorkerLease(leaseMs: number): Promise<string | null> { return this.bridgeActivity?.acquireWorkerLease(leaseMs) ?? 'uncoordinated-test-worker'; }
  async releaseWorkerLease(leaseId: string): Promise<void> { await this.bridgeActivity?.releaseWorkerLease(leaseId); }
  async syncRequested(): Promise<boolean> { return this.bridgeActivity?.syncRequested() ?? false; }
  async haltWorker(reason: string): Promise<void> { await this.bridgeActivity?.haltWorker(reason); }

  async findWork(scope: ExcursionScope, targetId: string): Promise<ExcursionWork | null> { const row = await this.prisma.excursionWorkItem.findUnique({ where: { scope_targetId: { scope, targetId } } }); return row ? work(row) : null; }
  async upsertWork(input: ExcursionWork): Promise<ExcursionWork> {
    const { id, ...data } = input;
    const row = await this.prisma.excursionWorkItem.upsert({ where: { scope_targetId: { scope: input.scope, targetId: input.targetId } }, create: { id, ...data, tradeId: input.scope === 'TRADE' ? input.targetId : null, campaignId: input.scope === 'CAMPAIGN' ? input.targetId : null }, update: { ...data, tradeId: input.scope === 'TRADE' ? input.targetId : null, campaignId: input.scope === 'CAMPAIGN' ? input.targetId : null } });
    return work(row);
  }
  async updateWork(id: string, update: Partial<ExcursionWork>): Promise<ExcursionWork | null> { try { return work(await this.prisma.excursionWorkItem.update({ where: { id }, data: update as any })); } catch { return null; } }
  async deleteProgress(workItemId: string): Promise<void> { await this.prisma.excursionWorkProgress.deleteMany({ where: { workItemId } }); }
  async staleResult(scope: ExcursionScope, targetId: string, reason: string, attemptedAt: Date): Promise<void> {
    const data = { status: 'STALE' as const, attemptCalculationVersion: CALCULATION_VERSION, attemptInputFingerprint: '', lastAttemptedAt: attemptedAt, failureReason: reason };
    if (scope === 'TRADE') {
      await this.prisma.tradeExcursionResult.updateMany({ where: { tradeId: targetId, successCalculationVersion: { not: null } }, data });
    } else {
      await this.prisma.tradeCampaignExcursionResult.updateMany({
        where: { campaignId: targetId, successCalculationVersion: { not: null } },
        data: {
          ...data,
          priceFamilyStatus: 'STALE',
          priceFamilyReason: reason,
          pnlFamilyStatus: 'STALE',
          pnlFamilyReason: reason,
        },
      });
    }
  }
  async cancelWork(scope: ExcursionScope, targetId: string, reason: string): Promise<void> { await this.prisma.excursionWorkItem.updateMany({ where: { scope, targetId }, data: { state: 'CANCELLED', reason, claimId: null, claimExpiresAt: null } }); }
  async recoverExpiredClaims(now: Date): Promise<number> { const result = await this.prisma.excursionWorkItem.updateMany({ where: { state: 'CLAIMED', claimExpiresAt: { lte: now } }, data: { state: 'RETRY_WAIT', notBefore: now, claimId: null, claimExpiresAt: null } }); return result.count; }
  async claimNext(now: Date, claimId: string, expiresAt: Date, accountIds?: string[]): Promise<ExcursionClaim | null> {
    return this.prisma.$transaction(async (tx) => {
      const candidates = await tx.$queryRaw<Array<Pick<ExcursionWork, 'id' | 'generation' | 'baseInputFingerprint' | 'tickSnapshotToMsc'>>>(
        Prisma.sql`WITH eligible_accounts AS (
            SELECT account_id, MIN(updated_at) AS queue_age
            FROM excursion_work_items
            WHERE state IN ('PENDING', 'RETRY_WAIT') AND claim_id IS NULL AND (not_before IS NULL OR not_before <= ${now})
              ${accountIds?.length ? Prisma.sql`AND account_id IN (${Prisma.join(accountIds)})` : Prisma.empty}
            GROUP BY account_id
          ), selected_account AS (
            SELECT account_id FROM eligible_accounts ORDER BY queue_age ASC, account_id ASC LIMIT 1
          )
          SELECT id, generation, base_input_fingerprint AS "baseInputFingerprint", tick_snapshot_to_msc AS "tickSnapshotToMsc"
          FROM excursion_work_items
          WHERE account_id = (SELECT account_id FROM selected_account)
            AND state IN ('PENDING', 'RETRY_WAIT') AND claim_id IS NULL AND (not_before IS NULL OR not_before <= ${now})
          ORDER BY not_before ASC NULLS FIRST, created_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1`,
      );
      const candidate = candidates[0];
      if (!candidate) return null;
      await tx.excursionWorkItem.update({
        where: { id: candidate.id },
        data: { state: 'CLAIMED', claimId, claimExpiresAt: expiresAt, attemptCount: { increment: 1 } },
      });
      return { ...candidate, claimId, claimExpiresAt: expiresAt };
    });
  }
  async checkpoint(claim: ExcursionClaim, progress: ExcursionProgress): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const active = await tx.excursionWorkItem.updateMany({
        where: { id: claim.id, claimId: claim.claimId, generation: claim.generation, state: 'CLAIMED', claimExpiresAt: { gt: progress.checkpointedAt } },
        data: { state: 'PENDING', claimId: null, claimExpiresAt: null },
      });
      if (!active.count) return false;
      await tx.excursionWorkProgress.upsert({
        where: { workItemId: claim.id },
        create: { ...progress, fifoState: (progress.fifoState ?? {}) as Prisma.InputJsonValue, extremaState: (progress.extremaState ?? {}) as Prisma.InputJsonValue, portfolioMarks: progress.portfolioMarks as Prisma.InputJsonValue | undefined, pathDigestState: progress.pathDigestState ?? '', valuationDigests: (progress.valuationDigests ?? {}) as Prisma.InputJsonValue },
        update: { rawFromMsc: progress.rawFromMsc, rawToMsc: progress.rawToMsc, nextRawFromMsc: progress.nextRawFromMsc, completedChunkCount: progress.completedChunkCount, completedPageCount: progress.completedPageCount, completedTickCount: progress.completedTickCount, fifoState: progress.fifoState as Prisma.InputJsonValue | undefined, extremaState: progress.extremaState as Prisma.InputJsonValue | undefined, portfolioMarks: progress.portfolioMarks as Prisma.InputJsonValue | undefined, pathDigestState: progress.pathDigestState, valuationDigests: progress.valuationDigests as Prisma.InputJsonValue | undefined, checkpointedAt: progress.checkpointedAt },
      });
      return true;
    });
  }
  async finalize(claim: ExcursionClaim, now: Date): Promise<boolean> { const result = await this.prisma.excursionWorkItem.deleteMany({ where: { id: claim.id, claimId: claim.claimId, generation: claim.generation, baseInputFingerprint: claim.baseInputFingerprint, tickSnapshotToMsc: claim.tickSnapshotToMsc, state: 'CLAIMED', claimExpiresAt: { gt: now } } }); return result.count === 1; }
  async requeueClaim(claim: ExcursionClaim, reason: string, now: Date): Promise<void> {
    const current = await this.prisma.excursionWorkItem.findFirst({ where: { id: claim.id, claimId: claim.claimId, generation: claim.generation, state: 'CLAIMED' }, select: { consecutiveFailures: true, scope: true, targetId: true } });
    if (!current) return;
    await this.staleResult(current.scope, current.targetId, reason, now);
    const calculationFailure = reason === 'CALCULATION_FAILURE';
    const failures = calculationFailure ? current.consecutiveFailures + 1 : 0;
    const terminalUnsupported = reason === 'UNSUPPORTED_VALUATION';
    const blocked = terminalUnsupported || calculationFailure && failures >= 3;
    const retryDelay = this.retryDelay(reason, failures);
    await this.prisma.excursionWorkItem.updateMany({
      where: { id: claim.id, claimId: claim.claimId, generation: claim.generation, state: 'CLAIMED' },
      data: { state: blocked ? 'BLOCKED' : 'RETRY_WAIT', reason, notBefore: blocked ? null : new Date(now.getTime() + retryDelay), claimId: null, claimExpiresAt: null, consecutiveFailures: failures },
    });
  }
  async getCapabilities(signal: AbortSignal, deadlineMsc: number): Promise<unknown> {
    if (await this.syncRequested()) throw new SyncPriorityYieldError();
    return this.bridge.getCapabilities({ signal, deadlineMsc });
  }
  async execute(claim: ExcursionClaim, limits: ExcursionWorkerLimits, signal: AbortSignal): Promise<ExcursionWorkerUnitResult> {
    const item = await this.prisma.excursionWorkItem.findUnique({
      where: { id: claim.id },
      include: { account: true, progress: true, trade: true, campaign: { include: { memberships: { include: { trade: true } } } } },
    });
    const trades = item?.scope === 'TRADE' ? (item.trade ? [item.trade] : []) : item?.campaign?.memberships.map((membership) => membership.trade) ?? [];
    if (!item || item.claimId !== claim.claimId || item.generation !== claim.generation || item.tickSnapshotToMsc !== claim.tickSnapshotToMsc || !trades.length || item.tickSnapshotToMsc === null || trades.some((trade) => !trade.mt5PositionId || !trade.openedAt || !trade.closedAt)) throw new Error('Excursion target is stale or unsupported');
    const account = item.account; const password = this.cipher.decrypt({ ciphertext: Buffer.from(account.credentialCiphertext), iv: Buffer.from(account.credentialIv), tag: Buffer.from(account.credentialTag), version: account.credentialVersion });
    const deals = await this.prisma.mt5Deal.findMany({ where: { accountId: item.accountId, positionId: { in: trades.map((trade) => trade.mt5PositionId!) } }, orderBy: [{ timeMsc: 'asc' }, { ticket: 'asc' }] });
    const from = Number(deals[0]?.timeMsc); const to = Number(deals.at(-1)?.timeMsc); const symbols = [...new Set(deals.map((deal) => deal.symbol))];
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from > to) throw new Error('Excursion raw deal range is invalid');
    const rawDeals = deals.map((d) => ({ ticket: d.ticket.toString(), positionId: d.positionId.toString(), symbol: d.symbol, timeMsc: Number(d.timeMsc), entry: d.entry, type: d.type, volume: d.volume.toString(), price: d.price.toString() }));
    const progress = item.progress;
    const restored = progress?.fifoState && typeof progress.fifoState === 'object' ? (progress.fifoState as any).calculator as MfeMaeCalculatorState | undefined : undefined;
    let state: MfeMaeCalculatorState;
    if (restored) {
      state = restored;
      if (progress!.generation !== item.generation || state.nextRawFromMsc !== Number(progress!.nextRawFromMsc) || state.nextRawFromMsc < from || state.nextRawFromMsc > to + 1) {
        await this.deleteProgress(item.id);
        throw new Error('Excursion progress drift');
      }
    } else {
      const initial = createMfeMaeCalculator({ deals: rawDeals, rawFromMsc: from, rawToMsc: to, tickSnapshotToMsc: Number(item.tickSnapshotToMsc), calculationVersion: CALCULATION_VERSION });
      if (!initial.ok) throw new Error(`Excursion calculation unsupported: ${initial.code}`);
      state = initial.state;
    }
    let pagesUsed = 0; let ticksUsed = 0; let chunks = 0;
    while (state.nextRawFromMsc <= to && chunks < Math.min(20, limits.maxChunks)) {
      const chunkFrom = state.nextRawFromMsc;
      const chunkTo = Math.min(chunkFrom + 299_999, to);
      const tickPages: any[] = [];
      for (const symbol of symbols) {
        let cursor: string | undefined;
        let snapshot: TickSnapshot | undefined;
        let valuationSha256: string | undefined;
        const originalTicks: Array<{ sequence: number; timeMsc: number; bid: string; ask: string }> = [];
        do {
          if (await this.syncRequested()) throw new SyncPriorityYieldError();
          await this.paceTickRequest();
          const response = await this.bridge.ticks({ contractVersion: 5, server: account.server, accountLogin: Number(account.accountLogin), password, symbol, rawRange: { fromMsc: chunkFrom, toMsc: chunkTo }, snapshotToMsc: Number(item.tickSnapshotToMsc), pageCursor: cursor }, { signal, deadlineMsc: limits.deadlineMsc });
          pagesUsed++; ticksUsed += response.ticks.length;
          if (pagesUsed > limits.maxPages || ticksUsed > limits.maxTicks) throw new Error('Excursion worker limits exceeded');
          const receivedSnapshot = response.snapshot;
          if (!snapshot) {
            snapshot = { id: receivedSnapshot.id, sha256: receivedSnapshot.sha256, tickCount: receivedSnapshot.tickCount };
            valuationSha256 = response.valuation.sha256;
          } else if (snapshot.id !== receivedSnapshot.id || snapshot.sha256 !== receivedSnapshot.sha256 || snapshot.tickCount !== receivedSnapshot.tickCount || valuationSha256 !== response.valuation.sha256) {
            throw new Error('Excursion tick snapshot or valuation drift');
          }
          const expectedSequence = originalTicks.length;
          if (response.ticks.some((tick, index) => tick.sequence !== expectedSequence + index)) throw new Error('Excursion tick sequence drift');
          originalTicks.push(...response.ticks);
          tickPages.push({ symbol, response });
          cursor = response.nextCursor;
        } while (cursor);
        if (!tickPages.at(-1)?.response.complete || !snapshot || originalTicks.length !== snapshot.tickCount || (snapshot.tickCount > 0 && originalTicks.at(-1)?.sequence !== snapshot.tickCount - 1) || digestSnapshot(snapshot.tickCount, originalTicks) !== snapshot.sha256) {
          throw new Error('Excursion tick snapshot incomplete or corrupt');
        }
      }
      const merged = tickPages.reduce((result: any[], page) => {
        const existing = result.find((entry) => entry.symbol === page.symbol);
        if (existing) existing.response.ticks.push(...page.response.ticks);
        else result.push({ symbol: page.symbol, response: { ...page.response, ticks: [...page.response.ticks] } });
        return result;
      // The bridge's global sequence is retained and verified above.  The
      // calculator's established page contract uses a local sequence view.
      }, []).map((page) => ({ ...page, response: { ...page.response, ticks: page.response.ticks.map((tick: any, sequence: number) => ({ ...tick, sequence })) } }));
      const advanced = advanceMfeMaeCalculator(state, { deals: rawDeals, tickPages: merged, rawFromMsc: chunkFrom, rawToMsc: chunkTo, tickSnapshotToMsc: Number(item.tickSnapshotToMsc), calculationVersion: CALCULATION_VERSION });
      if (!advanced.ok) throw new Error(`Excursion calculation unsupported: ${advanced.code}`);
      state = advanced.state; chunks++;
    }
    if (state.nextRawFromMsc <= to) {
      return {
        complete: false,
        progress: {
          rawFromMsc: BigInt(from), rawToMsc: BigInt(to),
          nextRawFromMsc: BigInt(state.nextRawFromMsc), completedChunkCount: (progress?.completedChunkCount ?? 0) + chunks,
          completedPageCount: (progress?.completedPageCount ?? 0) + pagesUsed,
          completedTickCount: (progress?.completedTickCount ?? 0) + ticksUsed,
          fifoState: { calculator: state }, extremaState: state.extrema, portfolioMarks: state.marks,
          pathDigestState: JSON.stringify(state.pageDigests), valuationDigests: state.pageDigests,
        },
      };
    }
    const campaignRisk = trades.every((trade) => trade.riskAmount !== null)
      ? trades.reduce((sum, trade) => sum.plus(trade.riskAmount!), new Prisma.Decimal(0)).toString()
      : undefined;
    const displayFromAt = new Date(Math.min(...trades.map((trade) => trade.openedAt!.getTime())));
    const displayToAt = new Date(Math.max(...trades.map((trade) => trade.closedAt!.getTime())));
    const result = finalizeMfeMaeCalculator(state, { deals: rawDeals, rawFromMsc: from, rawToMsc: to, tickSnapshotToMsc: Number(item.tickSnapshotToMsc), calculationVersion: CALCULATION_VERSION, realizedPnl: trades.reduce((sum, trade) => sum.plus(trade.realizedPnl ?? 0), new Prisma.Decimal(0)).toString(), riskAmount: item.scope === 'TRADE' ? item.trade?.riskAmount?.toString() : campaignRisk });
    // Only a fully consumed final state reaches the existing atomic CAS publication below.
    const attemptedAt = new Date();
    const base: any = { status: result.ok ? 'SUCCESS' : 'UNSUPPORTED', attemptCalculationVersion: CALCULATION_VERSION, attemptInputFingerprint: claim.baseInputFingerprint, lastAttemptedAt: attemptedAt, failureReason: result.ok ? null : result.code };
    if (result.ok) Object.assign(base, { successCalculationVersion: CALCULATION_VERSION, successInputFingerprint: claim.baseInputFingerprint, lastSucceededAt: new Date(), rawFromMsc: BigInt(from), rawToMsc: BigInt(to), displayFromAt, displayToAt, tickSnapshotToMsc: item.tickSnapshotToMsc, priceSource: 'mt5_copy_ticks_range', pathDigest: result.provenance.pathSha256, tickCount: state.candidateCount, valuationVersion: result.provenance.valuationVersion, valuationDigests: { digest: result.provenance.valuationSha256, accountCurrency: Object.values(state.pageDigests)[0]?.accountCurrency }, portfolioMarkPolicy: result.portfolioMarkPolicy, mfePrice: result.price?.mfe.value, mfePriceMarkPrice: result.price?.mfe.markPrice, mfePriceOccurredAt: result.price ? new Date(result.price.mfe.occurredAtMsc) : null, maePrice: result.price?.mae.value, maePriceMarkPrice: result.price?.mae.markPrice, maePriceOccurredAt: result.price ? new Date(result.price.mae.occurredAtMsc) : null, mfePercent: result.percent?.mfe.value, mfePercentMarkPrice: result.percent?.mfe.markPrice, mfePercentOccurredAt: result.percent ? new Date(result.percent.mfe.occurredAtMsc) : null, maePercent: result.percent?.mae.value, maePercentMarkPrice: result.percent?.mae.markPrice, maePercentOccurredAt: result.percent ? new Date(result.percent.mae.occurredAtMsc) : null, mfeUnrealizedPnl: result.unrealizedPnl?.mfe.value, mfeUnrealizedPnlOccurredAt: result.unrealizedPnl ? new Date(result.unrealizedPnl.mfe.occurredAtMsc) : null, maeUnrealizedPnl: result.unrealizedPnl?.mae.value, maeUnrealizedPnlOccurredAt: result.unrealizedPnl ? new Date(result.unrealizedPnl.mae.occurredAtMsc) : null, mfeR: result.r?.mfe.value, mfeROccurredAt: result.r ? new Date(result.r.mfe.occurredAtMsc) : null, maeR: result.r?.mae.value, maeROccurredAt: result.r ? new Date(result.r.mae.occurredAtMsc) : null, captureRate: result.captureRate });
    if (result.ok) Object.assign(base, { displayFromAt, displayToAt });
    const published = await this.prisma.$transaction(async (tx) => {
      // Delete is the generation/claim/fingerprint/snapshot/lease fence. It is deliberately
      // first: a dirtying writer can only win before publication, never after it.
      const claimed = await tx.excursionWorkItem.deleteMany({
        where: {
          id: claim.id, claimId: claim.claimId, generation: claim.generation,
          baseInputFingerprint: claim.baseInputFingerprint, tickSnapshotToMsc: claim.tickSnapshotToMsc,
          state: 'CLAIMED', claimExpiresAt: { gt: attemptedAt },
        },
      });
      if (!claimed.count) return false;
      if (item.scope === 'TRADE') {
        const previous = await tx.tradeExcursionResult.findUnique({ where: { tradeId: item.tradeId! }, select: { successCalculationVersion: true } });
        await tx.tradeExcursionResult.upsert({
          where: { tradeId: item.tradeId! },
          create: { tradeId: item.tradeId!, ...base },
          update: !result.ok && previous?.successCalculationVersion != null
            ? { status: 'STALE', attemptCalculationVersion: CALCULATION_VERSION, attemptInputFingerprint: claim.baseInputFingerprint, lastAttemptedAt: attemptedAt, failureReason: result.code }
            : base,
        });
      } else {
        const family = result.ok && result.price ? 'SUCCESS' : 'UNSUPPORTED';
        const familyReason = result.ok ? (result.price ? null : 'HETEROGENEOUS_CAMPAIGN_PRICE_UNAVAILABLE') : result.code;
        const previous = await tx.tradeCampaignExcursionResult.findUnique({ where: { campaignId: item.campaignId! }, select: { successCalculationVersion: true } });
        await tx.tradeCampaignExcursionResult.upsert({
          where: { campaignId: item.campaignId! },
          create: { campaignId: item.campaignId!, ...base, priceFamilyStatus: family, priceFamilyReason: familyReason, pnlFamilyStatus: result.ok ? 'SUCCESS' : 'UNSUPPORTED', pnlFamilyReason: result.ok ? null : result.code },
          update: !result.ok && previous?.successCalculationVersion != null
            ? { status: 'STALE', attemptCalculationVersion: CALCULATION_VERSION, attemptInputFingerprint: claim.baseInputFingerprint, lastAttemptedAt: attemptedAt, failureReason: result.code, priceFamilyStatus: 'STALE', priceFamilyReason: result.code, pnlFamilyStatus: 'STALE', pnlFamilyReason: result.code }
            : { ...base, priceFamilyStatus: family, priceFamilyReason: familyReason, pnlFamilyStatus: result.ok ? 'SUCCESS' : 'UNSUPPORTED', pnlFamilyReason: result.ok ? null : result.code },
        });
      }
      await tx.excursionWorkProgress.deleteMany({ where: { workItemId: claim.id } });
      return true;
    });
    if (!published) throw new Error('Excursion target became stale before publication');
    return { complete: true, finalized: true };
  }

  private retryDelay(reason: string, failures: number): number {
    const base = reason === 'SYNC_PRIORITY_YIELD' ? 1_000
      : reason === 'TICK_CAPACITY' ? 120_000
        : reason === 'TICK_UNAVAILABLE' || reason === 'TRANSIENT_BRIDGE_FAILURE' ? 300_000
          : reason === 'TICK_DEADLINE' ? 60_000
            : reason === 'WORKER_DEADLINE' ? 10_000
              : Math.min(300_000, 5_000 * 2 ** Math.max(0, failures - 1));
    return Math.round(base * (0.9 + Math.random() * 0.2));
  }

  private async paceTickRequest(): Promise<void> {
    const wait = this.lastTickRequestAt + TICK_REQUEST_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    this.lastTickRequestAt = Date.now();
  }
}
