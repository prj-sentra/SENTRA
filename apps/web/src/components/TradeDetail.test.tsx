import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExcursionRange, TradeDetail } from './TradeDetail';

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
  it('labels stale excursion metrics with the failed recalculation reason', () => {
    const excursion = { scope: 'trade', status: 'stale', attempt: { calculationVersion: 2, inputFingerprint: 'next', attemptedAt: '2026-08-11T00:00:00.000Z', failureReason: 'TICK_UNAVAILABLE' }, success: { calculationVersion: 1, inputFingerprint: 'prior', succeededAt: '2026-08-10T00:00:00.000Z', priceSource: 'mt5_copy_ticks_range', rawRange: { fromMsc: 1, toMsc: 2 }, displayRange: { fromAt: '2026-08-10T00:00:00.000Z', toAt: '2026-08-10T00:00:00.000Z' }, tickSnapshotToMsc: 2, pathDigest: 'path', tickCount: 2, valuationVersion: 1, valuationDigest: 'digest', accountCurrency: 'USD' }, metrics: { price: { mfe: { value: 3, occurredAt: '2026-08-10T00:00:00.000Z', markPrice: 3 }, mae: { value: -2, occurredAt: '2026-08-10T00:00:00.000Z', markPrice: 2 } }, percent: { mfe: { value: 3, occurredAt: '2026-08-10T00:00:00.000Z', markPrice: 3 }, mae: { value: -2, occurredAt: '2026-08-10T00:00:00.000Z', markPrice: 2 } }, unrealizedPnl: { mfe: { value: 30, occurredAt: '2026-08-10T00:00:00.000Z' }, mae: { value: -20, occurredAt: '2026-08-10T00:00:00.000Z' } }, rAvailability: 'risk_unavailable' } };
    render(<TradeDetail campaign={{ ...campaign, members: [{ ...campaign.members[0], excursion }, campaign.members[1]] }} onPatchAnalysis={vi.fn()} onPatchCampaignAnalysis={vi.fn()} />);
    expect(screen.getAllByText('재계산 필요').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/MT5에서 해당 기간의 가격 기록을 가져오지 못했습니다/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/수익 실현률/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('보유 중 손익 범위').length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText('최대 손실 -20 USD, 실제 손익 120 USD, 최대 수익 기회 30 USD').length).toBeGreaterThan(0);
    expect(screen.getAllByText('경로: 최대 손실 위험 + 최대 수익 기회').length).toBeGreaterThan(0);
    expect(screen.queryByText(/TICK_UNAVAILABLE/, { selector: 'summary' })).not.toBeInTheDocument();
  });
  it('renders negative MFE without a negative-width profit segment and groups timestamp ties', () => {
    const { container } = render(<ExcursionRange opportunity={-1} risk={-10} realizedPnl={-2} currency="USD" openedAt="2026-08-10T12:00:00.000Z" closedAt="2026-08-10T13:00:00.000Z" opportunityAt="2026-08-10T12:30:00.000Z" riskAt="2026-08-10T12:30:00.000Z" />);
    expect(container.querySelector<HTMLElement>('.range-profit')).toHaveStyle({ width: '0%' });
    expect(screen.getByText('경로: 최대 손실 위험 + 최대 수익 기회 → 청산')).toBeInTheDocument();
    expect(container.querySelector<HTMLElement>('.range-opportunity')).toHaveStyle({ left: '90%' });
  });
  it('pins an out-of-range realized result to the edge and labels it truthfully', () => {
    const { container } = render(<ExcursionRange opportunity={10} risk={-5} realizedPnl={20} currency="USD" openedAt="2026-08-10T12:00:00.000Z" closedAt="2026-08-10T13:00:00.000Z" opportunityAt="2026-08-10T12:20:00.000Z" riskAt="2026-08-10T12:10:00.000Z" />);
    const marker = container.querySelector<HTMLElement>('.range-realized')!;
    expect(marker).toHaveStyle({ left: '100%' });
    expect(marker).toHaveClass('is-outside', 'is-after');
    expect(screen.getByText('실제 20 USD · 범위 밖')).toBeInTheDocument();
  });
  it('keeps a zero-span range finite', () => {
    const { container } = render(<ExcursionRange opportunity={0} risk={0} realizedPnl={0} currency="USD" openedAt="2026-08-10T12:00:00.000Z" opportunityAt="2026-08-10T12:00:00.000Z" riskAt="2026-08-10T12:00:00.000Z" />);
    expect(container.querySelector<HTMLElement>('.range-zero')).toHaveStyle({ left: '50%' });
    expect(container.innerHTML).not.toContain('NaN');
    expect(container.innerHTML).not.toContain('Infinity');
  });
  it('aligns exact MAE and MFE endpoint labels inward without calling them out of range', () => {
    const props = { opportunity: 10, risk: -5, currency: 'USD', openedAt: '2026-08-10T12:00:00.000Z', opportunityAt: '2026-08-10T12:20:00.000Z', riskAt: '2026-08-10T12:10:00.000Z' };
    const { container, rerender } = render(<ExcursionRange {...props} realizedPnl={-5} />);
    let marker = container.querySelector<HTMLElement>('.range-realized')!;
    expect(marker).toHaveClass('is-before');
    expect(marker).not.toHaveClass('is-outside');
    rerender(<ExcursionRange {...props} realizedPnl={10} />);
    marker = container.querySelector<HTMLElement>('.range-realized')!;
    expect(marker).toHaveClass('is-after');
    expect(marker).not.toHaveClass('is-outside');
  });
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
