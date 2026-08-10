import { validateTradeAnalysisPatchRequest } from './trade-log.validation';

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
    ['primaryTrend', 'sideways'],
    ['primaryTrend', 'down'],
    ['bollingerBandCount', 'one_band'],
    ['bollingerBandCount', 'two_band'],
    ['bollingerDirection', 'normal'],
    ['bollingerDirection', 'reverse'],
    ['bollingerDirection', 'chase'],
    ['maArrangement', 'bullish'],
    ['maArrangement', 'bearish'],
    ['maArrangement', 'congested'],
    ['cross', 'none'],
    ['cross', 'golden_20_60'],
    ['cross', 'golden_20_120'],
    ['cross', 'dead_20_60'],
    ['cross', 'dead_20_120'],
    ['chartPatternType', 'double_top'],
    ['chartPatternType', 'double_bottom'],
    ['chartPatternType', 'head_shoulders'],
    ['chartPatternType', 'inverse_head_shoulders'],
  ])('accepts the documented %s enum value %s', (field, value) => {
    expect(() => validateTradeAnalysisPatchRequest({ expectedUpdatedAt: version, [field]: value })).not.toThrow();
  });

  it.each([
    ['primaryTrend', 'bullish'],
    ['bollingerBandCount', 'three_band'],
    ['bollingerDirection', 'sideways'],
    ['maArrangement', 'up'],
    ['cross', 'golden_60_120'],
    ['chartPatternType', 'triangle'],
  ])('rejects unsupported %s enum value %s', (field, value) => {
    expect(() => validateTradeAnalysisPatchRequest({ expectedUpdatedAt: version, [field]: value } as never)).toThrow(`${field} is invalid`);
  });

  it('enforces numeric boundaries and indicator impact values', () => {
    expect(() => validateTradeAnalysisPatchRequest({ expectedUpdatedAt: version, retailBuyRatio: 0 })).not.toThrow();
    expect(() => validateTradeAnalysisPatchRequest({ expectedUpdatedAt: version, retailBuyRatio: 100 })).not.toThrow();
    expect(() => validateTradeAnalysisPatchRequest({ expectedUpdatedAt: version, stopLossLine: 0 })).toThrow('stopLossLine must be positive');
    expect(() => validateTradeAnalysisPatchRequest({ expectedUpdatedAt: version, marketZoneLow: Number.POSITIVE_INFINITY })).toThrow('marketZoneLow must be positive');
    expect(() => validateTradeAnalysisPatchRequest({ expectedUpdatedAt: version, economicIndicators: [{ type: 'CPI', impact: 'neutral' }] } as never)).toThrow('economic indicator impact is invalid');
  });
});
