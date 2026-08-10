import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { TradeRecord } from '@trading-journal/shared';
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

describe('ExecutionTradeRow summary metrics', () => {
  it('shows the execution time and six requested metrics', () => {
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

    expect(screen.getByText(/26\. 8\. 10\..*-/)).toBeInTheDocument();
    for (const label of ['진입가', '수량', '청산가', '청산 사유', '시드 변화', 'PnL']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    for (const excluded of ['TP', 'SL', 'Risk', 'Return', 'RR']) {
      expect(screen.queryByText(excluded)).toBeNull();
    }
    expect(screen.getByText('시드 변화').nextElementSibling).toHaveTextContent('10,000 → 10,250');
    expect(screen.getByText('250')).toHaveClass('pnl', 'positive');
  });

  it('does not show ticker or execution status labels', () => {
    render(<ExecutionTradeRow trade={trade()} />);

    expect(screen.queryByText('EURUSD')).toBeNull();
    expect(screen.queryByText(/매수.*청산/)).toBeNull();
  });
});
