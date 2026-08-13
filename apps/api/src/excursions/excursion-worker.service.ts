import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown, Optional } from '@nestjs/common';
import { CheckpointInput, ExcursionClaim, ExcursionWorkService, ExcursionWorkTransactionPort } from './excursion-work.service';
import { Mt5BridgeTickError } from '../mt5-accounts/mt5-bridge.client';

export const EXCURSION_WORKER_PORT = Symbol('EXCURSION_WORKER_PORT');

export type ExcursionWorkerLimits = {
  deadlineMsc: number;
  maxChunks: number;
  maxPages: number;
  maxTicks: number;
  workerLeaseId: string;
  workerLeaseMs: number;
};

export type ExcursionWorkerUnitResult = {
  complete: boolean;
  /** The adapter published the result and removed work/progress atomically. */
  finalized?: boolean;
  /** Present only after a complete, durable calculation chunk. */
  progress?: CheckpointInput;
};

/**
 * The persistence/calculation boundary deliberately stays narrow: producers own
 * target construction, while this worker owns leases, bounded execution, and
 * lifecycle. The Prisma adapter can implement this alongside the calculator.
 */
export interface ExcursionWorkerPort extends ExcursionWorkTransactionPort {
  acquireWorkerLease(leaseMs: number): Promise<string | null>;
  releaseWorkerLease(leaseId: string): Promise<void>;
  syncRequested(): Promise<boolean>;
  haltWorker(reason: string): Promise<void>;
  backoffWorker(reason: string, delayMs: number): Promise<void>;
  getCapabilities(signal: AbortSignal, deadlineMsc: number, workerLeaseId: string, workerLeaseMs: number): Promise<unknown>;
  execute(claim: ExcursionClaim, limits: ExcursionWorkerLimits, signal: AbortSignal): Promise<ExcursionWorkerUnitResult>;
  requeueClaim(claim: ExcursionClaim, reason: string, now: Date): Promise<void>;
}

const POLL_MS = 1_000;
const DEFAULT_UNIT_MS = 10_000;
const CLAIM_LEASE_MS = 45_000;
const SHUTDOWN_DRAIN_MS = 5_000;

const DEFAULT_MAX_CHUNKS = 5;
const DEFAULT_MAX_PAGES = 20;
const DEFAULT_MAX_TICKS = 20_000;
const WORK_ITEM_DELAY_MS = 500;

