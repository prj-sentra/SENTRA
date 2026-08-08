import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Mt5SyncResponse } from '@trading-journal/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TradeLogService } from '../trade-log/trade-log.service';
import { CredentialCipherService } from './credential-cipher.service';
import { Mt5BridgeClient } from './mt5-bridge.client';

const LEASE_MS = 60_000;

@Injectable()
export class Mt5SyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: CredentialCipherService,
    private readonly bridge: Mt5BridgeClient,
    private readonly tradeLog: TradeLogService,
  ) {}

  async sync(ownerId: string, accountId: string): Promise<Mt5SyncResponse> {
    const claimed = await this.claim(ownerId, accountId);
    if (!claimed) return { state: 'in_progress', accountId, message: 'Synchronization is already in progress' };

    const { account, leaseId } = claimed;
    try {
      const password = this.cipher.decrypt({
        ciphertext: Buffer.from(account.credentialCiphertext),
        iv: Buffer.from(account.credentialIv),
        tag: Buffer.from(account.credentialTag),
        version: account.credentialVersion,
      });
      const payload = await this.bridge.sync({
        server: account.canonicalServer,
        accountLogin: Number(account.accountLogin),
        password,
      });

      const live = await this.prisma.mt5SyncLease.count({
        where: { accountId, leaseId, expiresAt: { gt: new Date() } },
      });
      if (live !== 1) return { state: 'failed', accountId, message: 'Synchronization result expired' };

      const applied = await this.tradeLog.applyAssistantActions(payload.actions);
      const syncedAt = new Date();
      const committed = await this.prisma.$transaction(async (tx) => {
        const deleted = await tx.mt5SyncLease.deleteMany({ where: { accountId, leaseId, expiresAt: { gt: syncedAt } } });
        if (deleted.count !== 1) return false;
        await tx.mt5SyncStatus.upsert({
          where: { server_accountLogin: { server: account.canonicalServer, accountLogin: account.accountLogin } },
          create: { accountId, server: account.canonicalServer, accountLogin: account.accountLogin, lastSyncAt: syncedAt, lastReceivedDealCount: applied.trades.length },
          update: { lastSyncAt: syncedAt, lastReceivedDealCount: applied.trades.length, lastError: null },
        });
        return true;
      });
      if (!committed) return { state: 'failed', accountId, message: 'Synchronization result expired' };
      return { state: 'completed', accountId, importedCount: applied.trades.length, syncedAt: syncedAt.toISOString() };
    } catch {
      await this.prisma.$transaction([
        this.prisma.mt5SyncLease.deleteMany({ where: { accountId, leaseId } }),
        this.prisma.mt5SyncStatus.updateMany({ where: { accountId }, data: { lastError: 'MT5 synchronization failed' } }),
      ]);
      return { state: 'failed', accountId, message: 'MT5 synchronization failed' };
    }
  }

  private async claim(ownerId: string, accountId: string) {
    const account = await this.prisma.mt5Account.findFirst({ where: { id: accountId, ownerId, active: true } });
    if (!account) throw new NotFoundException('MT5 account not found');
    const now = new Date();
    const leaseId = randomUUID();
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.mt5SyncLease.deleteMany({ where: { accountId, expiresAt: { lte: now } } });
        await tx.mt5SyncLease.create({ data: { accountId, leaseId, claimedAt: now, expiresAt: new Date(now.getTime() + LEASE_MS) } });
      });
      return { account, leaseId };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return null;
      throw error;
    }
  }

  assertTrustedToken(provided: string | undefined): void {
    const expected = process.env.MT5_SYNC_TOKEN?.trim();
    if (!expected || !provided || provided !== expected) throw new UnauthorizedException('Trusted sync route required');
  }
}
