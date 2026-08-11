import { BadRequestException } from '@nestjs/common';
import type { PatchTradeAnalysisRequest, PatchTradeCampaignAnalysisRequest, TradeAnalysisEconomicIndicatorInput } from '@trading-journal/shared';
const enumValues = {
  primaryTrend: ['up', 'sideways', 'down'],
  bollingerBandCount: ['one_band', 'two_band'],
  bollingerDirection: ['normal', 'reverse', 'chase'],
  maArrangement: ['bullish', 'bearish', 'congested'],
  crossDirection: ['none', 'golden', 'dead'],
  chartPatternType: ['double_top', 'double_bottom', 'head_shoulders', 'inverse_head_shoulders'],
  impact: ['positive', 'negative'],
  executionEvaluation: ['as_planned', 'plan_violated'],
} as const;

function fail(message: string): never { throw new BadRequestException(message); }
function object(value: unknown, message: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(message);
}
function string(value: unknown, message: string, nullable = false): void {
  if (value === undefined || (nullable && value === null)) return;
  if (typeof value !== 'string') fail(message);
}
function nonblank(value: unknown, message: string): void {
  if (typeof value !== 'string' || !value.trim()) fail(message);
}
function positive(value: unknown, message: string, nullable = false): void {
  if (value === undefined || (nullable && value === null)) return;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) fail(message);
}
function date(value: unknown, message: string): void {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) fail(message);
}
function enumValue(value: unknown, values: readonly string[], message: string, nullable = true): void {
  if (value === undefined || (nullable && value === null)) return;
  if (typeof value !== 'string' || !values.includes(value)) fail(message);
}


const executionFields = new Set<keyof PatchTradeAnalysisRequest>([
  'expectedUpdatedAt', 'baseTimeframe', 'bollingerBandCount', 'bollingerDirection',
  'executionEvaluation', 'unplannedAdditionalEntry', 'excessiveSize', 'stopLossViolation', 'earlyExit', 'lateExit', 'otherViolation',
  'plannedTakeProfitPrice', 'plannedStopLossPrice',
]);
const campaignFields = new Set<keyof PatchTradeCampaignAnalysisRequest>([
  'expectedUpdatedAt', 'primaryTrend', 'maTimeframes',
  'marketZoneEnabled', 'marketZoneHigh', 'marketZoneLow',
  'retailPositionEnabled', 'retailBuyAveragePrice', 'retailSellAveragePrice',
  'retailBuyRatio', 'fibonacciEnabled', 'fibonacciStartPrice',
  'fibonacciEndPrice', 'economicIndicators',
  'entryReason', 'invalidationCondition', 'takeProfitCondition', 'additionalEntryPlan',
  'tradeScore', 'strengths', 'weaknesses',
]);

export function validateTradeAnalysisPatchRequest(request: PatchTradeAnalysisRequest): void {
  object(request, 'Invalid analysis patch');
  for (const key of Object.keys(request)) if (!executionFields.has(key as keyof PatchTradeAnalysisRequest)) fail(`${key} is server managed`);
  date(request.expectedUpdatedAt, 'expectedUpdatedAt must be a valid ISO date');
  enumValue(request.bollingerBandCount, enumValues.bollingerBandCount, 'bollingerBandCount is invalid');
  enumValue(request.bollingerDirection, enumValues.bollingerDirection, 'bollingerDirection is invalid');
  string(request.baseTimeframe, 'baseTimeframe must be a string or null', true);
  enumValue(request.executionEvaluation, enumValues.executionEvaluation, 'executionEvaluation is invalid');
  for (const field of ['unplannedAdditionalEntry', 'excessiveSize', 'stopLossViolation', 'earlyExit', 'lateExit'] as const) if (request[field] !== undefined && typeof request[field] !== 'boolean') fail(`${field} must be boolean`);
  string(request.otherViolation, 'otherViolation must be a string or null', true);
  if (request.executionEvaluation !== 'plan_violated' && (
    request.unplannedAdditionalEntry || request.excessiveSize || request.stopLossViolation || request.earlyExit || request.lateExit || request.otherViolation
  )) fail('violation details require plan_violated executionEvaluation');
  for (const field of ['plannedTakeProfitPrice', 'plannedStopLossPrice'] as const) positive(request[field], `${field} must be positive`, true);
  if ((request.plannedTakeProfitPrice !== undefined || request.plannedStopLossPrice !== undefined)
    && (request.plannedTakeProfitPrice === undefined || request.plannedStopLossPrice === undefined
      || (request.plannedTakeProfitPrice === null) !== (request.plannedStopLossPrice === null))) fail('TP and SL must be entered or cleared together');
}