@Injectable()
export class ExcursionWorkerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ExcursionWorkerService.name);
  private timer: NodeJS.Timeout | undefined;
  private active: Promise<void> | undefined;
  private activeController: AbortController | undefined;
  private stopping = false;
  private capabilitiesReady = false;
  private bridgeBackoffUntilMsc = 0;
  private workerLeaseId: string | undefined;

  constructor(
    private readonly work: ExcursionWorkService,
    @Optional() @Inject(EXCURSION_WORKER_PORT) private readonly port?: ExcursionWorkerPort,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.enabled()) return;
    if (!this.port) {
      this.logger.error('Excursion worker is enabled but no worker port is registered');
      return;
    }
    this.schedule(0);
  }

  /** Synchronous callers (notably post-sync) may wake one bounded worker unit. */
  async runOne(): Promise<{ processed: number; succeeded: number; stale: number; failed: number; deferred: number; reasons: Array<{ reason: string; count: number }> }> {
    if (!this.port || !this.enabled()) return { processed: 0, succeeded: 0, stale: 0, failed: 0, deferred: 0, reasons: [] };
    const outcome = await this.runOutcome();
    if (outcome === 'idle') return { processed: 0, succeeded: 0, stale: 0, failed: 0, deferred: 0, reasons: [] };
    if (outcome === 'complete') return { processed: 1, succeeded: 1, stale: 0, failed: 0, deferred: 0, reasons: [] };
    if (outcome === 'continuation') return { processed: 1, succeeded: 0, stale: 0, failed: 0, deferred: 1, reasons: [] };
    if (outcome === 'stale') return { processed: 1, succeeded: 0, stale: 1, failed: 0, deferred: 0, reasons: [] };
    return { processed: 1, succeeded: 0, stale: 0, failed: 1, deferred: 1, reasons: [{ reason: outcome, count: 1 }] };
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    this.activeController?.abort();
    if (this.active) await Promise.race([
      this.active,
      new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_DRAIN_MS)),
    ]);
  }

  private enabled(): boolean {
    return process.env.MT5_EXCURSION_WORKER_ENABLED === 'true';
  }

  private schedule(delay: number): void {
    if (this.stopping) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.active = this.run().then((continuation) => {
        if (!this.stopping) this.schedule(continuation ? 0 : POLL_MS);
      }).catch((error: unknown) => {
        this.logger.warn(`Excursion worker unit failed: ${error instanceof Error ? error.message : String(error)}`);
      }).finally(() => {
        this.active = undefined;
        if (!this.stopping && !this.timer) this.schedule(POLL_MS);
      });
    }, delay);
  }

  private async run(): Promise<boolean> {
    const outcome = await this.runOutcome();
    return outcome === 'continuation';
  }

  private async runOutcome(): Promise<'idle' | 'complete' | 'continuation' | 'stale' | string> {
    const port = this.port;
    if (!port || this.stopping) return 'idle';
    if (Date.now() < this.bridgeBackoffUntilMsc) return 'idle';
    const accountIds = this.accountAllowlist();
    if (!accountIds.length) return 'idle';
    const workerLeaseId = await port.acquireWorkerLease(CLAIM_LEASE_MS);
    if (!workerLeaseId) return 'idle';
    this.workerLeaseId = workerLeaseId;
    const controller = new AbortController();
    this.activeController = controller;
    const unitMs = this.intEnv('MT5_EXCURSION_UNIT_MS', DEFAULT_UNIT_MS, 1_000, 20_000);
    const deadlineMsc = Date.now() + unitMs;
    const timeout = setTimeout(() => controller.abort(), unitMs);
    let claim: ExcursionClaim | null = null;
    try {
      if (await port.syncRequested()) return 'idle';
      if (!this.capabilitiesReady) {
        await port.getCapabilities(controller.signal, deadlineMsc, workerLeaseId, CLAIM_LEASE_MS);
        this.capabilitiesReady = true;
      }
      if (await port.syncRequested()) return 'idle';
      if (controller.signal.aborted || this.stopping) return 'idle';
      claim = await this.work.claim(port, new Date(), CLAIM_LEASE_MS, accountIds);
      if (!claim || controller.signal.aborted || this.stopping) return 'idle';

      const result = await port.execute(claim, {
        deadlineMsc,
        maxChunks: this.intEnv('MT5_EXCURSION_MAX_CHUNKS', DEFAULT_MAX_CHUNKS, 1, 20),
        maxPages: this.intEnv('MT5_EXCURSION_MAX_PAGES', DEFAULT_MAX_PAGES, 1, 50),
        maxTicks: this.intEnv('MT5_EXCURSION_MAX_TICKS', DEFAULT_MAX_TICKS, 1_000, 50_000),
        workerLeaseId,
        workerLeaseMs: CLAIM_LEASE_MS,
      }, controller.signal);
      if (controller.signal.aborted || this.stopping) {
        await port.requeueClaim(claim, this.stopping ? 'WORKER_SHUTDOWN' : 'WORKER_DEADLINE', new Date());
        return 'continuation';
      }
      if (result.complete) {
        if (!result.finalized && !await this.work.finalize(port, claim, new Date())) return 'stale';
      } else if (result.progress) {
        if (!await this.work.checkpoint(port, claim, result.progress, new Date())) return 'stale';
        return 'continuation';
      } else {
        throw new Error('Excursion worker unit ended without a complete chunk checkpoint');
      }
    } catch (error) {
      const reason = this.stopping ? 'WORKER_SHUTDOWN' : controller.signal.aborted ? 'WORKER_DEADLINE' : this.failureReason(error);
      if (reason === 'TICK_INVALID_PAYLOAD' || reason === 'TICK_IDENTITY_MISMATCH') await port.haltWorker(reason);
      const globalBackoff = reason === 'TICK_CAPACITY' ? 120_000
        : reason === 'TICK_IDENTITY_MISMATCH' || reason === 'TICK_INVALID_PAYLOAD' ? Number.MAX_SAFE_INTEGER
          : reason === 'TICK_UNAVAILABLE' || reason === 'TRANSIENT_BRIDGE_FAILURE' ? 300_000
            : 0;
      if (globalBackoff) this.bridgeBackoffUntilMsc = Date.now() + globalBackoff;
      if (globalBackoff && globalBackoff !== Number.MAX_SAFE_INTEGER) await port.backoffWorker(reason, globalBackoff);
      if (claim) await port.requeueClaim(claim, reason, new Date());
      return reason;
    } finally {
      clearTimeout(timeout);
      this.activeController = undefined;
      await port.releaseWorkerLease(workerLeaseId);
      this.workerLeaseId = undefined;
    }
    if (!this.stopping) await new Promise((resolve) => setTimeout(resolve, WORK_ITEM_DELAY_MS));
    return 'complete';
  }

  private accountAllowlist(): string[] {
    const ids = process.env.MT5_EXCURSION_WORKER_ACCOUNT_IDS?.split(',').map((id) => id.trim()).filter(Boolean);
    return ids?.length ? [...new Set(ids)] : [];
  }

  private intEnv(name: string, fallback: number, min: number, max: number): number {
    const value = Number(process.env[name]);
    return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
  }

  private failureReason(error: unknown): string {
    if (error instanceof Mt5BridgeTickError) {
      const reasons: Record<Mt5BridgeTickError['category'], string> = {
        BRIDGE_INCOMPATIBLE: 'TICK_INVALID_PAYLOAD',
        TICK_INVALID_REQUEST: 'TICK_INVALID_PAYLOAD',
        TICK_CURSOR_EXPIRED: 'TICK_CURSOR_EXPIRED',
        MT5_BRIDGE_UNAUTHORIZED: 'TICK_IDENTITY_MISMATCH',
        TICK_IDENTITY_MISMATCH: 'TICK_IDENTITY_MISMATCH',
        TICK_SOURCE_LIMIT: 'TICK_SOURCE_LIMIT',
        VALUATION_UNSUPPORTED: 'UNSUPPORTED_VALUATION',
        TICK_CAPACITY: 'TICK_CAPACITY',
        TICK_DEADLINE: 'TICK_DEADLINE',
        TICK_UNAVAILABLE: 'TICK_UNAVAILABLE',
        TICK_INVALID_PAYLOAD: 'TICK_INVALID_PAYLOAD',
      };
      return reasons[error.category];
    }
    const message = error instanceof Error ? error.message : String(error);
    if (/sync priority yield/i.test(message)) return 'SYNC_PRIORITY_YIELD';
    if (/stale|generation|claim/i.test(message)) return 'stale';
    if (/capabilit|offline|network|timeout|abort/i.test(message)) return 'TRANSIENT_BRIDGE_FAILURE';
    return 'CALCULATION_FAILURE';
  }
}
