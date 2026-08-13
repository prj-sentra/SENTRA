import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TradeStatsPreferences, TradeStatsResponse } from '@trading-journal/shared';
import { StatsPage } from './StatsPage';
afterEach(() => { cleanup(); localStorage.clear(); });
const preferences: TradeStatsPreferences = { breakevenPercent: 0.1, timeZone: 'America/New_York', tradingDayStartMinutes: 0, sessions: { asia: { startMinutes: 0, endMinutes: 480 }, london: { startMinutes: 480, endMinutes: 960 }, 'new-york': { startMinutes: 780, endMinutes: 1260 } }, display: { timeZone: 'Asia/Seoul', utcOffsetMinutes: 540, tradingDayStartLabel: '09:00', sessions: { asia: { startLabel: '09:00', endLabel: '17:00' }, london: { startLabel: '17:00', endLabel: '01:00' }, 'new-york': { startLabel: '22:00', endLabel: '06:00' } } } };
const bucket = { key: 'EURUSD', label: 'EURUSD', count: 12, classifiedCount: 12, winRate: 50, realizedPnl: 120, oneLotPnl: 60, sufficiency: '10-29' as const };
const overview = { totalTrades: 12, totalRealizedPnl: 120, averageRealizedPnl: 10, oneLotPnl: 60, winRate: 50, breakevenRate: 5, profitFactor: 1.4, payoff: 1.2, expectancy: 10, wins: 6, losses: 5, breakevens: 1, classifiedCount: 12, averageWin: 30, averageLoss: -15, maxWinStreak: 3, currentWinStreak: 2, maxLossStreak: 2, currentLossStreak: 0, totalRiskAmount: 20, riskAmountCount: 10, riskPercentCount: 10, r: { value: 1, count: 8, missingCount: 4, total: 8, expectancy: 1 } };
const series = { granularity: 'day' as const, points: [{ key: '2026-01-01', label: '1월 1일', timestamp: Date.parse('2026-01-01T00:00:00Z'), count: 1, realizedPnl: 120, equity: 120, oneLotPnl: 60, winRate: 50 }], activeBucketAverage: 120, calendarBucketAverage: 60 };
const stats: TradeStatsResponse = { preferences, query: { accountId: 'a', unit: 'campaign' }, overview, comparison: { current: overview, prior: overview, from: '2026-01-01', to: '2026-01-02', priorFrom: '2025-12-30', priorTo: '2025-12-31' }, timeSeries: { sequence: { ...series, granularity: 'sequence', points: [{ ...series.points[0], key: '1', label: '매매 1' }] }, day: series, week: { ...series, granularity: 'week' }, month: { ...series, granularity: 'month' }, year: { ...series, granularity: 'year' } }, breakdowns: { symbol: [bucket] }, performanceGroups: [], crosstab: { rowDimension: 'symbol', columnDimension: 'session', columns: [{ key: 'asia', label: 'Asia', predicate: { dimension: 'session', key: 'asia' } }, { key: 'london', label: 'London', predicate: { dimension: 'session', key: 'london' } }], rows: [{ key: 'breakout', label: 'Breakout', predicate: { dimension: 'symbol', key: 'breakout' }, cells: [] }] }, drawdown: { money: 20, percent: 2, r: 1 }, diagnostics: { missingSeedCount: 1, missingSeedIds: ['seed-1'], unclassifiedCount: 0, missingLotsCount: 1, missingLotsIds: ['lots-1'], missingRiskCount: 1, missingRiskIds: ['risk-1'], incompleteCampaignCount: 1, incompleteCampaignIds: ['campaign-1'] }, drilldown: [{ id: 'trade-1', targetId: 'campaign-9', type: 'campaign', tradeIds: ['trade-1'], campaignId: 'campaign-9', journalDate: '2026-01-03', accountId: 'a', symbol: 'EURUSD', side: 'long', openedAt: '2026-01-01T01:00:00Z', closedAt: '2026-01-01T02:00:00Z', realizedPnl: 120, lots: 1, outcome: 'win' }] };
function page(request = vi.fn((path: string) => Promise.resolve(path.includes('preferences') ? preferences : { ...stats, filterOptions: { symbol: [{ key: 'EURUSD', label: 'EURUSD' }], session: [{ key: 'new-york', label: 'new-york' }, { key: 'asia', label: 'asia' }], entryWeekday: [{ key: '금요일', label: '금요일' }, { key: '월요일', label: '월요일' }], exitReason: [{ key: 'manual', label: 'manual' }], baseTimeframe: [{ key: '1h', label: '1h' }] } }))) { const open = vi.fn(); render(<StatsPage accountId="a" request={request} onOpenRecord={open} />); return { request, open }; }
describe('StatsPage', () => {
  it('renders the selected-unit excursion summary and distributions', async () => {
    const request = vi.fn(() => Promise.resolve({ ...stats, excursions: { unit: 'campaign', families: [{ family: 'campaign_price', status: { success: 2, stale: 1, failed: 1, unsupported: 1, missing: 3 }, price: { mfe: { sampleCount: 2, mean: 3, bins: [] }, mae: { sampleCount: 2, mean: -2, bins: [] } }, percent: { mfe: { sampleCount: 2, bins: [] }, mae: { sampleCount: 2, bins: [] } }, counts: { eligibleSuccessCount: 2, heterogeneousUnavailableCount: 1 } }, { family: 'campaign_unrealized_pnl', status: { success: 2, stale: 0, failed: 0, unsupported: 0, missing: 0 }, unrealizedPnl: { mfe: { sampleCount: 2, mean: 10, bins: [] }, mae: { sampleCount: 2, mean: -5, bins: [] } }, r: { mfe: { sampleCount: 0, bins: [] }, mae: { sampleCount: 0, bins: [] } }, captureRate: { sampleCount: 1, mean: 50, bins: [] }, counts: { eligibleSuccessCount: 2, riskUnavailableCount: 0, captureEligibleCount: 1, valuationUnavailableCount: 0 } }] } } as TradeStatsResponse));
    page(request);
    expect(await screen.findByText('시장 진행 분석')).toBeInTheDocument();
    expect(screen.getByText('평균 최대 수익 기회')).toBeInTheDocument();
    expect(screen.getByText('평균 최대 손실 위험')).toBeInTheDocument();
    expect(screen.getByText('평균 수익 실현률')).toBeInTheDocument();
    expect(screen.getByText('데이터 품질 및 상세 분포')).toBeInTheDocument();
    expect(screen.getByText('계산 완료 2건')).toBeInTheDocument();

  });
  it('renders redesigned metrics, selected diagnostics and populated breakdown panels', async () => { page(); expect(await screen.findByText('연속 기록')).toBeInTheDocument(); expect(screen.getByText('위험 조정 성과')).toBeInTheDocument(); expect(screen.getByText('최대 낙폭 (MDD)')).toBeInTheDocument(); expect(screen.queryByText('기대 수익')).not.toBeInTheDocument(); expect(screen.getByText('PF (Profit Factor)')).toHaveAttribute('data-tooltip', expect.stringContaining('총 수익 PnL')); expect(screen.getByText('거래당 평균 포인트')).toHaveAttribute('data-tooltip', expect.stringContaining('각 진입의 실현 PnL')); expect(screen.getAllByRole('alert').some((alert) => alert.textContent?.includes('seed-1'))).toBe(true); expect(screen.queryByText(/위험금액 누락\/주의/)).not.toBeInTheDocument(); expect(screen.queryByText(/미완성 캠페인 누락\/주의/)).not.toBeInTheDocument(); });
  it('shows win, loss, and breakeven shares in the trade-count equation', async () => { page(); await screen.findByLabelText('총 거래 횟수 계산'); expect(screen.getByText('(50%)')).toBeInTheDocument(); expect(screen.getByText('(42%)')).toBeInTheDocument(); expect(screen.getByText('(8%)')).toBeInTheDocument(); });
  it('uses 매매 and 진입 terminology and removes direction and outcome filters', async () => { page(); expect(await screen.findByRole('button', { name: '매매' })).toBeInTheDocument(); expect(screen.getByRole('button', { name: '진입' })).toBeInTheDocument(); expect(screen.queryByLabelText('long')).not.toBeInTheDocument(); expect(screen.queryByLabelText('win')).not.toBeInTheDocument(); });
  it('shows entry-only filters only for entry statistics and localizes ordered options', async () => { const { request } = page(); fireEvent.click(await screen.findByRole('button', { name: '필터 열기' })); await screen.findByText('아시아장'); expect(screen.getByText('미장')).toBeInTheDocument(); expect(screen.getByText('월요일').compareDocumentPosition(screen.getByText('금요일')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); expect(screen.queryByRole('group', { name: '청산 사유' })).not.toBeInTheDocument(); expect(screen.queryByRole('group', { name: '기준봉' })).not.toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: '진입' })); expect(await screen.findByRole('group', { name: '청산 사유' })).toBeInTheDocument(); expect(screen.getByRole('group', { name: '기준봉' })).toBeInTheDocument(); fireEvent.click(screen.getByLabelText('1h')); await waitFor(() => expect(request.mock.calls.some(([path]) => path.includes('unit=trade') && path.includes('baseTimeframes=1h'))).toBe(true)); fireEvent.click(screen.getByRole('button', { name: '매매' })); await waitFor(() => { const path = request.mock.calls.at(-1)?.[0] ?? ''; expect(path).toContain('unit=campaign'); expect(path).not.toContain('baseTimeframes'); expect(path).not.toContain('exitReasons'); }); });
  it('renders database filter options and applies checkbox selections', async () => { const { request } = page(); fireEvent.click(await screen.findByRole('button', { name: '필터 열기' })); const symbol = await screen.findByLabelText('EURUSD'); fireEvent.click(symbol); await waitFor(() => expect(request.mock.calls.some(([path]) => path.includes('symbols=EURUSD'))).toBe(true)); });
  it('defaults to the first trade through the current Seoul date', async () => { const { request } = page(); await screen.findByRole('button', { name: '매매' }); fireEvent.click(screen.getByRole('button', { name: '필터 열기' })); expect(screen.getByLabelText('시작일')).toHaveValue('2026-01-03'); expect(screen.getByLabelText('종료일')).toBeDisabled(); expect(screen.getByLabelText('오늘까지')).toBeChecked(); expect(screen.queryByText('전문 통계')).not.toBeInTheDocument(); await waitFor(() => expect(request.mock.calls.some(([path]) => path.includes('from=2026-01-03') && path.includes('to='))).toBe(true)); });
  it('uses sidebar criteria for grouped performance and child filtering', async () => { const request = vi.fn((path: string) => Promise.resolve({ ...stats, performanceGroups: path.includes('groupDimensions=symbol') && path.includes('groupDimensions=side') ? [{ key: 'EURUSD|long', labels: ['EURUSD', 'long'], predicates: [], count: 3, classifiedCount: 3, winRate: 66.67, totalPnl: 120, averagePnl: 40, averagePoint: 80 }] : [], filterOptions: { symbol: [{ key: 'EURUSD', label: 'EURUSD' }], side: [{ key: 'long', label: 'Long' }, { key: 'short', label: 'Short' }] } })); page(request); await waitFor(() => expect(request.mock.calls.some(([path]) => path.includes('from=2026-01-03'))).toBe(true)); fireEvent.click(screen.getByRole('button', { name: '필터 열기' })); fireEvent.click(screen.getByLabelText('종목')); await waitFor(() => expect(request.mock.calls.some(([path]) => path.includes('groupDimensions=symbol') && path.includes('symbols=EURUSD'))).toBe(true)); fireEvent.click(screen.getByLabelText('방향')); await waitFor(() => expect(request.mock.calls.some(([path]) => path.includes('groupDimensions=symbol') && path.includes('groupDimensions=side') && path.includes('symbols=EURUSD') && path.includes('sides=long') && path.includes('sides=short'))).toBe(true)); const winRate = await screen.findByText('66.67%'); expect(winRate.style.backgroundColor).toContain('rgba(25, 128, 56'); const short = screen.getByLabelText('Short'); fireEvent.click(short); expect(short).not.toBeChecked(); await waitFor(() => expect(request.mock.calls.at(-1)?.[0]).toContain('sides=long')); expect(request.mock.calls.at(-1)?.[0]).not.toContain('sides=short'); });
  it('opens the right filter sidebar and category checkboxes select all child values', async () => { const { request } = page(); const sidebar = await screen.findByLabelText('대시보드 공통 필터'); fireEvent.click(screen.getByRole('button', { name: '필터 열기' })); expect(sidebar).toHaveClass('is-open'); const category = screen.getByRole('group', { name: '종목' }).querySelector('legend input')!; fireEvent.click(category); await waitFor(() => expect(request.mock.calls.some(([path]) => path.includes('symbols=EURUSD'))).toBe(true)); });
  it('adds a partially selected criterion to integrated performance automatically', async () => { const { request } = page(); fireEvent.click(await screen.findByRole('button', { name: '필터 열기' })); fireEvent.click(screen.getByLabelText('EURUSD')); await waitFor(() => expect(request.mock.calls.some(([path]) => path.includes('symbols=EURUSD') && path.includes('groupDimensions=symbol'))).toBe(true)); });
  it('does not render dashboard section headings or the removed drilldown viewer', async () => { page(); await screen.findByLabelText('핵심 성과 지표'); expect(screen.queryByText('기간별 성과')).not.toBeInTheDocument(); expect(screen.queryByText('통합 성과')).not.toBeInTheDocument(); expect(screen.queryByText('드릴다운')).not.toBeInTheDocument(); });
  it('places the comparison table between charts and advanced metrics', async () => { page(); const charts = await screen.findByLabelText('성과 추이'); const comparison = screen.getByText('비교할 기준을 하나 이상 선택하세요.'); const advanced = screen.getByLabelText('고급 성과 지표'); expect(charts.compareDocumentPosition(comparison) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); expect(comparison.compareDocumentPosition(advanced) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); });
  it('restores cached unit and dates while refreshing a checked today date', async () => { localStorage.setItem('sentra:stats-controls', JSON.stringify({ unit: 'trade', from: '2026-02-01', to: '2020-01-01', throughLatest: true })); const { request } = page(); await waitFor(() => expect(screen.getByRole('button', { name: '진입' })).toHaveClass('active')); fireEvent.click(screen.getByRole('button', { name: '필터 열기' })); expect(screen.getByLabelText('시작일')).toHaveValue('2026-02-01'); expect(screen.getByLabelText('종료일')).not.toHaveValue('2020-01-01'); await waitFor(() => expect(request.mock.calls.some(([path]) => path.includes('unit=trade') && path.includes('from=2026-02-01') && !path.includes('to=2020-01-01'))).toBe(true)); });
  it('caches detailed selections and clears them with reset', async () => { localStorage.setItem('sentra:stats-filters-open', 'true'); localStorage.setItem('sentra:stats-controls', JSON.stringify({ unit: 'campaign', throughLatest: true, filters: { from: '2026-01-03', symbols: ['EURUSD'] } })); page(); await waitFor(() => expect(screen.getByLabelText('EURUSD')).toBeChecked()); fireEvent.click(screen.getByRole('button', { name: '필터 초기화' })); expect(screen.getByLabelText('EURUSD')).not.toBeChecked(); expect(screen.getByRole('button', { name: '매매' })).toHaveClass('active'); });
  it('recalculates statistics without changing filters', async () => { const { request } = page(); await screen.findByRole('button', { name: '다시 계산' }); const calls = request.mock.calls.length; fireEvent.click(screen.getByRole('button', { name: '다시 계산' })); await waitFor(() => expect(request.mock.calls.length).toBeGreaterThan(calls)); });
  it('keeps expanded filters hidden by default and caches visibility', async () => { page(); expect(await screen.findByRole('button', { name: '필터 열기' })).toHaveAttribute('aria-expanded', 'false'); expect(screen.queryByText('필터 설정')).not.toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: '필터 열기' })); expect(await screen.findByText('필터 설정')).toBeInTheDocument(); expect(localStorage.getItem('sentra:stats-filters-open')).toBe('true'); });
  it('renders one chart at a time and switches chart values and sequence spacing', async () => {
    page();
    const chart = await screen.findByRole('img', { name: '성과 추이' });
    expect(chart.tagName).toBe('svg');
    expect(screen.getByRole('tablist', { name: '차트 유형' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '누적 실현 PnL' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.pointerMove(chart, { clientX: 320 });
    expect(chart.parentElement!.querySelector('.stats-line-chart-legend strong')).toHaveTextContent('120');
    fireEvent.click(screen.getByRole('tab', { name: '승률' }));
    fireEvent.pointerMove(chart, { clientX: 320 });
    expect(chart.parentElement!.querySelector('.stats-line-chart-legend strong')).toHaveTextContent('50.00%');
    fireEvent.click(screen.getByRole('tab', { name: '총 먹은 포인트' }));
    expect(screen.getByText('각 진입의 실현 PnL ÷ Lot을 더한 누적값입니다.')).toBeInTheDocument();
    fireEvent.pointerMove(chart, { clientX: 320 });
    expect(chart.parentElement!.querySelector('.stats-line-chart-legend strong')).toHaveTextContent('60');
    fireEvent.click(screen.getByRole('tab', { name: '매매' }));
    expect(screen.getByRole('tablist', { name: '차트 간격' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '균등 간격' }));
    expect(screen.getByRole('tab', { name: '균등 간격' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: '일' }));
    expect(screen.queryByRole('tablist', { name: '차트 간격' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '매매' }));
    expect(screen.getByRole('tab', { name: '균등 간격' })).toHaveAttribute('aria-selected', 'true');
  });
  it('keeps the chart on the latest symbol-filter response when an older request resolves last', async () => {
    const pending: Array<{ path: string; resolve: (value: TradeStatsResponse) => void }> = [];
    const request = vi.fn((path: string) => new Promise<TradeStatsResponse>((resolve) => pending.push({ path, resolve })));
    const response = (label: string, equity: number): TradeStatsResponse => ({
      ...stats,
      filterOptions: { symbol: [{ key: 'XAUUSD', label: 'Gold' }] },
      timeSeries: Object.fromEntries(Object.entries(stats.timeSeries).map(([key, value]) => [key, {
        ...value,
        points: value.points.map((point) => ({ ...point, label, equity, oneLotPnl: equity / 2 })),
      }])) as TradeStatsResponse['timeSeries'],
    });

    page(request);
    await waitFor(() => expect(pending).toHaveLength(1));
    pending[0].resolve(response('기존 EURUSD', 120));
    await waitFor(() => expect(pending).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: '필터 열기' }));
    fireEvent.click(await screen.findByLabelText('Gold'));
    await waitFor(() => expect(pending).toHaveLength(3));
    expect(pending[2].path).toContain('symbols=XAUUSD');
    pending[2].resolve(response('최신 Gold', 999));
    await waitFor(() => {
      const chart = screen.getByRole('img', { name: '성과 추이' });
      fireEvent.pointerMove(chart, { clientX: 320 });
      const legend = chart.closest('.stats-line-chart-shell')!.querySelector('.stats-line-chart-legend')!;
      expect(legend).toHaveTextContent('최신 Gold');
      expect(legend.querySelector('strong')).toHaveTextContent('999');
    });

    pending[1].resolve(response('오래된 EURUSD', 120));
    await waitFor(() => {
      const chart = screen.getByRole('img', { name: '성과 추이' });
      fireEvent.pointerMove(chart, { clientX: 320 });
      const legend = chart.closest('.stats-line-chart-shell')!.querySelector('.stats-line-chart-legend')!;
      expect(legend).toHaveTextContent('최신 Gold');
      expect(legend).not.toHaveTextContent('오래된 EURUSD');
    });
  });
});
