import { BadRequestException } from '@nestjs/common';
import type { PatchTradeAnalysisRequest, TradeAnalysisEconomicIndicatorInput } from '@trading-journal/shared';
const enumValues = {
  primaryTrend: ['up', 'sideways', 'down'],
  bollingerBandCount: ['one_band', 'two_band'],
  bollingerDirection: ['normal', 'reverse', 'chase'],
  maArrangement: ['bullish', 'bearish', 'congested'],
  cross: ['none', 'golden_20_60', 'golden_20_120', 'dead_20_60', 'dead_20_120'],
  chartPatternType: ['double_top', 'double_bottom', 'head_shoulders', 'inverse_head_shoulders'],
  impact: ['positive', 'negative'],
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


const analysisPatchFields = new Set<keyof PatchTradeAnalysisRequest>([
  'expectedUpdatedAt', 'note', 'baseTimeframe', 'primaryTrend', 'bollingerBandCount',
  'bollingerDirection', 'maArrangement', 'cross', 'stopLossLine', 'plannedTakeProfitPrice', 'plannedStopLossPrice',
  'marketZoneEnabled', 'marketZoneHigh', 'marketZoneLow',
  'chartPatternObserved', 'chartPatternTimeframe', 'chartPatternType',
  'retailPositionEnabled', 'retailBuyAveragePrice', 'retailSellAveragePrice',
  'retailBuyRatio', 'fibonacciEnabled', 'fibonacciStartPrice',
  'fibonacciEndPrice', 'regret', 'economicIndicators',
]);

export function validateTradeAnalysisPatchRequest(request: PatchTradeAnalysisRequest): void {
  object(request, 'Invalid analysis patch');
  for (const key of Object.keys(request)) {
    if (!analysisPatchFields.has(key as keyof PatchTradeAnalysisRequest)) fail(`${key} is server managed`);
  }
  date(request.expectedUpdatedAt, 'expectedUpdatedAt must be a valid ISO date');
  const fields: Array<[keyof PatchTradeAnalysisRequest, readonly string[]]> = [['primaryTrend', enumValues.primaryTrend], ['bollingerBandCount', enumValues.bollingerBandCount], ['bollingerDirection', enumValues.bollingerDirection], ['maArrangement', enumValues.maArrangement], ['cross', enumValues.cross], ['chartPatternType', enumValues.chartPatternType]];
  for (const [field, values] of fields) enumValue(request[field], values, `${field} is invalid`);
  for (const field of ['note', 'baseTimeframe', 'chartPatternTimeframe', 'regret'] as const) string(request[field], `${field} must be a string or null`, true);
  for (const field of ['marketZoneEnabled', 'chartPatternObserved', 'retailPositionEnabled', 'fibonacciEnabled'] as const) if (request[field] !== undefined && typeof request[field] !== 'boolean') fail(`${field} must be boolean`);
  for (const field of ['stopLossLine', 'plannedTakeProfitPrice', 'plannedStopLossPrice', 'marketZoneHigh', 'marketZoneLow', 'retailBuyAveragePrice', 'retailSellAveragePrice', 'fibonacciStartPrice', 'fibonacciEndPrice'] as const) positive(request[field], `${field} must be positive`, true);
  if ((request.plannedTakeProfitPrice !== undefined || request.plannedStopLossPrice !== undefined)
    && (request.plannedTakeProfitPrice === undefined || request.plannedStopLossPrice === undefined
      || (request.plannedTakeProfitPrice === null) !== (request.plannedStopLossPrice === null))) fail('TP and SL must be entered or cleared together');
  if (request.retailBuyRatio !== undefined && request.retailBuyRatio !== null && (typeof request.retailBuyRatio !== 'number' || !Number.isFinite(request.retailBuyRatio) || request.retailBuyRatio < 0 || request.retailBuyRatio > 100)) fail('retailBuyRatio must be 0 through 100');
  if (request.economicIndicators !== undefined) {
    if (!Array.isArray(request.economicIndicators)) fail('economicIndicators must be an array');
    const indicatorIds = request.economicIndicators.flatMap((indicator) => indicator?.id ? [indicator.id] : []);
    if (new Set(indicatorIds).size !== indicatorIds.length) fail('economic indicator ids must be unique');
    request.economicIndicators.forEach((indicator: TradeAnalysisEconomicIndicatorInput) => {
      object(indicator, 'Invalid economic indicator');
      string(indicator.id, 'economic indicator id must be a string');
      nonblank(indicator.type, 'economic indicator type is required');
      enumValue(indicator.impact, enumValues.impact, 'economic indicator impact is invalid', false);
    });
  }
}
