import { validateTradeAnalysisPatchRequest as validateExecution, validateTradeCampaignAnalysisPatchRequest as validateCampaign, validateTradeCampaignReviewPatchRequest as validateReview } from './trade-log.validation';

const campaignKeys = new Set(['primaryTrend', 'maTimeframes', 'marketZoneEnabled', 'marketZoneHigh', 'marketZoneLow', 'chartPatternObserved', 'chartPatternTimeframe', 'chartPatternType', 'retailPositionEnabled', 'retailBuyAveragePrice', 'retailSellAveragePrice', 'retailBuyRatio', 'fibonacciEnabled', 'fibonacciStartPrice', 'fibonacciEndPrice', 'economicIndicators']);
const validateTradeAnalysisPatchRequest = (request: any) => Object.keys(request).some((key) => campaignKeys.has(key)) ? validateCampaign(request) : validateExecution(request);
describe('trade analysis validation', () => {
  const version = '2026-08-01T00:00:00.000Z';

  it('allows tri-state optional fields and omitted indicators', () => {
    expect(() => validateTradeAnalysisPatchRequest({ expectedUpdatedAt: version, primaryTrend: null })).not.toThrow();
    expect(() => validateTradeAnalysisPatchRequest({ expectedUpdatedAt: version, marketZoneEnabled: false })).not.toThrow();
  });

  it('validates enabled conditional analysis groups', () => {
    expect(() => validateTradeAnalysisPatchRequest({ expectedUpdatedAt: version, marketZoneEnabled: true })).not.toThrow();
    expect(() => validateTradeAnalysisPatchRequest({ expectedUpdatedAt: version, marketZoneHigh: -1 })).toThrow('marketZoneHigh must be positive');
    expect(() => validateTradeAnalysisPatchRequest({ expectedUpdatedAt: version, retailBuyRatio: 101 })).toThrow('retailBuyRatio must be 0 through 100');
  });

  it('requires an ISO optimistic-lock version and valid indicator replacements', () => {
    expect(() => validateTradeAnalysisPatchRequest({ expectedUpdatedAt: 'not-a-date' } as never)).toThrow('expectedUpdatedAt must be a valid ISO date');
    expect(() => validateTradeAnalysisPatchRequest({ expectedUpdatedAt: version, economicIndicators: [{ type: '', impact: 'positive' }] })).toThrow('economic indicator type is required');
    expect(() => validateTradeAnalysisPatchRequest({ expectedUpdatedAt: version, economicIndicators: [{ type: 'CPI', impact: 'positive' }, { type: 'NFP', impact: 'negative' }] })).not.toThrow();
    expect(() => validateTradeAnalysisPatchRequest({ expectedUpdatedAt: version, economicIndicators: [{ id: 'same', type: 'CPI', impact: 'positive' }, { id: 'same', type: 'NFP', impact: 'negative' }] })).toThrow('economic indicator ids must be unique');
  });

  it('rejects server-managed fields', () => {
    expect(() => validateTradeAnalysisPatchRequest({ expectedUpdatedAt: version, updatedAt: version } as never)).toThrow('updatedAt is server managed');
  });
  it.each([
    'symbol', 'side', 'status', 'entryPrice', 'exitPrice', 'quantityLots', 'realizedPnl',
    'openedAt', 'closedAt', 'takeProfitPrice', 'stopLossPrice', 'mt5Server', 'mt5AccountLogin',
  ])('rejects immutable execution source field %s in a qualitative patch', (field) => {
    expect(() => validateTradeAnalysisPatchRequest({
      expectedUpdatedAt: version,
      [field]: field.includes('At') ? version : 1,
    } as never)).toThrow(`${field} is server managed`);
  });
  it.each([
    ['primaryTrend', 'up'],
    ['primaryTrend', 'up_sideways'],
    ['primaryTrend', 'down'],
    ['primaryTrend', 'down_sideways'],
    ['bollingerBandCount', 'one_band'],
    ['bollingerBandCount', 'two_band'],
    ['bollingerBandCount', 'no_touch'],
    ['bollingerDirection', 'normal'],
    ['bollingerDirection', 'reverse'],
    ['bollingerDirection', 'chase'],
  ])('accepts the documented %s enum value %s', (field, value) => {
    expect(() => validateTradeAnalysisPatchRequest({ expectedUpdatedAt: version, [field]: value })).not.toThrow();
  });

  it.each([
    ['primaryTrend', 'bullish'],
    ['primaryTrend', 'sideways'],
    ['bollingerBandCount', 'three_band'],
    ['bollingerDirection', 'sideways'],
  ])('rejects unsupported %s enum value %s', (field, value) => {
    expect(() => validateTradeAnalysisPatchRequest({ expectedUpdatedAt: version, [field]: value } as never)).toThrow(`${field} is invalid`);
  });

  it('validates moving-average readings by supported timeframe', () => {
    expect(() => validateTradeAnalysisPatchRequest({ expectedUpdatedAt: version, maTimeframes: { '15m': { arrangement: 'bullish', cross20_60: 'golden', cross20_120: 'dead', chartPattern: 'double_top' }, '1MN': { arrangement: 'congested', cross20_60: 'none', cross20_120: 'none' } } })).not.toThrow();
    expect(() => validateTradeAnalysisPatchRequest({ expectedUpdatedAt: version, maTimeframes: { '5m': { arrangement: 'bullish' } } } as never)).toThrow('5m is not a supported');
    expect(() => validateTradeAnalysisPatchRequest({ expectedUpdatedAt: version, maTimeframes: { '1h': { arrangement: 'up' } } } as never)).toThrow('1h arrangement is invalid');
    expect(() => validateTradeAnalysisPatchRequest({ expectedUpdatedAt: version, maTimeframes: { '4h': { cross20_60: 'sideways' } } } as never)).toThrow('4h 20-60 cross is invalid');
    expect(() => validateTradeAnalysisPatchRequest({ expectedUpdatedAt: version, maTimeframes: { '1D': { chartPattern: 'triangle' } } } as never)).toThrow('1D chart pattern is invalid');
  });

  it('enforces numeric boundaries and indicator impact values', () => {
    expect(() => validateTradeAnalysisPatchRequest({ expectedUpdatedAt: version, retailBuyRatio: 0 })).not.toThrow();
    expect(() => validateTradeAnalysisPatchRequest({ expectedUpdatedAt: version, retailBuyRatio: 100 })).not.toThrow();
    expect(() => validateTradeAnalysisPatchRequest({ expectedUpdatedAt: version, legacyStopLossLine: 100 } as never)).toThrow('legacyStopLossLine is server managed');
    expect(() => validateTradeAnalysisPatchRequest({ expectedUpdatedAt: version, marketZoneLow: Number.POSITIVE_INFINITY })).toThrow('marketZoneLow must be positive');
    expect(() => validateTradeAnalysisPatchRequest({ expectedUpdatedAt: version, economicIndicators: [{ type: 'CPI', impact: 'neutral' }] } as never)).toThrow('economic indicator impact is invalid');
  });
});
describe('campaign review validation', () => {
  const version = '2026-08-01T00:00:00.000Z';

  it('accepts review fields with a dedicated optimistic token', () => {
    expect(() => validateReview({ expectedReviewUpdatedAt: version, entryReason: '추세 돌파', tradeScore: 8 })).not.toThrow();
  });

  it('rejects invalid review scores and analysis tokens', () => {
    expect(() => validateReview({ expectedReviewUpdatedAt: version, tradeScore: 11 })).toThrow('tradeScore must be an integer from 1 through 10');
    expect(() => validateReview({ expectedReviewUpdatedAt: version, expectedUpdatedAt: version } as never)).toThrow('expectedUpdatedAt is server managed');
  });
});
