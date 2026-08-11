import { describe, expect, it } from 'vitest';
import type { PatchTradeCampaignAnalysisRequest, TradeCampaignImage } from '@trading-journal/shared';
import { canonicalCampaignAnalysisPatch } from './components/TradeAnalysisEditor';
import { moveGalleryImage } from './components/gallery-order';

describe('redesigned journal web contracts', () => {
  it('canonicalizes disabled analysis conditionals and keeps the optimistic token', () => {
    const patch = canonicalCampaignAnalysisPatch({
      baseTimeframe: '1h',
      marketZoneEnabled: false,
      retailPositionEnabled: false,
      fibonacciEnabled: false,
      economicIndicators: [{ type: 'CPI', impact: 'positive' }],
    }, '2026-08-07T00:00:00.000Z');
    expect(patch).toMatchObject({
      expectedUpdatedAt: '2026-08-07T00:00:00.000Z',
      marketZoneHigh: null, marketZoneLow: null,
      retailBuyAveragePrice: null, retailSellAveragePrice: null, retailBuyRatio: null,
      fibonacciStartPrice: null, fibonacciEndPrice: null,
      economicIndicators: [{ type: 'CPI', impact: 'positive' }],
    } satisfies Partial<PatchTradeCampaignAnalysisRequest>);
  });

  it('reorders only a valid gallery neighbor and preserves image order otherwise', () => {
    const images: TradeCampaignImage[] = [
      { id: 'a', campaignId: 'campaign', position: 0, mimeType: 'image/webp', byteSize: 1, width: 1, height: 1, createdAt: '', updatedAt: '' },
      { id: 'b', campaignId: 'campaign', position: 1, mimeType: 'image/webp', byteSize: 1, width: 1, height: 1, createdAt: '', updatedAt: '' },
    ];
    expect(moveGalleryImage(images, 'a', 1).map((image) => image.id)).toEqual(['b', 'a']);
    expect(moveGalleryImage(images, 'a', -1)).toBe(images);
  });
});
