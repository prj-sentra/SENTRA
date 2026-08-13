import { ExcursionClaim, ExcursionProgress, ExcursionScope, ExcursionTarget, ExcursionWork, ExcursionWorkService, ExcursionWorkTransactionPort } from './excursion-work.service';

class WorkPort implements ExcursionWorkTransactionPort {
  readonly work = new Map<string, ExcursionWork>();
  readonly progress = new Map<string, ExcursionProgress>();
  readonly stale = new Map<string, string>();
  private key(scope: ExcursionScope, targetId: string) { return `${scope}:${targetId}`; }

  async findWork(scope: ExcursionScope, targetId: string) { return this.work.get(this.key(scope, targetId)) ?? null; }
  async upsertWork(work: ExcursionWork) {
    this.work.set(this.key(work.scope, work.targetId), work);
    return work;
  }
  async updateWork(id: string, update: Partial<ExcursionWork>) {
    const entry = [...this.work.entries()].find(([, work]) => work.id === id);
    if (!entry) return null;
    const [key, work] = entry;
    const next = { ...work, ...update };
    this.work.set(key, next);
    return next;
  }
  async deleteProgress(workItemId: string) { this.progress.delete(workItemId); }
  async staleResult(scope: ExcursionScope, targetId: string, reason: string) { this.stale.set(this.key(scope, targetId), reason); }
  async cancelWork(scope: ExcursionScope, targetId: string, reason: string) {
    const work = await this.findWork(scope, targetId);
    if (work) await this.updateWork(work.id, { state: 'CANCELLED', reason, claimId: null, claimExpiresAt: null });
  }
  async recoverExpiredClaims(now: Date) {
    let recovered = 0;
    for (const work of this.work.values()) {
      if (work.state === 'CLAIMED' && work.claimExpiresAt && work.claimExpiresAt <= now) {
        await this.updateWork(work.id, { state: 'PENDING', claimId: null, claimExpiresAt: null });
        recovered++;
      }
    }
    return recovered;
  }
  async claimNext(now: Date, claimId: string, expiresAt: Date): Promise<ExcursionClaim | null> {
    const candidate = [...this.work.values()].find((work) =>
      (work.state === 'PENDING' || work.state === 'RETRY_WAIT') && (!work.notBefore || work.notBefore <= now));
    if (!candidate) return null;
    await this.updateWork(candidate.id, { state: 'CLAIMED', claimId, claimExpiresAt: expiresAt, attemptCount: candidate.attemptCount + 1 });
    return { id: candidate.id, generation: candidate.generation, baseInputFingerprint: candidate.baseInputFingerprint, tickSnapshotToMsc: candidate.tickSnapshotToMsc, claimId, claimExpiresAt: expiresAt };
  }
  async checkpoint(claim: ExcursionClaim, progress: ExcursionProgress, now: Date) {
    const work = [...this.work.values()].find((item) => item.id === claim.id);
    if (!work || work.state !== 'CLAIMED' || work.generation !== claim.generation || work.claimId !== claim.claimId || !work.claimExpiresAt || work.claimExpiresAt <= now) return false;
    this.progress.set(claim.id, progress);
    return true;
  }
  async finalize(claim: ExcursionClaim, now: Date) {
    const work = [...this.work.values()].find((item) => item.id === claim.id);
    if (!work || work.state !== 'CLAIMED' || work.generation !== claim.generation || work.tickSnapshotToMsc !== claim.tickSnapshotToMsc || work.claimId !== claim.claimId || !work.claimExpiresAt || work.claimExpiresAt <= now) return false;
    await this.updateWork(work.id, { state: 'CANCELLED', claimId: null, claimExpiresAt: null });
    this.progress.delete(work.id);
    return true;
  }
}

const target = (generation = 1): ExcursionTarget => ({ scope: 'TRADE', targetId: 'trade-1', generation, baseInputFingerprint: `input-${generation}`, tickSnapshotToMsc: 1000n });

describe('ExcursionWorkService', () => {
  const now = new Date('2026-08-12T00:00:00.000Z');

  it('preserves a current result as stale when a later attempt becomes dirty', async () => {
    const service = new ExcursionWorkService();
    const port = new WorkPort();
    await service.dirtyTargets(port, 'account-1', [target(1)], 'SYNC_CHANGED', now);
    await service.dirtyTargets(port, 'account-1', [target(2)], 'RISK_CHANGED', now);

    expect(port.stale.get('TRADE:trade-1')).toBe('RISK_CHANGED');
    expect((await port.findWork('TRADE', 'trade-1'))).toMatchObject({ generation: 2, state: 'PENDING', consecutiveFailures: 0 });
  });

  it('keeps one work item for a scope and target', async () => {
    const service = new ExcursionWorkService();
    const port = new WorkPort();
    await service.dirtyTargets(port, 'account-1', [target()], 'SYNC_CHANGED', now);
    await service.dirtyTargets(port, 'account-1', [target()], 'SYNC_CHANGED', now);

    expect(port.work.size).toBe(1);
  });

  it('drops stale progress when generation or fingerprint drifts', async () => {
    const service = new ExcursionWorkService();
    const port = new WorkPort();
    await service.dirtyTargets(port, 'account-1', [target()], 'SYNC_CHANGED', now);
    const claim = await service.claim(port, now);
    expect(claim).not.toBeNull();
    port.progress.set(claim!.id, { workItemId: claim!.id, generation: 1, rawFromMsc: 1n, rawToMsc: 20n, nextRawFromMsc: 10n, completedChunkCount: 1, completedPageCount: 1, completedTickCount: 1, checkpointedAt: now });

    await service.dirtyTargets(port, 'account-1', [target(2)], 'INPUT_DRIFT', now);
    expect(port.progress.has(claim!.id)).toBe(false);
  });

  it('only checkpoints complete chunks under the active claim', async () => {
    const service = new ExcursionWorkService();
    const port = new WorkPort();
    await service.dirtyTargets(port, 'account-1', [target()], 'SYNC_CHANGED', now);
    const claim = (await service.claim(port, now))!;

    await expect(service.checkpoint(port, claim, { rawFromMsc: 1n, rawToMsc: 600_000n, nextRawFromMsc: 301_000n, completedChunkCount: 1, completedPageCount: 2, completedTickCount: 20 }, now)).resolves.toBe(true);
    expect(port.progress.get(claim.id)).toMatchObject({ generation: 1, completedChunkCount: 1, nextRawFromMsc: 301_000n });
  });

  it('recovers an expired claim and rejects its final CAS', async () => {
    const service = new ExcursionWorkService();
    const port = new WorkPort();
    await service.dirtyTargets(port, 'account-1', [target()], 'SYNC_CHANGED', now);
    const first = (await service.claim(port, now, 10))!;
    const recoveredAt = new Date(now.getTime() + 11);
    const second = await service.claim(port, recoveredAt);

    expect(second).not.toBeNull();
    await expect(service.finalize(port, first, recoveredAt)).resolves.toBe(false);
    await expect(service.finalize(port, second!, recoveredAt)).resolves.toBe(true);
  });

  it('rejects final publication after the snapshot anchor drifts', async () => {
    const service = new ExcursionWorkService();
    const port = new WorkPort();
    await service.dirtyTargets(port, 'account-1', [target()], 'SYNC_CHANGED', now);
    const claim = (await service.claim(port, now))!;
    await port.updateWork(claim.id, { tickSnapshotToMsc: 1001n });

    await expect(service.finalize(port, claim, now)).resolves.toBe(false);
  });
});
