import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateTradeRequest,
  HealthResponse,
  TradeEntryRequest,
  TradeExitRequest,
  TradeJournalContext,
  TradeLogAssistantActionsRequest,
  TradeLogAssistantActionsResponse,
  TradeRecord,
  UpdateTradeJournalRequest,
} from '@trading-journal/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  validateCreateTradeRequest,
  validateTradeEntryRequest,
  validateTradeExitRequest,
  validateTradeJournalPatchRequest,
} from './trade-log.validation';

type TradeWithEvents = Awaited<ReturnType<PrismaService['trade']['findFirstOrThrow']>> & {
  journal?: unknown;
  entry?: {
    price: { toNumber(): number };
    quantity: { toNumber(): number } | null;
    occurredAt: Date;
    note: string | null;
  } | null;
  exit?: {
    price: { toNumber(): number };
    quantity: { toNumber(): number } | null;
    occurredAt: Date;
    reason: string | null;
    note: string | null;
  } | null;
};

@Injectable()
export class TradeLogService {
  constructor(private readonly prisma: PrismaService) {}

  health(): HealthResponse {
    return {
      status: 'ok',
      service: 'sentra-trade-log',
      timestamp: new Date().toISOString(),
    };
  }

  async createTrade(request: CreateTradeRequest): Promise<TradeRecord> {
    validateCreateTradeRequest(request);

    const trade = await this.prisma.trade.create({
      data: {
        symbol: request.symbol,
        side: request.side,
        status: 'planned',
        timeframe: request.timeframe,
        session: request.session,
        strategy: request.strategy,
        thesis: request.thesis,
        note: request.note,
        journal: this.toPrismaJson(request.journal),
      },
      include: { entry: true, exit: true },
    });

    return this.toTradeRecord(trade);
  }

  async listTrades(): Promise<TradeRecord[]> {
    const trades = await this.prisma.trade.findMany({
      include: { entry: true, exit: true },
      orderBy: { createdAt: 'asc' },
    });
    return trades.map((trade) => this.toTradeRecord(trade));
  }

  async getTrade(id: string): Promise<TradeRecord> {
    const trade = await this.prisma.trade.findUnique({
      where: { id },
      include: { entry: true, exit: true },
    });
    if (!trade) {
      throw new NotFoundException(`Trade not found: ${id}`);
    }
    return this.toTradeRecord(trade);
  }

  async patchTradeJournal(id: string, request: UpdateTradeJournalRequest): Promise<TradeRecord> {
    validateTradeJournalPatchRequest(request);

    const trade = await this.getTrade(id);
    const mergedJournal = this.mergeTradeJournal(trade.journal, request);

    const updated = await this.prisma.trade.update({
      where: { id },
      data: {
        journal: this.toPrismaJson(mergedJournal),
      },
      include: { entry: true, exit: true },
    });

    return this.toTradeRecord(updated);
  }

  async recordEntry(id: string, request: TradeEntryRequest): Promise<TradeRecord> {
    validateTradeEntryRequest(request);

    const trade = await this.getTrade(id);
    if (trade.entry) {
      throw new BadRequestException('Trade already has an entry');
    }
    if (trade.status === 'closed') {
      throw new BadRequestException('Cannot enter a closed trade');
    }

    const occurredAt = new Date(request.occurredAt);
    const detectedSession = this.detectSessionFromOccurredAt(occurredAt);

    const updated = await this.prisma.trade.update({
      where: { id },
      data: {
        status: 'open',
        session: detectedSession,
        entry: {
          create: {
            price: request.price,
            quantity: request.quantity,
            occurredAt,
            note: request.note,
          },
        },
      },
      include: { entry: true, exit: true },
    });

    return this.toTradeRecord(updated);
  }

  async recordExit(id: string, request: TradeExitRequest): Promise<TradeRecord> {
    validateTradeExitRequest(request);

    const trade = await this.getTrade(id);
    if (!trade.entry) {
      throw new BadRequestException('Cannot exit before entry');
    }
    if (trade.exit) {
      throw new BadRequestException('Trade already has an exit');
    }

    const updated = await this.prisma.trade.update({
      where: { id },
      data: {
        status: 'closed',
        exit: {
          create: {
            price: request.price,
            quantity: request.quantity,
            occurredAt: new Date(request.occurredAt),
            reason: request.reason,
            note: request.note,
          },
        },
      },
      include: { entry: true, exit: true },
    });

    return this.toTradeRecord(updated);
  }

