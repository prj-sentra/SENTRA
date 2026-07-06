import { BadRequestException } from '@nestjs/common';
import type {
  CreateTradeRequest,
  CreateTradeTagRequest,
  TradeJournalContext,
  TradeProcessVerdict,
  TradeTagField,
  UpdateTradeEntryRequest,
  UpdateTradeExitRequest,
  UpdateTradeJournalRequest,
  UpdateTradeRequest,
} from '@trading-journal/shared';

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

function assertOptionalString(value: unknown, message: string): void {
  if (value !== undefined && typeof value !== 'string') {
    throw new BadRequestException(message);
  }
}

function assertOptionalBoolean(value: unknown, message: string): void {
  if (value !== undefined && typeof value !== 'boolean') {
    throw new BadRequestException(message);
  }
}

function assertTrimmedString(value: unknown, message: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestException(message);
  }
}

function assertOptionalStringArray(value: unknown, message: string): void {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim().length === 0)) {
    throw new BadRequestException(message);
  }
}

function assertOptionalProcessVerdict(value: unknown, message: string): void {
  if (value === undefined) {
    return;
  }
  const allowed: TradeProcessVerdict[] = ['good', 'bad', 'repeat-ban', 'observe'];
  if (typeof value !== 'string' || !allowed.includes(value as TradeProcessVerdict)) {
    throw new BadRequestException(message);
  }
}

function assertValidOccurredAt(value: string, message: string): void {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new BadRequestException(message);
  }
}

function assertTradeTagField(value: unknown, message: string): void {
  const allowed: TradeTagField[] = ['setup', 'rule-violation', 'lesson', 'result-label'];
  if (typeof value !== 'string' || !allowed.includes(value as TradeTagField)) {
    throw new BadRequestException(message);
  }
}

function validateTradeJournalContext(journal: TradeJournalContext | undefined, messagePrefix: string): void {
  if (journal === undefined) {
    return;
  }

  const { plan, management, review } = journal;

  if (plan) {
    assertOptionalString(plan.setupType, `${messagePrefix} journal.plan.setupType must be a string`);
    assertOptionalString(plan.setupTag, `${messagePrefix} journal.plan.setupTag must be a string`);
    assertOptionalStringArray(plan.setupTags, `${messagePrefix} journal.plan.setupTags must be a non-empty string array`);
    assertOptionalString(plan.entryModel, `${messagePrefix} journal.plan.entryModel must be a string`);
    assertOptionalStringArray(plan.confirmations, `${messagePrefix} journal.plan.confirmations must be a string array`);
    assertOptionalString(plan.invalidation, `${messagePrefix} journal.plan.invalidation must be a string`);
    assertPositive(plan.stopLossPrice, `${messagePrefix} journal.plan.stopLossPrice must be positive`, false);
    assertPositive(plan.takeProfitPrice, `${messagePrefix} journal.plan.takeProfitPrice must be positive`, false);
    assertPositive(plan.plannedLossAmount, `${messagePrefix} journal.plan.plannedLossAmount must be positive`, false);
    assertPositive(plan.dailyLossLimit, `${messagePrefix} journal.plan.dailyLossLimit must be positive`, false);
    assertOptionalBoolean(plan.calmState, `${messagePrefix} journal.plan.calmState must be boolean`);
    assertOptionalString(plan.checklistNotes, `${messagePrefix} journal.plan.checklistNotes must be a string`);
  }

  if (management) {
    assertOptionalString(management.breakevenRule, `${messagePrefix} journal.management.breakevenRule must be a string`);
    assertOptionalString(management.additionRule, `${messagePrefix} journal.management.additionRule must be a string`);
    assertOptionalStringArray(management.exitTriggers, `${messagePrefix} journal.management.exitTriggers must be a string array`);
    assertOptionalString(management.managementNotes, `${messagePrefix} journal.management.managementNotes must be a string`);
  }

  if (review) {
    assertOptionalString(review.resultLabel, `${messagePrefix} journal.review.resultLabel must be a string`);
    assertOptionalProcessVerdict(
      review.processVerdict,
      `${messagePrefix} journal.review.processVerdict must be one of good, bad, repeat-ban, observe`,
    );
    assertOptionalStringArray(review.ruleViolations, `${messagePrefix} journal.review.ruleViolations must be a string array`);
    assertOptionalStringArray(review.ruleViolationTags, `${messagePrefix} journal.review.ruleViolationTags must be a string array`);
    assertOptionalStringArray(review.lessons, `${messagePrefix} journal.review.lessons must be a string array`);
    assertOptionalStringArray(review.lessonTags, `${messagePrefix} journal.review.lessonTags must be a string array`);
    assertOptionalString(review.realizedPnlText, `${messagePrefix} journal.review.realizedPnlText must be a string`);
    assertOptionalString(review.reviewNotes, `${messagePrefix} journal.review.reviewNotes must be a string`);
  }
}

