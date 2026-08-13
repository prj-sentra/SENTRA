import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

export type ExcursionScope = 'TRADE' | 'CAMPAIGN';
export type ExcursionWorkState = 'PENDING' | 'CLAIMED' | 'RETRY_WAIT' | 'BLOCKED' | 'CANCELLED';
export type ExcursionStatus = 'SUCCESS' | 'STALE' | 'FAILED' | 'UNSUPPORTED';

export type ExcursionTarget = {
  scope: ExcursionScope;
  targetId: string;
  generation: number;
  baseInputFingerprint: string;
  tickSnapshotToMsc: bigint | null;
};

export type ExcursionWork = ExcursionTarget & {
  id: string;
  accountId: string;
  reason: string;
  state: ExcursionWorkState;
  notBefore: Date | null;
  claimId: string | null;
  claimExpiresAt: Date | null;
  attemptCount: number;
  consecutiveFailures: number;
  manualRetryEpoch: number;
};

export type ExcursionProgress = {
  workItemId: string;
  generation: number;
  rawFromMsc: bigint;
  rawToMsc: bigint;
  nextRawFromMsc: bigint;
  completedChunkCount: number;
  completedPageCount: number;
  completedTickCount: number;
  checkpointedAt: Date;
  /** Opaque calculator state; it is persisted rather than reconstructed after a lease loss. */
  fifoState?: Record<string, unknown>;
  extremaState?: Record<string, unknown>;
  portfolioMarks?: Record<string, unknown>;
  pathDigestState?: string;
  valuationDigests?: Record<string, unknown>;
};

export type ExcursionClaim = Pick<ExcursionWork, 'id' | 'generation' | 'baseInputFingerprint' | 'tickSnapshotToMsc'> & {
  claimId: string;
  claimExpiresAt: Date;
};

export type ExcursionWorkTransactionPort = {
  findWork(scope: ExcursionScope, targetId: string): Promise<ExcursionWork | null>;
  upsertWork(work: ExcursionWork): Promise<ExcursionWork>;
  updateWork(id: string, update: Partial<ExcursionWork>): Promise<ExcursionWork | null>;
  deleteProgress(workItemId: string): Promise<void>;
  staleResult(scope: ExcursionScope, targetId: string, reason: string, attemptedAt: Date): Promise<void>;
  cancelWork(scope: ExcursionScope, targetId: string, reason: string): Promise<void>;
  recoverExpiredClaims(now: Date): Promise<number>;
  claimNext(now: Date, claimId: string, expiresAt: Date): Promise<ExcursionClaim | null>;
  checkpoint(claim: ExcursionClaim, progress: ExcursionProgress, now: Date): Promise<boolean>;
  finalize(claim: ExcursionClaim, now: Date): Promise<boolean>;
};

export type CheckpointInput = Omit<ExcursionProgress, 'workItemId' | 'generation' | 'checkpointedAt'>;

@Injectable()
export class ExcursionWorkService {
  async dirtyTargets(
    tx: ExcursionWorkTransactionPort,
    accountId: string,
    targets: readonly ExcursionTarget[],
    reason: string,
    now = new Date(),
  ): Promise<ExcursionWork[]> {
    const work: ExcursionWork[] = [];
    for (const target of targets) {
      const existing = await tx.findWork(target.scope, target.targetId);
      const drifted = !existing
        || existing.generation !== target.generation
        || existing.baseInputFingerprint !== target.baseInputFingerprint
        || existing.tickSnapshotToMsc !== target.tickSnapshotToMsc;
      if (existing && drifted) {
        await tx.deleteProgress(existing.id);
        await tx.staleResult(target.scope, target.targetId, reason, now);
      }
      work.push(await tx.upsertWork({
        id: existing?.id ?? randomUUID(),
        accountId,
        reason,
        state: 'PENDING',
        notBefore: null,
        claimId: null,
        claimExpiresAt: null,
        attemptCount: drifted ? 0 : (existing?.attemptCount ?? 0),
        consecutiveFailures: drifted ? 0 : (existing?.consecutiveFailures ?? 0),
        manualRetryEpoch: drifted ? 0 : (existing?.manualRetryEpoch ?? 0),
        ...target,
      }));
    }
    return work;
  }

  async invalidate(
    tx: ExcursionWorkTransactionPort,
    accountId: string,
    target: ExcursionTarget,
    reason: string,
    now = new Date(),
  ): Promise<ExcursionWork> {
    const [work] = await this.dirtyTargets(tx, accountId, [target], reason, now);
    return work;
  }

  async requeue(
    tx: ExcursionWorkTransactionPort,
    scope: ExcursionScope,
    targetId: string,
    reason: string,
  ): Promise<ExcursionWork | null> {
    const work = await tx.findWork(scope, targetId);
    if (!work || work.state === 'CANCELLED') return null;
    await tx.deleteProgress(work.id);
    return tx.updateWork(work.id, {
      reason,
      state: 'PENDING',
      notBefore: null,
      claimId: null,
      claimExpiresAt: null,
      consecutiveFailures: 0,
    });
  }

  async cancel(tx: ExcursionWorkTransactionPort, scope: ExcursionScope, targetId: string, reason: string): Promise<void> {
    const work = await tx.findWork(scope, targetId);
    if (work) await tx.deleteProgress(work.id);
    await tx.cancelWork(scope, targetId, reason);
  }

  async claim(tx: ExcursionWorkTransactionPort, now = new Date(), leaseMs = 45_000): Promise<ExcursionClaim | null> {
    await tx.recoverExpiredClaims(now);
    return tx.claimNext(now, randomUUID(), new Date(now.getTime() + leaseMs));
  }

  async checkpoint(
    tx: ExcursionWorkTransactionPort,
    claim: ExcursionClaim,
    progress: CheckpointInput,
    now = new Date(),
  ): Promise<boolean> {
    return tx.checkpoint(claim, {
      ...progress,
      workItemId: claim.id,
      generation: claim.generation,
      checkpointedAt: now,
    }, now);
  }

  async finalize(tx: ExcursionWorkTransactionPort, claim: ExcursionClaim, now = new Date()): Promise<boolean> {
    return tx.finalize(claim, now);
  }
}
