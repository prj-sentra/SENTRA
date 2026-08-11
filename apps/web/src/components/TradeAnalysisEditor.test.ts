import { describe, expect, it } from 'vitest';
import { canonicalCampaignAnalysisPatch } from './TradeAnalysisEditor';

describe('analysis request canonicalization', () => {
  it('clears every dependent value when a populated group is disabled', () => {
    const patch = canonicalCampaignAnalysisPatch({
      marketZoneEnabled: false,
      marketZoneHigh: 120,
      marketZoneLow: 100,
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
      retailBuyAveragePrice: null,
      retailSellAveragePrice: null,
      retailBuyRatio: null,
      fibonacciStartPrice: null,
      fibonacciEndPrice: null,
      expectedUpdatedAt: 'version-1',
    });
  });
});