  async applyAssistantActions(
    request: TradeLogAssistantActionsRequest,
  ): Promise<TradeLogAssistantActionsResponse> {
    const touchedTrades: TradeRecord[] = [];
    let lastCreatedTradeId: string | undefined;

    for (const action of request.actions) {
      if (action.type === 'create_trade') {
        const trade = await this.createTrade({
          ...action.payload,
          note: action.payload.note ?? request.rawText,
        });
        lastCreatedTradeId = trade.id;
        touchedTrades.push(trade);
        continue;
      }

      if (action.type === 'record_entry') {
        const tradeId = action.tradeRef === 'last_created' ? lastCreatedTradeId : undefined;
        if (!tradeId) {
          throw new BadRequestException('record_entry requires tradeRef last_created');
        }
        const updated = await this.recordEntry(tradeId, action.payload);
        this.upsertTouchedTrade(touchedTrades, updated);
        continue;
      }

      if (action.type === 'patch_trade_journal') {
        const updated = await this.patchTradeJournal(action.tradeId, action.payload);
        this.upsertTouchedTrade(touchedTrades, updated);
        continue;
      }

      const updated = await this.recordExit(action.tradeId, action.payload);
      this.upsertTouchedTrade(touchedTrades, updated);
    }

    return {
      rawText: request.rawText,
      source: request.source,
      trades: touchedTrades,
    };
  }

  private upsertTouchedTrade(trades: TradeRecord[], updated: TradeRecord): void {
    const index = trades.findIndex((trade) => trade.id === updated.id);
    if (index >= 0) {
      trades[index] = updated;
    } else {
      trades.push(updated);
    }
  }

  private mergeTradeJournal(
    existing: TradeJournalContext | undefined,
    patch: UpdateTradeJournalRequest,
  ): TradeJournalContext | undefined {
    const merged: TradeJournalContext = {
      plan: patch.plan ? { ...(existing?.plan ?? {}), ...patch.plan } : existing?.plan,
      management: patch.management
        ? { ...(existing?.management ?? {}), ...patch.management }
        : existing?.management,
      review: patch.review ? { ...(existing?.review ?? {}), ...patch.review } : existing?.review,
    };

    return this.compactTradeJournal(merged);
  }

  private compactTradeJournal(journal: TradeJournalContext | undefined): TradeJournalContext | undefined {
    if (!journal) {
      return undefined;
    }

    const compacted: TradeJournalContext = {};

    if (journal.plan && Object.keys(journal.plan).length > 0) {
      compacted.plan = journal.plan;
    }
    if (journal.management && Object.keys(journal.management).length > 0) {
      compacted.management = journal.management;
    }
    if (journal.review && Object.keys(journal.review).length > 0) {
      compacted.review = journal.review;
    }

    return Object.keys(compacted).length > 0 ? compacted : undefined;
  }

  private normalizeTradeJournal(journal: unknown): TradeJournalContext | undefined {
    if (!journal || typeof journal !== 'object' || Array.isArray(journal)) {
      return undefined;
    }

    return this.compactTradeJournal(journal as TradeJournalContext);
  }

  private detectSessionFromOccurredAt(occurredAt: Date): string {
    if (this.isWithinSessionHours(occurredAt, 'America/New_York', 8, 17)) {
      return 'New York';
    }
    if (this.isWithinSessionHours(occurredAt, 'Europe/London', 8, 17)) {
      return 'London';
    }
    if (this.isWithinSessionHours(occurredAt, 'Asia/Seoul', 9, 15)) {
      return 'Asia';
    }
    return 'Off session';
  }

  private isWithinSessionHours(occurredAt: Date, timeZone: string, startHour: number, endHourExclusive: number): boolean {
    const hour = Number(
      new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        hour12: false,
        timeZone,
      }).format(occurredAt),
    );

    return hour >= startHour && hour < endHourExclusive;
  }

  private toPrismaJson(journal: TradeJournalContext | undefined): Prisma.InputJsonValue | undefined {
    if (!journal) {
      return undefined;
    }

    return journal as Prisma.InputJsonValue;
  }

  private toTradeRecord(trade: TradeWithEvents): TradeRecord {
    const inferredSession = trade.entry ? this.detectSessionFromOccurredAt(trade.entry.occurredAt) : undefined;

    return {
      id: trade.id,
      symbol: trade.symbol,
      side: trade.side as TradeRecord['side'],
      status: trade.status as TradeRecord['status'],
      timeframe: trade.timeframe ?? undefined,
      session: trade.session ?? inferredSession,
      strategy: trade.strategy ?? undefined,
      thesis: trade.thesis ?? undefined,
      note: trade.note ?? undefined,
      journal: this.normalizeTradeJournal(trade.journal),
      entry: trade.entry
        ? {
            price: trade.entry.price.toNumber(),
            quantity: trade.entry.quantity?.toNumber(),
            occurredAt: trade.entry.occurredAt.toISOString(),
            note: trade.entry.note ?? undefined,
          }
        : undefined,
      exit: trade.exit
        ? {
            price: trade.exit.price.toNumber(),
            quantity: trade.exit.quantity?.toNumber(),
            occurredAt: trade.exit.occurredAt.toISOString(),
            reason: trade.exit.reason as TradeRecord['exit'] extends infer Exit
              ? Exit extends { reason?: infer Reason }
                ? Reason
                : never
              : never,
            note: trade.exit.note ?? undefined,
          }
        : undefined,
      createdAt: trade.createdAt.toISOString(),
      updatedAt: trade.updatedAt.toISOString(),
    };
  }
}
