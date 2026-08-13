import { ExcursionWorkerPort, ExcursionWorkerService } from './excursion-worker.service';
import { ExcursionClaim, ExcursionWorkService } from './excursion-work.service';

const claim: ExcursionClaim = {
  id: 'work-1', claimId: 'claim-1', claimExpiresAt: new Date(Date.now() + 60_000),
  generation: 1, baseInputFingerprint: 'input', tickSnapshotToMsc: 1n,
};

function port(overrides: Partial<ExcursionWorkerPort> = {}): ExcursionWorkerPort {
  return {
    getCapabilities: jest.fn().mockResolvedValue({}), execute: jest.fn().mockResolvedValue({ complete: true }), requeueClaim: jest.fn(),
    findWork: jest.fn(), upsertWork: jest.fn(), updateWork: jest.fn(), deleteProgress: jest.fn(), staleResult: jest.fn(), cancelWork: jest.fn(),
    recoverExpiredClaims: jest.fn().mockResolvedValue(0), claimNext: jest.fn().mockResolvedValue(claim), checkpoint: jest.fn().mockResolvedValue(true), finalize: jest.fn().mockResolvedValue(true),
    ...overrides,
  } as ExcursionWorkerPort;
}

describe('ExcursionWorkerService', () => {
  const enabled = process.env.MT5_EXCURSION_WORKER_ENABLED;
  afterEach(() => {
    process.env.MT5_EXCURSION_WORKER_ENABLED = enabled;
    jest.useRealTimers();
  });

  it('does not start when the environment gate is off', () => {
    jest.useFakeTimers();
    process.env.MT5_EXCURSION_WORKER_ENABLED = 'false';
    const adapter = port();
    new ExcursionWorkerService(new ExcursionWorkService(), adapter).onApplicationBootstrap();
    jest.runOnlyPendingTimers();
    expect(adapter.getCapabilities).not.toHaveBeenCalled();
  });

  it('does not start enabled work without a bound worker port', () => {
    process.env.MT5_EXCURSION_WORKER_ENABLED = 'true';
    const worker = new ExcursionWorkerService(new ExcursionWorkService());
    worker.onApplicationBootstrap();
    expect((worker as any).timer).toBeUndefined();
  });

  it('retries a transient capability failure on the following poll', async () => {
    jest.useFakeTimers();
    process.env.MT5_EXCURSION_WORKER_ENABLED = 'true';
    const adapter = port({ getCapabilities: jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({}) });
    const worker = new ExcursionWorkerService(new ExcursionWorkService(), adapter);
    worker.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(1_000);
    expect(adapter.getCapabilities).toHaveBeenCalledTimes(2);
  });

  it('recovers expired claims before claiming work', async () => {
    const adapter = port();
    const worker = new ExcursionWorkerService(new ExcursionWorkService(), adapter);
    await (worker as any).run();
    const recover = adapter.recoverExpiredClaims as jest.Mock;
    const next = adapter.claimNext as jest.Mock;
    expect(recover.mock.invocationCallOrder[0]).toBeLessThan(next.mock.invocationCallOrder[0]);
  });

  it('claims work with the approved 45-second lease', async () => {
    const adapter = port();
    const worker = new ExcursionWorkerService(new ExcursionWorkService(), adapter);
    const before = Date.now();
    await (worker as any).run();
    const expiresAt = (adapter.claimNext as jest.Mock).mock.calls[0][2] as Date;
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + 45_000);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 45_000);
  });

  it('aborts a bounded unit at its deadline', async () => {
    jest.useFakeTimers();
    const adapter = port({ execute: jest.fn((_claim, _limits, signal: AbortSignal) => new Promise((resolve) => signal.addEventListener('abort', () => resolve({ complete: false }), { once: true }))) });
    const worker = new ExcursionWorkerService(new ExcursionWorkService(), adapter);
    const running = (worker as any).run();
    await Promise.resolve();
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(20_000);
    await running;
    expect(adapter.requeueClaim).toHaveBeenCalledWith(claim, 'WORKER_DEADLINE', expect.any(Date));
  });

  it('aborts and requeues an active claim during shutdown', async () => {
    const adapter = port({ execute: jest.fn((_claim, _limits, signal: AbortSignal) => new Promise((resolve) => signal.addEventListener('abort', () => resolve({ complete: false }), { once: true }))) });
    const worker = new ExcursionWorkerService(new ExcursionWorkService(), adapter);
    const running = (worker as any).run();
    while (!(adapter.execute as jest.Mock).mock.calls.length) await Promise.resolve();
    await worker.onApplicationShutdown();
    await running;
    expect(adapter.requeueClaim).toHaveBeenCalledWith(claim, 'WORKER_SHUTDOWN', expect.any(Date));
  });

  it('continues immediately after checkpointing a complete chunk', async () => {
    const adapter = port({ execute: jest.fn().mockResolvedValue({ complete: false, progress: { nextRawFromMsc: 2n, completedChunkCount: 1, completedPageCount: 1, completedTickCount: 10 } }) });
    const worker = new ExcursionWorkerService(new ExcursionWorkService(), adapter);
    await expect((worker as any).run()).resolves.toBe(true);
    expect(adapter.checkpoint).toHaveBeenCalled();
  });
});
