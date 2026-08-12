import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PatchTradeCampaignAnalysisRequest, TradeCampaign, TradeCampaignImage } from '@trading-journal/shared';
import { canonicalCampaignAnalysisPatch } from './components/TradeAnalysisEditor';
import { moveGalleryImage } from './components/gallery-order';
import App, { appViewFromPath, appViewPaths, campaignHeadMutationRequest } from './App';

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock('./api/client', () => ({
  apiBaseUrl: '',
  apiRequest,
  setUnauthorizedHandler: vi.fn(() => vi.fn()),
}));
vi.mock('./components/TradeJournalPage', () => ({
  TradeJournalPage: ({ campaigns, targetId, onTargetFocused, onChangeCampaignHead }: any) => createElement('div', undefined,
    createElement('output', { 'data-testid': 'campaign-count' }, campaigns.length),
    createElement('output', { 'data-testid': 'campaign-id' }, campaigns[0]?.id ?? ''),
    createElement('output', { 'data-testid': 'target' }, targetId ?? ''),
    createElement('button', { type: 'button', onClick: () => void onChangeCampaignHead(campaigns[0], 'affected-trade') }, 'change head'),
    targetId ? createElement('button', { type: 'button', onClick: onTargetFocused }, 'consume target') : null,
  ),
}));

afterEach(() => {
  cleanup();
  apiRequest.mockReset();
});

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

  it('maps stable page endpoints and falls back to the journal', () => {
    expect(appViewPaths).toEqual({
      stats: '/dashboard',
      'trade-log': '/journal',
      credentials: '/settings',
      admin: '/admin',
    });
    expect(appViewFromPath('/dashboard')).toBe('stats');
    expect(appViewFromPath('/journal/')).toBe('trade-log');
    expect(appViewFromPath('/settings')).toBe('credentials');
    expect(appViewFromPath('/admin')).toBe('admin');
    expect(appViewFromPath('/unknown')).toBe('trade-log');
  });

  it('sends versioned campaign-head set and unset mutations to the shared API route', () => {
    const campaign = { id: 'campaign/a', rootTradeId: 'trade-1', campaignVersion: 7 } as TradeCampaign;
    expect(campaignHeadMutationRequest(campaign, 'trade-2')).toEqual({
      path: '/trade-log/campaigns/campaign%2Fa/head',
      init: { method: 'POST', body: JSON.stringify({ tradeId: 'trade-2', campaignVersion: 7 }) },
    });
    expect(campaignHeadMutationRequest(campaign, 'trade-1')).toEqual({
      path: '/trade-log/campaigns/campaign%2Fa/head',
      init: { method: 'DELETE', body: JSON.stringify({ campaignVersion: 7 }) },
    });
  });

  it.each([
    { name: 'split to the later Seoul date', initialRootTradeId: 'old-head', responseDate: '2026-08-13', refreshedId: 'split-campaign' },
    { name: 'unset back to the earlier Seoul date', initialRootTradeId: 'affected-trade', responseDate: '2026-08-11', refreshedId: 'reclassified-campaign' },
  ])('publishes the affected target only after $name reloads', async ({ initialRootTradeId, responseDate, refreshedId }) => {
    let resolveMutation!: () => void;
    const mutation = new Promise<any>((resolve) => { resolveMutation = () => resolve({ campaign: { tradingDate: responseDate } }); });
    const datedRefreshes: Array<(response: any) => void> = [];
    const initialCampaign = { id: 'old-campaign', rootTradeId: initialRootTradeId, campaignVersion: 1, members: [{ id: 'affected-trade' }] };
    const refreshedCampaign = { id: refreshedId, rootTradeId: 'affected-trade', campaignVersion: 2, members: [{ id: 'affected-trade' }] };
    apiRequest.mockImplementation((path: string) => {
      if (path === '/auth/me') return Promise.resolve({ username: 'tester', isAdmin: false });
      if (path === '/mt5-accounts') return Promise.resolve([{ id: 'account-1', active: true }]);
      if (path.startsWith('/trade-log/campaigns?')) {
        if (!path.includes(`date=${responseDate}`)) return Promise.resolve({ campaigns: [initialCampaign], calendarDays: [] });
        return new Promise((resolve) => datedRefreshes.push(resolve));
      }
      if (path.endsWith('/head')) return mutation;
      throw new Error(`Unexpected request ${path}`);
    });

    render(createElement(App));
    await waitFor(() => expect(screen.getByTestId('campaign-count')).toHaveTextContent('1'));
    fireEvent.click(screen.getByRole('button', { name: 'change head' }));
    expect(screen.getByTestId('target')).toHaveTextContent('');
    resolveMutation();
    await waitFor(() => expect(datedRefreshes).toHaveLength(2));
    datedRefreshes[0]({ campaigns: [initialCampaign], calendarDays: [] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByTestId('target')).toHaveTextContent('');
    expect(screen.getByTestId('campaign-id')).toHaveTextContent('old-campaign');
    datedRefreshes[1]({ campaigns: [refreshedCampaign], calendarDays: [] });
    await waitFor(() => expect(screen.getByTestId('target')).toHaveTextContent('affected-trade'));
    expect(screen.getByTestId('campaign-id')).toHaveTextContent(refreshedId);
    expect(apiRequest).toHaveBeenCalledWith(expect.stringContaining(`date=${responseDate}`));
    fireEvent.click(screen.getByRole('button', { name: 'consume target' }));
    await waitFor(() => expect(screen.getByTestId('target')).toHaveTextContent(''));
  });
});
