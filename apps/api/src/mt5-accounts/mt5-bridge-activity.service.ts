import { Injectable } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

type Db = PrismaService | PrismaClient | Prisma.TransactionClient;

const WORKER_SLOT_ID = 'worker';
const HALT_ID = 'halt';

@Injectable()
export class Mt5BridgeActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async registerSyncIntent(accountId: string, leaseMs = 6 * 60_000): Promise<string> {
    const leaseId = randomUUID();
    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      await this.cleanupExpired(tx, now);
      await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended('mt5-bridge-worker-slot', 0))::text AS locked`);
      await tx.mt5BridgeActivity.create({
        data: { id: `sync:${leaseId}`, kind: 'SYNC', accountId, leaseId, expiresAt: new Date(now.getTime() + leaseMs) },
      });
    });
    return leaseId;
  }

  async refreshSyncIntent(leaseId: string, leaseMs = 6 * 60_000): Promise<void> {
    await this.prisma.mt5BridgeActivity.updateMany({
      where: { kind: 'SYNC', leaseId },
      data: { expiresAt: new Date(Date.now() + leaseMs) },
    });
  }

  async releaseSyncIntent(leaseId: string): Promise<void> {
    await this.prisma.mt5BridgeActivity.deleteMany({ where: { kind: 'SYNC', leaseId } });
  }

  async waitForWorkerYield(leaseId: string, timeoutMs = 15_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await this.refreshSyncIntent(leaseId);
      await this.cleanupExpired(this.prisma, new Date());
      const [worker, nextSync] = await Promise.all([
        this.prisma.mt5BridgeActivity.findFirst({ where: { kind: 'WORKER' }, select: { id: true } }),
        this.prisma.mt5BridgeActivity.findFirst({ where: { kind: 'SYNC' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { leaseId: true } }),
      ]);
      if (!worker && nextSync?.leaseId === leaseId) return true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return false;
  }

  async acquireWorkerLease(leaseMs: number): Promise<string | null> {
    const leaseId = randomUUID();
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      await this.cleanupExpired(tx, now);
      await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended('mt5-bridge-worker-slot', 0))::text AS locked`);
      if (await tx.mt5BridgeActivity.findFirst({ where: { kind: { in: ['SYNC', 'WORKER', 'HALT'] } }, select: { id: true } })) return null;
      await tx.mt5BridgeActivity.upsert({
        where: { id: WORKER_SLOT_ID },
        create: { id: WORKER_SLOT_ID, kind: 'WORKER', leaseId, expiresAt: new Date(now.getTime() + leaseMs) },
        update: { kind: 'WORKER', leaseId, expiresAt: new Date(now.getTime() + leaseMs), reason: null },
      });
      return leaseId;
    });
  }

  async releaseWorkerLease(leaseId: string): Promise<void> {
    await this.prisma.mt5BridgeActivity.deleteMany({ where: { id: WORKER_SLOT_ID, kind: 'WORKER', leaseId } });
  }

  async syncRequested(): Promise<boolean> {
    await this.cleanupExpired(this.prisma, new Date());
    return Boolean(await this.prisma.mt5BridgeActivity.findFirst({ where: { kind: 'SYNC' }, select: { id: true } }));
  }

  async haltWorker(reason: string): Promise<void> {
    await this.prisma.mt5BridgeActivity.upsert({
      where: { id: HALT_ID },
      create: { id: HALT_ID, kind: 'HALT', reason },
      update: { kind: 'HALT', reason, leaseId: null, expiresAt: null },
    });
  }

  private async cleanupExpired(db: Db, now: Date): Promise<void> {
    await db.mt5BridgeActivity.deleteMany({ where: { kind: { in: ['SYNC', 'WORKER'] }, expiresAt: { lte: now } } });
  }
}
