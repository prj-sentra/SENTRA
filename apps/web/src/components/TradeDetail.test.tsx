import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TradeDetail } from './TradeDetail';

afterEach(() => cleanup());

const member = (id: string, baseTimeframe: string, complete = false) => ({
  id, symbol: 'XAUUSD', side: id === 'trade-1' ? 'long' : 'short', status: 'open', analysisComplete: complete, quantityLots: 1, realizedPnl: id === 'trade-1' ? 120 : -45,
  openedAt: '2026-08-10T12:00:00.000Z',
  analysis: {
    schemaVersion: 3, updatedAt: '2026-08-10T12:00:00.000Z', createdAt: '2026-08-10T11:00:00.000Z',
    baseTimeframe, bollingerBandCount: null, bollingerDirection: null,
  },
});

const campaign = { id: 'campaign-1', rootTradeId: 'trade-1', analysis: { schemaVersion: 1, updatedAt: '2026-08-10T12:30:00.000Z', createdAt: '2026-08-10T11:00:00.000Z', primaryTrend: null, maTimeframes: {}, marketZoneEnabled: false, chartPatternObserved: false, retailPositionEnabled: false, fibonacciEnabled: false, economicIndicators: [] }, members: [member('trade-1', '1m'), member('trade-2', '5m', true)] } as any;

describe('TradeDetail split execution ownership', () => {
  it('uses the desktop selection for the one desktop editor and keeps selected state on its navigation item', () => {
    const { container } = render(<TradeDetail campaign={campaign} onPatchAnalysis={vi.fn()} onPatchCampaignAnalysis={vi.fn()} />);
    const desktop = container.querySelector('.desktop-trade-detail')!;
    expect(within(desktop).getByDisplayValue('1m')).toBeInTheDocument();
    expect(within(desktop).getByText('볼린저밴드')).toBeInTheDocument();
    expect(screen.queryByText('매매 공통 분석')).toBeNull();
    expect(screen.getByText('진입별 분석')).toBeInTheDocument();
    expect(screen.queryByText(/추세와 기술적 근거/)).toBeNull();

    const secondDesktopTrade = within(desktop.parentElement!).getByRole('button', { name: /2.*번째 분할 진입/ });
    fireEvent.click(secondDesktopTrade);
    expect(within(desktop).getByDisplayValue('5m')).toBeInTheDocument();
    expect(secondDesktopTrade).toHaveAttribute('aria-current', 'step');
  });

  it('gives each mobile accordion toggle ownership of only its open execution panel', () => {
    render(<TradeDetail campaign={campaign} onPatchAnalysis={vi.fn()} onPatchCampaignAnalysis={vi.fn()} />);
    const first = screen.getByRole('button', { name: /1번째 실행/ });
    const second = screen.getByRole('button', { name: /2번째 실행/ });
    expect(first).toHaveAttribute('aria-controls', 'trade-detail-trade-1');
    expect(first).toHaveAttribute('aria-expanded', 'true');
    expect(second).toHaveAttribute('aria-expanded', 'false');
    expect(first).toHaveTextContent('1번째 실행 · 매수 · PnL 120');
    expect(second).toHaveTextContent('2번째 실행 · 매도 · PnL -45');

    fireEvent.click(second);
    expect(first).toHaveAttribute('aria-expanded', 'false');
    expect(second).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById('trade-detail-trade-1')).toBeNull();
    expect(within(document.getElementById('trade-detail-trade-2')!).getByDisplayValue('5m')).toBeInTheDocument();
  });

  it('reselects the affected trade after campaigns reload', () => {
    const { container, rerender } = render(<TradeDetail campaign={campaign} onPatchAnalysis={vi.fn()} onPatchCampaignAnalysis={vi.fn()} />);
    rerender(<TradeDetail campaign={{ ...campaign, members: [...campaign.members] }} selectedTradeId="trade-2" onPatchAnalysis={vi.fn()} onPatchCampaignAnalysis={vi.fn()} />);
    expect(within(container.querySelector('.desktop-trade-detail')!).getByDisplayValue('5m')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /2.*번째 분할 진입/ })).toHaveAttribute('aria-current', 'step');
  });
});
