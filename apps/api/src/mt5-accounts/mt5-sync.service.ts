import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Mt5SyncResponse } from '@trading-journal/shared';
import { Prisma, TradeSide, TradeStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CredentialCipherService } from './credential-cipher.service';
import { Mt5BridgeClient, Mt5DealFact, Mt5OrderFact } from './mt5-bridge.client';

const LEASE_MS = 60_000;
class StaleSyncResult extends Error {}

export const seoulTradingDate = (value: Date): Date => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  return new Date(`${part('year')}-${part('month')}-${part('day')}T00:00:00.000Z`);
};

@Injectable()
export class Mt5SyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: CredentialCipherService,
    private readonly bridge: Mt5BridgeClient,
  ) {}

  async sync(ownerId: string, accountId: string): Promise<Mt5SyncResponse> {
    const claimed = await this.claim(ownerId, accountId);
    if (!claimed) return { state: 'in_progress', accountId, message: 'Synchronization is already in progress' };

    const { account, leaseId, cursor } = claimed;
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
        ...(cursor !== undefined && { cursor }),
      });
      const syncedAt = new Date();
      const result = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM mt5_accounts WHERE id = ${accountId} FOR UPDATE`);
        const fenceAt = new Date();
        const liveAccount = await tx.mt5Account.findFirst({
          where: {
            id: accountId,
            ownerId,
            active: true,
            canonicalServer: account.canonicalServer,
            accountLogin: account.accountLogin,
            credentialVersion: account.credentialVersion,
            credentialCiphertext: { equals: account.credentialCiphertext },
            credentialIv: { equals: account.credentialIv },
            credentialTag: { equals: account.credentialTag },
            lease: { leaseId, expiresAt: { gt: fenceAt } },
          },
        });
        if (!liveAccount) throw new StaleSyncResult();

        for (const deal of payload.deals) await this.upsertDeal(tx, accountId, account.canonicalServer, account.accountLogin, deal, syncedAt);
        for (const order of payload.orders) await this.upsertOrder(tx, accountId, account.canonicalServer, account.accountLogin, order, syncedAt);
        const importedCount = await this.projectTrades(tx, ownerId, accountId, account.canonicalServer, account.accountLogin, payload.deals, payload.orders);
        const lastDealTime = payload.deals.length
          ? new Date(Math.max(...payload.deals.map((deal) => deal.timeMsc)))
          : undefined;
        await tx.mt5SyncStatus.upsert({
          where: { server_accountLogin: { server: account.canonicalServer, accountLogin: account.accountLogin } },
          create: { accountId, server: account.canonicalServer, accountLogin: account.accountLogin, cursor: payload.cursor, lastSyncAt: syncedAt, lastDealTime, lastReceivedDealCount: payload.deals.length },
          update: { cursor: payload.cursor, lastSyncAt: syncedAt, ...(lastDealTime && { lastDealTime }), lastReceivedDealCount: payload.deals.length, lastError: null },
        });
        const deleted = await tx.mt5SyncLease.deleteMany({ where: { accountId, leaseId, expiresAt: { gt: new Date() } } });
        if (deleted.count !== 1) throw new StaleSyncResult();
        return importedCount;
      });
      return { state: 'completed', accountId, importedCount: result, receivedCount: payload.deals.length, cursor: payload.cursor, syncedAt: syncedAt.toISOString() } as Mt5SyncResponse;
    } catch (error) {
      if (error instanceof StaleSyncResult) {
        await this.prisma.mt5SyncLease.deleteMany({ where: { accountId, leaseId } });
        return { state: 'failed', accountId, message: 'Synchronization result expired' };
      }
      await this.prisma.$transaction([
        this.prisma.mt5SyncLease.deleteMany({ where: { accountId, leaseId } }),
        this.prisma.mt5SyncStatus.updateMany({ where: { accountId }, data: { lastError: this.safeErrorCategory(error) } }),
      ]);
      return { state: 'failed', accountId, message: 'MT5 synchronization failed' };
    }
  }

  private async claim(ownerId: string, accountId: string) {
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
      const status = await tx.mt5SyncStatus.findUnique({ where: { accountId } });
      return { account, leaseId, cursor: status?.cursor ?? undefined };
    });
  }

  private upsertDeal(tx: Prisma.TransactionClient, accountId: string, server: string, accountLogin: bigint, deal: Mt5DealFact, fetchedAt: Date) {
    const data = {
      accountId, server, accountLogin, ticket: BigInt(deal.ticket), order: BigInt(deal.order), positionId: BigInt(deal.positionId),
      time: BigInt(deal.time), timeMsc: BigInt(deal.timeMsc), timeUtc: new Date(deal.time * 1000), timeMscUtc: new Date(deal.timeMsc),
      type: deal.type, entry: deal.entry, magic: BigInt(deal.magic), reason: deal.reason, volume: deal.volume, price: deal.price,
      commission: deal.commission, swap: deal.swap, profit: deal.profit, fee: deal.fee, symbol: deal.symbol, comment: deal.comment,
      externalId: deal.externalId, fetchedAt, rawJson: deal as unknown as Prisma.InputJsonValue,
    };
    return tx.mt5Deal.upsert({ where: { server_accountLogin_ticket: { server, accountLogin, ticket: BigInt(deal.ticket) } }, create: data, update: data });
  }

  private upsertOrder(tx: Prisma.TransactionClient, accountId: string, server: string, accountLogin: bigint, order: Mt5OrderFact, fetchedAt: Date) {
    const data = {
      accountId, server, accountLogin, ticket: BigInt(order.ticket), positionId: BigInt(order.positionId),
      timeSetup: BigInt(order.timeSetup), timeSetupMsc: BigInt(order.timeSetupMsc), timeSetupUtc: new Date(order.timeSetup * 1000), timeSetupMscUtc: new Date(order.timeSetupMsc),
      timeDone: BigInt(order.timeDone), timeDoneMsc: BigInt(order.timeDoneMsc), timeDoneUtc: new Date(order.timeDone * 1000), timeDoneMscUtc: new Date(order.timeDoneMsc),
      type: order.type, state: order.state, reason: order.reason, volumeInitial: order.volumeInitial, volumeCurrent: order.volumeCurrent,
      priceOpen: order.priceOpen, sl: order.sl, tp: order.tp, priceCurrent: order.priceCurrent, priceStopLimit: order.priceStopLimit,
      symbol: order.symbol, comment: order.comment, externalId: order.externalId, fetchedAt, rawJson: order as unknown as Prisma.InputJsonValue,
    };
    return tx.mt5Order.upsert({ where: { server_accountLogin_ticket: { server, accountLogin, ticket: BigInt(order.ticket) } }, create: data, update: data });
  }

  private async projectTrades(tx: Prisma.TransactionClient, ownerId: string, accountId: string, server: string, accountLogin: bigint, incomingDeals: Mt5DealFact[], incomingOrders: Mt5OrderFact[]): Promise<number> {
    const positionIds = [...new Set([
      ...incomingDeals.map((deal) => deal.positionId),
      ...incomingOrders.map((order) => order.positionId),
    ].filter((id) => BigInt(id) > 0n))];
    for (const positionId of positionIds) {
      const deals = await tx.mt5Deal.findMany({ where: { server, accountLogin, positionId: BigInt(positionId) }, orderBy: [{ timeMsc: 'asc' }, { ticket: 'asc' }] });
      const orders = await tx.mt5Order.findMany({
        where: { server, accountLogin, positionId: BigInt(positionId) },
        orderBy: [{ timeSetupMsc: 'desc' }, { ticket: 'desc' }],
      });
      const takeProfitPrice = orders.find((order) => Number(order.tp) !== 0)?.tp;
      const stopLossPrice = orders.find((order) => Number(order.sl) !== 0)?.sl;
      if (!deals.length) continue;
      const entries = deals.filter((deal) => deal.entry === 0 || deal.entry === 2);
      const exits = deals.filter((deal) => deal.entry === 1 || deal.entry === 2);
      const opened = entries[0] ?? deals[0];
      const entryVolume = entries.reduce((sum, deal) => sum + Number(deal.volume), 0);
      const exitVolume = exits.reduce((sum, deal) => sum + Number(deal.volume), 0);
      const weighted = (rows: typeof deals) => rows.reduce((sum, deal) => sum + Number(deal.price) * Number(deal.volume), 0) / rows.reduce((sum, deal) => sum + Number(deal.volume), 0);
      const closed = entryVolume > 0 && exitVolume >= entryVolume;
      const data = {
        ownerId, mt5AccountId: accountId, symbol: opened.symbol, side: opened.type === 1 ? TradeSide.SHORT : TradeSide.LONG,
        status: closed ? TradeStatus.CLOSED : TradeStatus.OPEN, quantityLots: entryVolume, entryPrice: entries.length ? weighted(entries) : Number(opened.price),
        ...(exits.length && { exitPrice: weighted(exits) }), realizedPnl: deals.reduce((sum, deal) => sum + Number(deal.profit) + Number(deal.commission) + Number(deal.swap) + Number(deal.fee), 0),
        openedAt: opened.timeMscUtc, ...(closed && { closedAt: exits[exits.length - 1].timeMscUtc }),
        takeProfitPrice: takeProfitPrice ?? null,
        stopLossPrice: stopLossPrice ?? null,
      };
      const trade = await tx.trade.upsert({
        where: { mt5Server_mt5AccountLogin_mt5PositionId: { mt5Server: server, mt5AccountLogin: accountLogin, mt5PositionId: BigInt(positionId) } },
        create: {
          ...data, mt5Server: server, mt5AccountLogin: accountLogin, mt5PositionId: BigInt(positionId),
          analysis: { create: {} },
          entry: { create: { price: entries.length ? weighted(entries) : Number(opened.price), quantity: entryVolume || Number(opened.volume), occurredAt: opened.timeMscUtc } },
          ...(exits.length && { exit: { create: { price: weighted(exits), quantity: exitVolume, occurredAt: exits[exits.length - 1].timeMscUtc } } }),
        },
        update: {
          ...data,
          analysis: { upsert: { create: {}, update: {} } },
          entry: { upsert: { create: { price: entries.length ? weighted(entries) : Number(opened.price), quantity: entryVolume || Number(opened.volume), occurredAt: opened.timeMscUtc }, update: { price: entries.length ? weighted(entries) : Number(opened.price), quantity: entryVolume || Number(opened.volume), occurredAt: opened.timeMscUtc } } },
          ...(exits.length && { exit: { upsert: { create: { price: weighted(exits), quantity: exitVolume, occurredAt: exits[exits.length - 1].timeMscUtc }, update: { price: weighted(exits), quantity: exitVolume, occurredAt: exits[exits.length - 1].timeMscUtc } } } }),
        },
      });
      const tradingDate = seoulTradingDate(opened.timeMscUtc);
      const campaign = await tx.tradeCampaign.upsert({
        where: { rootTradeId: trade.id },
        create: { rootTradeId: trade.id, tradingDate, ownerId, mt5AccountId: accountId },
        update: {},
      });
      await tx.campaignMembership.upsert({
        where: { tradeId: trade.id },
        create: { tradeId: trade.id, campaignId: campaign.id, source: 'AUTO' },
        update: {},
      });
    }
    return positionIds.length;
  }

  private safeErrorCategory(error: unknown): string {
    if (!(error instanceof Error)) return 'MT5_SYNC_UNKNOWN';
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
