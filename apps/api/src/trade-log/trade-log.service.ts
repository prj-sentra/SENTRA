import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateTradeRequest,
  HealthResponse,
  TradeEntryRequest,
  TradeExitRequest,
  TradeLogAssistantActionsRequest,
  TradeLogAssistantActionsResponse,
  TradeRecord,
} from '@trading-journal/shared';
import { PrismaService } from '../prisma/prisma.service';
import {
  validateCreateTradeRequest,
  validateTradeEntryRequest,
  validateTradeExitRequest,
} from './trade-log.validation';

type TradeWithEvents = Awaited<ReturnType<PrismaService['trade']['findFirstOrThrow']>> & {
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

  async recordEntry(id: string, request: TradeEntryRequest): Promise<TradeRecord> {
    validateTradeEntryRequest(request);

    const trade = await this.getTrade(id);
    if (trade.entry) {
      throw new BadRequestException('Trade already has an entry');
    }
    if (trade.status === 'closed') {
      throw new BadRequestException('Cannot enter a closed trade');
    }

    const updated = await this.prisma.trade.update({
      where: { id },
      data: {
        status: 'open',
        entry: {
          create: {
            price: request.price,
            quantity: request.quantity,
            occurredAt: new Date(request.occurredAt),
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

  private toTradeRecord(trade: TradeWithEvents): TradeRecord {
    return {
      id: trade.id,
      symbol: trade.symbol,
      side: trade.side as TradeRecord['side'],
      status: trade.status as TradeRecord['status'],
      timeframe: trade.timeframe ?? undefined,
      session: trade.session ?? undefined,
      strategy: trade.strategy ?? undefined,
      thesis: trade.thesis ?? undefined,
      note: trade.note ?? undefined,
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
