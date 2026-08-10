import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Mt5SyncResponse } from '@trading-journal/shared';
import { Prisma, TradeSide, TradeStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CredentialCipherService } from './credential-cipher.service';
import { lockOwnedMt5Account } from './mt5-account-lock';
import { Mt5BridgeClient, Mt5DealFact, Mt5OrderFact, Mt5PositionEntryPlanFact } from './mt5-bridge.client';

const LEASE_MS = 60_000;
class StaleSyncResult extends Error {}
const DEAL_FACT_FIELDS = ['ticket', 'order', 'positionId', 'time', 'timeMsc', 'type', 'entry', 'magic', 'reason', 'volume', 'price', 'commission', 'swap', 'profit', 'fee', 'symbol', 'comment', 'externalId'] as const;
const ORDER_FACT_FIELDS = ['ticket', 'positionId', 'timeSetup', 'timeSetupMsc', 'timeDone', 'timeDoneMsc', 'type', 'state', 'reason', 'volumeInitial', 'volumeCurrent', 'priceOpen', 'sl', 'tp', 'priceCurrent', 'priceStopLimit', 'symbol', 'comment', 'externalId'] as const;

function canonicalFact(value: unknown, fields: readonly string[]): string {
  const fact = value as Record<string, unknown>;
  return JSON.stringify(fields.map((field) => [field, fact[field]]));
}
const METRIC_CONTRACT_VERSION = 1;


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
        server: account.server,
        accountLogin: Number(account.accountLogin),
        password,
        ...(cursor !== undefined && { cursor }),
      });
      const renewed = await this.prisma.mt5SyncLease.updateMany({
        where: { accountId, leaseId, expiresAt: { gt: new Date() } },
        data: { expiresAt: new Date(Date.now() + LEASE_MS) },
      });
      if (renewed.count !== 1) throw new StaleSyncResult();
      const syncedAt = new Date();
      const result = await this.prisma.$transaction(async (tx) => {
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

        const assertions = [
          ...payload.positionEntryBalances.map((row) => ({ ...row, state: 'PROVEN' as const, reason: null })),
          ...payload.unsupportedPositionEntryBalances.map((row) => ({
            ...row,
            state: row.kind === 'ANCHORED' ? 'UNSUPPORTED_ANCHORED' as const : 'UNSUPPORTED_UNANCHORED' as const,
          })),
        ];
        await this.validateEntryBalanceAssertions(tx, account.canonicalServer, account.accountLogin, payload.deals, assertions);
        const changedPositions = new Set<string>();
        for (const deal of payload.deals) if (await this.upsertDeal(tx, accountId, account.canonicalServer, account.accountLogin, deal, syncedAt, account.timeCorrectionHours ?? 0)) changedPositions.add(deal.positionId);
        for (const order of payload.orders) if (await this.upsertOrder(tx, accountId, account.canonicalServer, account.accountLogin, order, syncedAt, account.timeCorrectionHours ?? 0)) changedPositions.add(order.positionId);
        for (const plan of payload.positionEntryPlans) if (BigInt(plan.positionId) > 0n) changedPositions.add(plan.positionId);
        for (const assertion of assertions) {
          const changed = await this.persistEntryBalanceAssertion(tx, accountId, account.canonicalServer, account.accountLogin, assertion, syncedAt);
          if (changed) changedPositions.add(assertion.positionId);
        }
        const unsupportedUnanchored = new Set(assertions.filter((row) => row.state === 'UNSUPPORTED_UNANCHORED').map((row) => row.positionId));
        const importedCount = await this.projectTrades(tx, ownerId, accountId, account.server, account.canonicalServer, account.accountLogin, [...changedPositions].filter((id) => !unsupportedUnanchored.has(id)), assertions, payload.positionEntryPlans);
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

  private async upsertDeal(tx: Prisma.TransactionClient, accountId: string, server: string, accountLogin: bigint, deal: Mt5DealFact, fetchedAt: Date, correctionHours: number) {
    const key = { server_accountLogin_ticket: { server, accountLogin, ticket: BigInt(deal.ticket) } };
    const existing = await tx.mt5Deal.findUnique({ where: key, select: { rawJson: true, timeMscUtc: true } });
    const correctedTimeMsc = new Date(deal.timeMsc + correctionHours * 3_600_000);
    if (existing && canonicalFact(existing.rawJson, DEAL_FACT_FIELDS) === canonicalFact(deal, DEAL_FACT_FIELDS)
      && existing.timeMscUtc.getTime() === correctedTimeMsc.getTime()) return false;
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

  private async upsertOrder(tx: Prisma.TransactionClient, accountId: string, server: string, accountLogin: bigint, order: Mt5OrderFact, fetchedAt: Date, correctionHours: number) {
    const key = { server_accountLogin_ticket: { server, accountLogin, ticket: BigInt(order.ticket) } };
    const existing = await tx.mt5Order.findUnique({ where: key, select: { rawJson: true, timeSetupMscUtc: true, timeDoneMscUtc: true } });
    const correctedSetup = new Date(order.timeSetupMsc + correctionHours * 3_600_000);
    const correctedDone = new Date(order.timeDoneMsc + correctionHours * 3_600_000);
    if (existing && canonicalFact(existing.rawJson, ORDER_FACT_FIELDS) === canonicalFact(order, ORDER_FACT_FIELDS)
      && existing.timeSetupMscUtc.getTime() === correctedSetup.getTime()
      && existing.timeDoneMscUtc.getTime() === correctedDone.getTime()) return false;
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

  private async validateEntryBalanceAssertions(tx: Prisma.TransactionClient, server: string, accountLogin: bigint, incomingDeals: Mt5DealFact[], assertions: any[]): Promise<void> {
    const executionPositionIds = new Set(incomingDeals.filter((deal) => BigInt(deal.positionId) > 0n).map((deal) => deal.positionId));
    const persistedDeals = await tx.mt5Deal.findMany({ where: { server, accountLogin }, select: { ticket: true, order: true, positionId: true, timeMsc: true, entry: true, type: true } });
    for (const deal of persistedDeals) if (deal.positionId > 0n) executionPositionIds.add(deal.positionId.toString());
    const seenPositions = new Set<string>();
    const seenAnchors = new Set<string>();
    for (const assertion of assertions) {
      if (!assertion || seenPositions.has(assertion.positionId) || BigInt(assertion.positionId) <= 0n) throw new Error('invalid entry balance assertion position');
      seenPositions.add(assertion.positionId);
      if (assertion.ledgerSemanticsVersion !== 1) throw new Error('invalid entry balance assertion semantics');
      const allDeals = [...incomingDeals, ...persistedDeals.map((deal) => ({ ...deal, ticket: deal.ticket.toString(), order: deal.order.toString(), positionId: deal.positionId.toString(), timeMsc: Number(deal.timeMsc) }))];
      if (assertion.state === 'UNSUPPORTED_UNANCHORED') {
        if (assertion.reason !== 'OPENING_DEAL_OUTSIDE_HISTORY' || 'entryDealTicket' in assertion || 'entryOrderTicket' in assertion || 'entryTimeMsc' in assertion || 'preEntryBalance' in assertion) throw new Error('invalid unanchored entry balance assertion');
        const positionDeals = allDeals.filter((deal) => deal.positionId === assertion.positionId);
        if (!positionDeals.length || positionDeals.some((deal) => this.isOpeningExecution(deal))) throw new Error('invalid unanchored entry balance assertion');
        continue;
      }
      if (!assertion.entryDealTicket || !assertion.entryOrderTicket || !Number.isSafeInteger(assertion.entryTimeMsc) || seenAnchors.has(assertion.entryDealTicket)) throw new Error('invalid anchored entry balance assertion');
      seenAnchors.add(assertion.entryDealTicket);
      const anchor = allDeals.find((deal) => deal.ticket === assertion.entryDealTicket);
      if (!anchor || anchor.positionId !== assertion.positionId || anchor.order !== assertion.entryOrderTicket || anchor.timeMsc !== assertion.entryTimeMsc || !this.isOpeningExecution(anchor)) throw new Error('entry balance assertion does not match raw opening deal');
    }
    if (seenPositions.size !== executionPositionIds.size || [...executionPositionIds].some((positionId) => !seenPositions.has(positionId))) throw new Error('incomplete entry balance assertions');
  }

  private async persistEntryBalanceAssertion(tx: Prisma.TransactionClient, accountId: string, server: string, accountLogin: bigint, assertion: any, fetchedAt: Date): Promise<boolean> {
    const key = { server_accountLogin_positionId: { server, accountLogin, positionId: BigInt(assertion.positionId) } };
    const existing = await tx.mt5PositionEntryBalance.findUnique({ where: key });
    const data = {
      accountId, server, accountLogin, positionId: BigInt(assertion.positionId),
      entryDealTicket: assertion.state === 'UNSUPPORTED_UNANCHORED' ? null : BigInt(assertion.entryDealTicket),
      entryOrderTicket: assertion.state === 'UNSUPPORTED_UNANCHORED' ? null : BigInt(assertion.entryOrderTicket),
      entryTimeMsc: assertion.state === 'UNSUPPORTED_UNANCHORED' ? null : BigInt(assertion.entryTimeMsc),
      entryTimeMscUtc: assertion.state === 'UNSUPPORTED_UNANCHORED' ? null : new Date(assertion.entryTimeMsc),
      ledgerSemanticsVersion: assertion.ledgerSemanticsVersion, state: assertion.state,
      preEntryBalance: assertion.state === 'PROVEN' ? assertion.preEntryBalance : null,
      reason: assertion.state === 'PROVEN' ? null : assertion.reason, fetchedAt,
    };
    if (existing) {
      const immutable = ['entryDealTicket', 'entryOrderTicket', 'entryTimeMsc', 'ledgerSemanticsVersion', 'state', 'preEntryBalance', 'reason'] as const;
      if (immutable.some((field) => String(existing[field] ?? '') !== String(data[field] ?? ''))) throw new Error('entry balance assertion conflicts with immutable state');
      await tx.mt5PositionEntryBalance.update({ where: key, data: { fetchedAt } });
      return false;
    }
    await tx.mt5PositionEntryBalance.create({ data: data as never });
    return true;
  }
  private async projectTrades(tx: Prisma.TransactionClient, ownerId: string, accountId: string, exactServer: string, canonicalServer: string, accountLogin: bigint, positionIds: string[], assertions: Array<{ positionId: string; state: string; preEntryBalance?: string }>, incomingPlans: Mt5PositionEntryPlanFact[]): Promise<number> {
    const uniquePositionIds = [...new Set(positionIds.filter((id) => BigInt(id) > 0n))];
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
      const metrics = initialPlan ? this.initialPlanMetrics(initialPlan) : null;
      const metricData = initialPlan && metrics
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
      const existingTrade = await tx.trade.findUnique({
        where: { mt5ServerCanonical_mt5AccountLogin_mt5PositionId: { mt5ServerCanonical: canonicalServer, mt5AccountLogin: accountLogin, mt5PositionId: BigInt(positionId) } },
        select: { riskAmount: true, riskPercent: true, returnPercent: true, initialPlanId: true, initialPlanMetricContractVersion: true },
      });
      this.assertMetricState(existingTrade, initialPlan, metrics);
      const data = {
        ownerId, mt5AccountId: accountId, symbol: opened.symbol, side: opened.type === 1 ? TradeSide.SHORT : TradeSide.LONG,
        status: closed ? TradeStatus.CLOSED : TradeStatus.OPEN, quantityLots: entryVolume, entryPrice: entries.length ? weighted(entries) : Number(opened.price),
        ...(exits.length && { exitPrice: weighted(exits) }), realizedPnl: deals.reduce((sum, deal) => sum + Number(deal.profit) + Number(deal.commission) + Number(deal.swap) + Number(deal.fee), 0),
        openedAt: opened.timeMscUtc, ...(closed && { closedAt: exits[exits.length - 1].timeMscUtc }),
        takeProfitPrice: takeProfitPrice ?? null,
        stopLossPrice: stopLossPrice ?? null,
        seedBalance: balance?.preEntryBalance ?? null,
        ...metricData,
      };
      const trade = await tx.trade.upsert({
        where: { mt5ServerCanonical_mt5AccountLogin_mt5PositionId: { mt5ServerCanonical: canonicalServer, mt5AccountLogin: accountLogin, mt5PositionId: BigInt(positionId) } },
        create: {
          ...data, mt5Server: exactServer, mt5ServerCanonical: canonicalServer, mt5AccountLogin: accountLogin, mt5PositionId: BigInt(positionId),
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
      const membership = await tx.campaignMembership.findUnique({ where: { tradeId: trade.id } });
      if (!membership) {
        const tradingDate = seoulTradingDate(opened.timeMscUtc);
        const campaign = await tx.tradeCampaign.upsert({
          where: { rootTradeId: trade.id },
          create: { rootTradeId: trade.id, tradingDate, ownerId, mt5AccountId: accountId },
          update: {},
        });
        await tx.campaignMembership.create({
          data: { tradeId: trade.id, campaignId: campaign.id, source: 'AUTO' },
        });
      }
      projectedCount += 1;
    }
    return projectedCount;
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
  } | null, plan: { id: string; metricContractVersion: number } | null, metrics: { riskAmount: Prisma.Decimal; riskPercent: Prisma.Decimal; returnPercent: Prisma.Decimal } | null): void {
    if (!existing) return;
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
