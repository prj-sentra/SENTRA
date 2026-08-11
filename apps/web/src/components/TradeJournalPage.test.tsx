import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TradeCampaign } from '@trading-journal/shared';
import { TradeJournalPage, type TradeJournalPageProps } from './TradeJournalPage';

afterEach(cleanup);
vi.mock('./TradeRecordCard', () => ({ TradeRecordCard: ({ campaign }: { campaign: TradeCampaign }) => <div>{campaign.symbol}</div> }));
vi.mock('./TradeCalendarPicker', () => ({ TradeCalendarPicker: () => <button type="button">달력</button> }));

const campaign = {
  id: 'campaign-1', rootTradeId: 'trade-1', tradingDate: '2026-01-03', accountId: 'account-1', symbol: 'EURUSD', side: 'long', status: 'closed', quantityLots: 1, remainingQuantityLots: 0, realizedPnl: 10, openedAt: '2026-01-03T00:00:00.000Z', images: [], updatedAt: '2026-01-03T01:00:00.000Z', analysisComplete: true, analysis: {} as TradeCampaign['analysis'], conflicts: [], members: [{ id: 'trade-1' } as TradeCampaign['members'][number]],
} satisfies TradeCampaign;

const actions = {
  campaigns: [campaign], calendarDays: [], date: '2026-01-03', onSelectDate: vi.fn(), imageUrl: vi.fn(), onPatchAnalysis: vi.fn(), onPatchCampaignAnalysis: vi.fn(), onPatchCampaignReview: vi.fn(), onPatchMemo: vi.fn(), onUploadImage: vi.fn(), onReorderImages: vi.fn(), onDeleteImage: vi.fn(),
} satisfies TradeJournalPageProps;

describe('TradeJournalPage target navigation', () => {
  beforeEach(() => { HTMLElement.prototype.scrollIntoView = vi.fn(); });
  it.each(['campaign-1', 'trade-1'])('focuses the campaign containing target %s', (targetId) => {
    const onTargetFocused = vi.fn();
    render(<TradeJournalPage {...actions} targetId={targetId} onTargetFocused={onTargetFocused} />);
    expect(screen.getByText('EURUSD').closest('article')).toHaveFocus();
    expect(onTargetFocused).toHaveBeenCalledOnce();
  });
});
