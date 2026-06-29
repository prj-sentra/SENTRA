import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  CreateTradeRequest,
  HealthResponse,
  TradeEntryRequest,
  TradeExitRequest,
  TradeLogAssistantActionsRequest,
  TradeLogAssistantActionsResponse,
  TradeRecord,
} from '@trading-journal/shared';
import {
  validateCreateTradeRequest,
  validateTradeEntryRequest,
  validateTradeExitRequest,
} from './trade-log.validation';

@Injectable()
export class TradeLogService {
  private readonly trades = new Map<string, TradeRecord>();

  health(): HealthResponse {
    return {
      status: 'ok',
      service: 'sentra-trade-log',
      timestamp: new Date().toISOString(),
    };
  }

  createTrade(request: CreateTradeRequest): TradeRecord {
    validateCreateTradeRequest(request);

    const now = new Date().toISOString();
    const trade: TradeRecord = {
      id: randomUUID(),
      symbol: request.symbol,
      side: request.side,
      status: 'planned',
      timeframe: request.timeframe,
      session: request.session,
      strategy: request.strategy,
      thesis: request.thesis,
      note: request.note,
      createdAt: now,
      updatedAt: now,
    };

    this.trades.set(trade.id, trade);
    return trade;
  }

  listTrades(): TradeRecord[] {
    return Array.from(this.trades.values());
  }

  getTrade(id: string): TradeRecord {
    const trade = this.trades.get(id);
    if (!trade) {
      throw new NotFoundException(`Trade not found: ${id}`);
    }
    return trade;
  }

  recordEntry(id: string, request: TradeEntryRequest): TradeRecord {
    validateTradeEntryRequest(request);

    const trade = this.getTrade(id);
    if (trade.entry) {
      throw new BadRequestException('Trade already has an entry');
    }
    if (trade.status === 'closed') {
      throw new BadRequestException('Cannot enter a closed trade');
    }

    const updated: TradeRecord = {
      ...trade,
      status: 'open',
      entry: { ...request },
      updatedAt: new Date().toISOString(),
    };

    this.trades.set(id, updated);
    return updated;
  }

  recordExit(id: string, request: TradeExitRequest): TradeRecord {
    validateTradeExitRequest(request);

    const trade = this.getTrade(id);
    if (!trade.entry) {
      throw new BadRequestException('Cannot exit before entry');
    }
    if (trade.exit) {
      throw new BadRequestException('Trade already has an exit');
    }

    const updated: TradeRecord = {
      ...trade,
      status: 'closed',
      exit: { ...request },
      updatedAt: new Date().toISOString(),
    };

    this.trades.set(id, updated);
    return updated;
  }

  applyAssistantActions(request: TradeLogAssistantActionsRequest): TradeLogAssistantActionsResponse {
    const touchedTrades: TradeRecord[] = [];
    let lastCreatedTradeId: string | undefined;

    for (const action of request.actions) {
      if (action.type === 'create_trade') {
        const trade = this.createTrade({
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
        const updated = this.recordEntry(tradeId, action.payload);
        const index = touchedTrades.findIndex((trade) => trade.id === updated.id);
        if (index >= 0) {
          touchedTrades[index] = updated;
        } else {
          touchedTrades.push(updated);
        }
        continue;
      }

      const updated = this.recordExit(action.tradeId, action.payload);
      const index = touchedTrades.findIndex((trade) => trade.id === updated.id);
      if (index >= 0) {
        touchedTrades[index] = updated;
      } else {
        touchedTrades.push(updated);
      }
    }

    return {
      rawText: request.rawText,
      source: request.source,
      trades: touchedTrades,
    };
  }
}
