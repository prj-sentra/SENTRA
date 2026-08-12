import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TradeCampaign, TradeRecord } from '@trading-journal/shared';
import { ExecutionTradeRow } from './ExecutionTradeRow';

afterEach(() => cleanup());

const trade = (metrics: Partial<TradeRecord> = {}): TradeRecord => ({
  id: 'trade-1',
  symbol: 'EURUSD',
  side: 'long',
  status: 'closed',
  accountId: 'account-1',
  analysisComplete: false,
  analysis: {} as TradeRecord['analysis'],
  createdAt: '2026-08-10T00:00:00.000Z',
  updatedAt: '2026-08-10T00:00:00.000Z',
  ...metrics,
});
const campaign = (headSource: 'AUTO' | 'MANUAL', rootTradeId = 'trade-1'): TradeCampaign => ({
  id: 'campaign-1', rootTradeId, headSource, campaignVersion: 4, members: [trade(), trade({ id: 'trade-2' })],
} as TradeCampaign);

describe('ExecutionTradeRow summary metrics', () => {
  it('shows the execution period above the four metrics', () => {
    render(<ExecutionTradeRow trade={trade({
      openedAt: '2026-08-10T01:00:00.000Z',
      closedAt: '2026-08-10T02:00:00.000Z',
      entryPrice: 100,
      exitPrice: 110,
      quantityLots: 2,
      exitReason: 'target_hit',
      seedBalance: 10_000,
      realizedPnl: 250,
      initialTakeProfitPrice: 125.5,
      initialStopLossPrice: 90,
      riskPercent: 2,
      returnPercent: 5,
    })} />);

    for (const label of ['진입가 / 청산가', '수량', '청산 사유', 'PNL']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    for (const excluded of ['시드 변화', 'TP', 'SL', 'Risk', 'Return', 'RR']) {
      expect(screen.queryByText(excluded)).toBeNull();
    }
    expect(screen.getByText(/26\. 8\. 10\..* - .*26\. 8\. 10\./)).toHaveClass('execution-period');
    expect(screen.getByText('진입가 / 청산가').nextElementSibling).toHaveTextContent('100 / 110');
    expect(screen.getByText('250')).not.toHaveClass('pnl');
    expect(screen.getByText('목표가 도달 (TP)')).toBeInTheDocument();
  });

  it('does not show ticker or execution status labels', () => {
    render(<ExecutionTradeRow trade={trade()} />);

    expect(screen.queryByText('EURUSD')).toBeNull();
    expect(screen.queryByText(/매수.*청산/)).toBeNull();
  });

  it('renders automatic heads as non-actionable and manual heads with an unset action', () => {
    const { rerender } = render(<ExecutionTradeRow trade={trade()} campaign={campaign('AUTO')} />);
    expect(screen.getByText('첫 매매 · 자동 지정')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '지정 해제' })).toBeNull();

    rerender(<ExecutionTradeRow trade={trade()} campaign={campaign('MANUAL')} />);
    expect(screen.getByText('첫 매매 · 수동 지정')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '지정 해제' })).toBeEnabled();
  });

  it('confirms before changing a non-head, respects cancellation, and disables while account mutation is busy', () => {
    const onChangeCampaignHead = vi.fn().mockResolvedValue(undefined);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const nonHead = trade({ id: 'trade-2' });
    const { rerender } = render(<ExecutionTradeRow trade={nonHead} campaign={campaign('AUTO')} onChangeCampaignHead={onChangeCampaignHead} />);
    const action = screen.getByRole('button', { name: '첫 매매로 지정' });
    fireEvent.click(action);
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('별도 캠페인으로 분할'));
    expect(onChangeCampaignHead).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.click(action);
    expect(onChangeCampaignHead).toHaveBeenCalledWith(expect.objectContaining({ id: 'campaign-1', campaignVersion: 4 }), 'trade-2');

    rerender(<ExecutionTradeRow trade={nonHead} campaign={campaign('AUTO')} busy onChangeCampaignHead={onChangeCampaignHead} />);
    expect(screen.getByRole('button', { name: '첫 매매로 지정' })).toBeDisabled();
    confirm.mockRestore();
  });
});
