import { ExcursionWorkerPort, ExcursionWorkerService } from './excursion-worker.service';
import { ExcursionClaim, ExcursionWorkService } from './excursion-work.service';
import { Mt5BridgeTickError } from '../mt5-accounts/mt5-bridge.client';

const claim: ExcursionClaim = {
  id: 'work-1', claimId: 'claim-1', claimExpiresAt: new Date(Date.now() + 60_000),
  generation: 1, baseInputFingerprint: 'input', tickSnapshotToMsc: 1n,
};

function port(overrides: Partial<ExcursionWorkerPort> = {}): ExcursionWorkerPort {
  return {
    acquireWorkerLease: jest.fn().mockResolvedValue('worker-lease'),
    releaseWorkerLease: jest.fn(),
    syncRequested: jest.fn().mockResolvedValue(false),
    haltWorker: jest.fn(),
    backoffWorker: jest.fn(),
    getCapabilities: jest.fn().mockResolvedValue({}), execute: jest.fn().mockResolvedValue({ complete: true }), requeueClaim: jest.fn(),
    findWork: jest.fn(), upsertWork: jest.fn(), updateWork: jest.fn(), deleteProgress: jest.fn(), staleResult: jest.fn(), cancelWork: jest.fn(),
    recoverExpiredClaims: jest.fn().mockResolvedValue(0), claimNext: jest.fn().mockResolvedValue(claim), checkpoint: jest.fn().mockResolvedValue(true), finalize: jest.fn().mockResolvedValue(true),
    ...overrides,
  } as ExcursionWorkerPort;
}

describe('ExcursionWorkerService', () => {
  const enabled = process.env.MT5_EXCURSION_WORKER_ENABLED;
  const accounts = process.env.MT5_EXCURSION_WORKER_ACCOUNT_IDS;
  beforeEach(() => { process.env.MT5_EXCURSION_WORKER_ACCOUNT_IDS = 'account-1'; });
  afterEach(() => {
    process.env.MT5_EXCURSION_WORKER_ENABLED = enabled;
    process.env.MT5_EXCURSION_WORKER_ACCOUNT_IDS = accounts;
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

  it('fails closed when enabled without an account allowlist', async () => {
    process.env.MT5_EXCURSION_WORKER_ACCOUNT_IDS = '  ';
    const adapter = port();
    const worker = new ExcursionWorkerService(new ExcursionWorkService(), adapter);
    await expect((worker as any).run()).resolves.toBe(false);
    expect(adapter.acquireWorkerLease).not.toHaveBeenCalled();
    expect(adapter.claimNext).not.toHaveBeenCalled();
  });

  it('does not start enabled work without a bound worker port', () => {
    process.env.MT5_EXCURSION_WORKER_ENABLED = 'true';
    const worker = new ExcursionWorkerService(new ExcursionWorkService());
    worker.onApplicationBootstrap();
    expect((worker as any).timer).toBeUndefined();
  });

  it('backs off before retrying a transient capability failure', async () => {
    jest.useFakeTimers();
    process.env.MT5_EXCURSION_WORKER_ENABLED = 'true';
    const adapter = port({ getCapabilities: jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({}) });
    const worker = new ExcursionWorkerService(new ExcursionWorkService(), adapter);
    worker.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(299_000);
    expect(adapter.getCapabilities).toHaveBeenCalledTimes(1);
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

  it('does not claim work while an interactive synchronization is requested', async () => {
    const adapter = port({ syncRequested: jest.fn().mockResolvedValue(true) });
    const worker = new ExcursionWorkerService(new ExcursionWorkService(), adapter);
    await expect((worker as any).run()).resolves.toBe(false);
    expect(adapter.claimNext).not.toHaveBeenCalled();
    expect(adapter.releaseWorkerLease).toHaveBeenCalledWith('worker-lease');
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
    await jest.advanceTimersByTimeAsync(10_000);
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
    const adapter = port({ execute: jest.fn().mockResolvedValue({ complete: false, progress: { rawFromMsc: 1n, rawToMsc: 3n, nextRawFromMsc: 2n, completedChunkCount: 1, completedPageCount: 1, completedTickCount: 10 } }) });
    const worker = new ExcursionWorkerService(new ExcursionWorkService(), adapter);
    await expect((worker as any).run()).resolves.toBe(true);
    expect(adapter.checkpoint).toHaveBeenCalled();
  });

  it('halts all workers after a tick identity fault', async () => {
    const adapter = port({ execute: jest.fn().mockRejectedValue(new Mt5BridgeTickError('TICK_IDENTITY_MISMATCH', 'identity')) });
    const worker = new ExcursionWorkerService(new ExcursionWorkService(), adapter);
    await expect((worker as any).run()).resolves.toBe(false);
    expect(adapter.haltWorker).toHaveBeenCalledWith('TICK_IDENTITY_MISMATCH');
  });
});