export function validateTradeCampaignAnalysisPatchRequest(request: PatchTradeCampaignAnalysisRequest): void {
  object(request, 'Invalid campaign analysis patch');
  for (const key of Object.keys(request)) if (!campaignFields.has(key as keyof PatchTradeCampaignAnalysisRequest)) fail(`${key} is server managed`);
  date(request.expectedUpdatedAt, 'expectedUpdatedAt must be a valid ISO date');
  enumValue(request.primaryTrend, enumValues.primaryTrend, 'primaryTrend is invalid');
  if (request.maTimeframes !== undefined) {
    object(request.maTimeframes, 'maTimeframes must be an object');
    const allowedTimeframes = new Set(['15m', '30m', '1h', '4h', '1D', '1W', '1MN']);
    for (const [timeframe, reading] of Object.entries(request.maTimeframes)) {
      if (!allowedTimeframes.has(timeframe)) fail(`${timeframe} is not a supported moving-average timeframe`);
      object(reading, `${timeframe} moving-average reading must be an object`);
      if (Object.keys(reading).some((key) => key !== 'arrangement' && key !== 'cross20_60' && key !== 'cross20_120' && key !== 'chartPattern')) fail(`${timeframe} moving-average reading has an unknown field`);
      enumValue(reading.arrangement, enumValues.maArrangement, `${timeframe} arrangement is invalid`);
      enumValue(reading.cross20_60, enumValues.crossDirection, `${timeframe} 20-60 cross is invalid`);
      enumValue(reading.cross20_120, enumValues.crossDirection, `${timeframe} 20-120 cross is invalid`);
      enumValue(reading.chartPattern, enumValues.chartPatternType, `${timeframe} chart pattern is invalid`);
    }
  }
  for (const field of ['marketZoneEnabled', 'retailPositionEnabled', 'fibonacciEnabled'] as const) if (request[field] !== undefined && typeof request[field] !== 'boolean') fail(`${field} must be boolean`);
  for (const field of ['marketZoneHigh', 'marketZoneLow', 'retailBuyAveragePrice', 'retailSellAveragePrice', 'fibonacciStartPrice', 'fibonacciEndPrice'] as const) positive(request[field], `${field} must be positive`, true);
  if (request.retailBuyRatio !== undefined && request.retailBuyRatio !== null && (typeof request.retailBuyRatio !== 'number' || !Number.isFinite(request.retailBuyRatio) || request.retailBuyRatio < 0 || request.retailBuyRatio > 100)) fail('retailBuyRatio must be 0 through 100');
  for (const field of ['entryReason', 'invalidationCondition', 'takeProfitCondition', 'additionalEntryPlan', 'strengths', 'weaknesses'] as const) string(request[field], `${field} must be a string or null`, true);
  if (request.tradeScore !== undefined && request.tradeScore !== null && (!Number.isInteger(request.tradeScore) || request.tradeScore < 1 || request.tradeScore > 10)) fail('tradeScore must be an integer from 1 through 10');
  if (request.economicIndicators !== undefined) {
    if (!Array.isArray(request.economicIndicators)) fail('economicIndicators must be an array');
    const indicatorIds = request.economicIndicators.flatMap((indicator) => indicator?.id ? [indicator.id] : []);
    if (new Set(indicatorIds).size !== indicatorIds.length) fail('economic indicator ids must be unique');
    request.economicIndicators.forEach((indicator: TradeAnalysisEconomicIndicatorInput) => {
      object(indicator, 'Invalid economic indicator');
      string(indicator.id, 'economic indicator id must be a string');
      nonblank(indicator.type, 'economic indicator type is required');
      enumValue(indicator.impact, enumValues.impact, 'economic indicator impact is invalid', false);
      if (indicator.announcedAt !== undefined && indicator.announcedAt !== null) date(indicator.announcedAt, 'economic indicator announcedAt must be a valid ISO date');
    });
  }
}