export function validateCreateTradeRequest(request: CreateTradeRequest): void {
  assertTrimmedString(request.symbol, 'symbol is required');
  if (request.side !== 'long' && request.side !== 'short') {
    throw new BadRequestException('side must be long or short');
  }
  validateTradeJournalContext(request.journal, 'createTrade');
}

export function validateUpdateTradeRequest(request: UpdateTradeRequest): void {
  if (Object.keys(request).length === 0) {
    throw new BadRequestException('updateTrade requires at least one field');
  }
  if (request.symbol !== undefined) {
    assertTrimmedString(request.symbol, 'symbol must be a non-empty string');
  }
  if (request.side !== undefined && request.side !== 'long' && request.side !== 'short') {
    throw new BadRequestException('side must be long or short');
  }
  assertOptionalString(request.timeframe, 'timeframe must be a string');
  assertOptionalString(request.session, 'session must be a string');
  assertOptionalString(request.strategy, 'strategy must be a string');
  assertOptionalString(request.thesis, 'thesis must be a string');
  assertOptionalString(request.note, 'note must be a string');
  validateTradeJournalContext(request.journal, 'updateTrade');
}

export function validateTradeJournalPatchRequest(request: UpdateTradeJournalRequest): void {
  validateTradeJournalContext(request, 'patchTradeJournal');
}

export function validateTradeEntryRequest(request: { price: number; quantity?: number; occurredAt: string }): void {
  assertPositive(request.price, 'entry price must be positive', true);
  assertPositive(request.quantity, 'entry quantity must be positive', false);
  assertValidOccurredAt(request.occurredAt, 'entry occurredAt must be a valid date');
}

export function validateTradeExitRequest(request: { price: number; quantity?: number; occurredAt: string; reason?: string }): void {
  assertPositive(request.price, 'exit price must be positive', true);
  assertPositive(request.quantity, 'exit quantity must be positive', false);
  assertValidOccurredAt(request.occurredAt, 'exit occurredAt must be a valid date');
  assertOptionalString(request.reason, 'exit reason must be a string');
}

export function validateUpdateTradeEntryRequest(request: UpdateTradeEntryRequest): void {
  if (Object.keys(request).length === 0) {
    throw new BadRequestException('updateTradeEntry requires at least one field');
  }
  assertPositive(request.price, 'entry price must be positive', false);
  assertPositive(request.quantity, 'entry quantity must be positive', false);
  if (request.occurredAt !== undefined) {
    assertValidOccurredAt(request.occurredAt, 'entry occurredAt must be a valid date');
  }
  assertOptionalString(request.note, 'entry note must be a string');
}

export function validateUpdateTradeExitRequest(request: UpdateTradeExitRequest): void {
  if (Object.keys(request).length === 0) {
    throw new BadRequestException('updateTradeExit requires at least one field');
  }
  assertPositive(request.price, 'exit price must be positive', false);
  assertPositive(request.quantity, 'exit quantity must be positive', false);
  if (request.occurredAt !== undefined) {
    assertValidOccurredAt(request.occurredAt, 'exit occurredAt must be a valid date');
  }
  assertOptionalString(request.reason, 'exit reason must be a string');
  assertOptionalString(request.note, 'exit note must be a string');
}

export function validateCreateTradeTagRequest(request: CreateTradeTagRequest): void {
  if (request.field === undefined) {
    throw new BadRequestException('field is required');
  }
  assertTradeTagField(request.field, 'field must be one of setup, rule-violation, lesson, result-label');
  assertTrimmedString(request.label, 'label must be a non-empty string');
}
