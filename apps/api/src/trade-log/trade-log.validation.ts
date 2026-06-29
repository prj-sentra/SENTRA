import { BadRequestException } from '@nestjs/common';
import type { CreateTradeRequest, TradeEntryRequest, TradeExitRequest } from '@trading-journal/shared';

function assertPositive(value: number | undefined, message: string, required: boolean): void {
  if (value === undefined) {
    if (required) {
      throw new BadRequestException(message);
    }
    return;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new BadRequestException(message);
  }
}

function assertValidOccurredAt(value: string, message: string): void {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new BadRequestException(message);
  }
}

export function validateCreateTradeRequest(request: CreateTradeRequest): void {
  if (!request.symbol || request.symbol.trim().length === 0) {
    throw new BadRequestException('symbol is required');
  }
  if (request.side !== 'long' && request.side !== 'short') {
    throw new BadRequestException('side must be long or short');
  }
}

export function validateTradeEntryRequest(request: TradeEntryRequest): void {
  assertPositive(request.price, 'entry price must be positive', true);
  assertPositive(request.quantity, 'entry quantity must be positive', false);
  assertValidOccurredAt(request.occurredAt, 'entry occurredAt must be a valid date');
}

export function validateTradeExitRequest(request: TradeExitRequest): void {
  assertPositive(request.price, 'exit price must be positive', true);
  assertPositive(request.quantity, 'exit quantity must be positive', false);
  assertValidOccurredAt(request.occurredAt, 'exit occurredAt must be a valid date');
}
