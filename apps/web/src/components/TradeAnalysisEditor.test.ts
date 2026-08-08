import { describe, expect, it } from 'vitest';
import { canonicalAnalysisPatch } from './TradeAnalysisEditor';

describe('analysis request canonicalization', () => {
  it('clears every dependent value when a populated group is disabled', () => {
    const patch = canonicalAnalysisPatch({
      marketZoneEnabled: false,
      marketZoneHigh: 120,
      marketZoneLow: 100,
      chartPatternObserved: false,
      chartPatternTimeframe: 'M15',
      chartPatternType: 'double_top',
      retailPositionEnabled: false,
      retailBuyAveragePrice: 101,
      retailSellAveragePrice: 102,
      retailBuyRatio: 55,
      fibonacciEnabled: false,
      fibonacciStartPrice: 90,
      fibonacciEndPrice: 110,
      economicIndicators: [],
    }, 'version-1');

    expect(patch).toMatchObject({
      marketZoneHigh: null,
      marketZoneLow: null,
      chartPatternTimeframe: null,
      chartPatternType: null,
      retailBuyAveragePrice: null,
      retailSellAveragePrice: null,
      retailBuyRatio: null,
      fibonacciStartPrice: null,
      fibonacciEndPrice: null,
      expectedUpdatedAt: 'version-1',
    });
  });
});
