import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { ExcursionCaptureBandKey, ExcursionDistribution, TradeStatsDimension, TradeStatsGranularity, TradeStatsOverview, TradeStatsQuery, TradeStatsResponse, TradeStatsUnit } from '@trading-journal/shared';
import { StatsLineChart } from './StatsLineChart';

export interface StatsPageProps { accountId: string; request: <T>(path: string, init?: RequestInit) => Promise<T>; onOpenRecord: (record: TradeStatsResponse['drilldown'][number]) => void; }
type Filters = Omit<TradeStatsQuery, 'accountId' | 'unit'>;
type CachedStatsControls = { unit: TradeStatsUnit; from?: string; to?: string; filters?: Filters; throughLatest: boolean };
const STATS_CONTROLS_KEY = 'sentra:stats-controls';
const seoulToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
function readCachedControls(today: string): CachedStatsControls | null { try { const parsed = JSON.parse(localStorage.getItem(STATS_CONTROLS_KEY) ?? 'null') as Partial<CachedStatsControls> | null; if (!parsed || !['campaign', 'trade'].includes(parsed.unit ?? '') || typeof parsed.throughLatest !== 'boolean') return null; const date = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined; const rawFilters = parsed.filters && typeof parsed.filters === 'object' ? parsed.filters : {}; const filters: Filters = { from: date(rawFilters.from) ?? date(parsed.from), to: parsed.throughLatest ? today : date(rawFilters.to) ?? date(parsed.to) }; for (const key of Object.values(predicateFilter)) { const value = rawFilters[key]; if (Array.isArray(value) && value.every((item) => typeof item === 'string')) (filters as Record<string, unknown>)[key] = value; } if (Array.isArray(rawFilters.groupDimensions) && rawFilters.groupDimensions.every((item) => dimensions.some(([dimension]) => dimension === item))) filters.groupDimensions = rawFilters.groupDimensions as TradeStatsDimension[]; return { unit: parsed.unit as TradeStatsUnit, filters, throughLatest: parsed.throughLatest }; } catch { return null; } }
function writeCachedControls(controls: CachedStatsControls): void { try { localStorage.setItem(STATS_CONTROLS_KEY, JSON.stringify(controls)); } catch { /* Statistics still work when browser storage is unavailable. */ } }
const FILTER_PANEL_KEY = 'sentra:stats-filters-open';
const FilterVisibilityContext = createContext<[boolean, (next: boolean) => void] | null>(null);
function FilterVisibilityProvider({ children }: { children: ReactNode }) { const [open, setOpen] = useState(() => { try { return localStorage.getItem(FILTER_PANEL_KEY) === 'true'; } catch { return false; } }); const update = (next: boolean) => { setOpen(next); try { localStorage.setItem(FILTER_PANEL_KEY, String(next)); } catch { /* Visibility still works without browser storage. */ } }; return <FilterVisibilityContext.Provider value={[open, update]}>{children}</FilterVisibilityContext.Provider>; }
function useFilterPanelVisibility(): [boolean, (next: boolean) => void] { const value = useContext(FilterVisibilityContext); if (!value) throw new Error('Filter visibility provider is missing'); return value; }
function FilterToggleButton() { const [open, setOpen] = useFilterPanelVisibility(); return <button type="button" className="secondary-button stats-filter-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? '필터 닫기' : '필터 열기'}</button>; }
const dimensions: Array<[TradeStatsDimension, string]> = [['symbol', '종목'], ['side', '방향'], ['exitReason', '청산 사유'], ['entryWeekday', '진입 요일'], ['session', '세션'], ['baseTimeframe', '기준봉'], ['bollingerSetup', '볼린저밴드'], ['executionEvaluation', '실행 평가'], ['violationFlags', '위반'], ['holdDuration', '보유 시간'], ['analysisCompleteness', '분석 완성도']];
const entryOnlyDimensions = new Set<TradeStatsDimension>(['exitReason', 'baseTimeframe', 'bollingerSetup', 'executionEvaluation', 'violationFlags']);
const sessionLabels: Record<string, string> = { asia: '아시아장', london: '유로장', 'new-york': '미장', 'off-session': '장외' };
const weekdayOrder = ['월요일', '화요일', '수요일', '목요일', '금요일', '토요일', '일요일'];
const granularities: Array<[TradeStatsGranularity, string]> = [['sequence', '단위'], ['day', '일'], ['week', '주'], ['month', '월'], ['year', '년']];
const predicateFilter: Record<TradeStatsDimension, keyof Filters> = { symbol: 'symbols', side: 'sides', exitReason: 'exitReasons', entryWeekday: 'entryWeekdays', session: 'sessions', baseTimeframe: 'baseTimeframes', bollingerSetup: 'bollingerSetups', executionEvaluation: 'evaluations', violationFlags: 'violations', holdDuration: 'holdDurationBands', analysisCompleteness: 'analysisCompleteness' };
const format = (value?: number, suffix = '') => value === undefined || !Number.isFinite(value) ? '—' : `${value.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}${suffix}`;
function query(accountId: string, unit: TradeStatsUnit, filters: Filters) { const params = new URLSearchParams({ accountId, unit }); const effective = { ...filters }; if (unit === 'campaign') { delete effective.exitReasons; delete effective.baseTimeframes; delete effective.bollingerSetups; delete effective.evaluations; delete effective.violations; effective.groupDimensions = effective.groupDimensions?.filter((dimension) => !entryOnlyDimensions.has(dimension)); } Object.entries({ ...effective, to: effective.to ?? seoulToday() }).forEach(([key, value]) => Array.isArray(value) ? value.forEach((item) => params.append(key, item)) : value && params.set(key, value)); return params.toString(); }
function MetricLabel({ children, tooltip }: { children: string; tooltip?: string }) { return tooltip ? <span className="metric-label has-tooltip" tabIndex={0} data-tooltip={tooltip}>{children}<span aria-hidden="true">?</span></span> : <span className="metric-label">{children}</span>; }
function TradeQuality({ overview }: { overview: TradeStatsOverview }) { return <article className="detail-metric-group trade-quality" aria-label="거래 품질"><h3>거래 품질</h3><div><section><MetricLabel tooltip="총 수익 PnL을 총 손실 PnL의 절댓값으로 나눈 값입니다. 1보다 크면 누적 수익이 누적 손실보다 큽니다.">PF (Profit Factor)</MetricLabel><strong>{format(overview.profitFactor ?? 0)}</strong></section><section><MetricLabel tooltip="평균 수익 PnL을 평균 손실 PnL의 절댓값으로 나눈 값입니다. 한 번 이길 때의 수익이 한 번 질 때의 손실보다 얼마나 큰지 보여줍니다.">Payoff</MetricLabel><strong>{format(overview.payoff ?? 0)}</strong></section></div></article>; }
function StreakPerformance({ overview }: { overview: TradeStatsOverview }) { return <article className="detail-metric-group streak-performance" aria-label="연속 기록"><h3>연속 기록</h3><div><section><MetricLabel>현재 연승</MetricLabel><strong className="is-profit">{overview.currentWinStreak}</strong></section><section><MetricLabel>최대 연승</MetricLabel><strong className="is-profit">{overview.maxWinStreak}</strong></section><section><MetricLabel>현재 연패</MetricLabel><strong className="is-loss">{overview.currentLossStreak}</strong></section><section><MetricLabel>최대 연패</MetricLabel><strong className="is-loss">{overview.maxLossStreak}</strong></section></div></article>; }
function RiskAdjustedPerformance({ overview }: { overview: TradeStatsOverview }) { return <article className="detail-metric-group risk-performance" aria-label="위험 조정 성과"><h3>위험 조정 성과</h3><div><section><MetricLabel tooltip="각 거래의 손익을 해당 거래에서 감수한 초기 위험금액으로 나눈 R 값의 누적 합계입니다.">총 R</MetricLabel><strong>{format(overview.r.total)}R</strong></section><section><MetricLabel tooltip="R을 계산할 수 있는 거래들의 평균 성과입니다. 예: +0.5R은 거래당 초기 위험의 절반만큼 평균 수익을 냈다는 뜻입니다.">평균 R</MetricLabel><strong>{format(overview.r.value)}R</strong></section><section><MetricLabel tooltip="승리·손실·본전을 포함한 분류 가능 거래에서 거래당 기대되는 평균 R입니다.">기대 R</MetricLabel><strong>{format(overview.r.expectancy)}R</strong></section></div></article>; }
function DrawdownPerformance({ drawdown }: { drawdown: TradeStatsResponse['drawdown'] }) { return <article className="detail-metric-group drawdown-performance" aria-label="최대 낙폭"><h3>최대 낙폭 (MDD)</h3><div><section><MetricLabel tooltip="누적 손익의 고점에서 이후 저점까지 발생한 가장 큰 금액 감소입니다.">금액 MDD</MetricLabel><strong>{format(drawdown.money)}</strong></section><section><MetricLabel tooltip="최대 금액 낙폭을 당시 기준 잔고 대비 백분율로 표시한 값입니다.">비율 MDD</MetricLabel><strong>{format(drawdown.percent, '%')}</strong></section><section><MetricLabel tooltip="최대 낙폭을 초기 위험 단위 R로 환산한 값입니다.">R MDD</MetricLabel><strong>{format(drawdown.r)}R</strong></section></div></article>; }
function PnlHero({ overview }: { overview: TradeStatsOverview }) { const totalProfit = overview.totalProfitPnl; const totalLoss = overview.totalLossPnl === undefined ? undefined : Math.abs(overview.totalLossPnl); const percentage = (count: number) => overview.totalTrades ? `${Math.round(count / overview.totalTrades * 100)}%` : '0%'; return <article className="performance-formulas"><div className="pnl-equation" aria-label="총 실현 PnL 계산"><div className="pnl-term pnl-total"><span>총 실현 PnL</span><strong>${format(overview.totalRealizedPnl)}</strong></div><span className="pnl-operator">=</span><div className="pnl-term"><span>총 수익 PnL</span><strong className="is-profit">+${format(totalProfit)}</strong></div><span className="pnl-operator">+</span><div className="pnl-term"><span>총 손실 PnL</span><strong className="is-loss">-${format(totalLoss)}</strong></div></div><div className="trade-count-equation" aria-label="총 거래 횟수 계산"><div className="count-term count-total"><span>총 거래 횟수</span><strong>{overview.totalTrades}</strong></div><span className="count-operator">=</span><div className="count-term"><span>승리</span><strong className="is-win">{overview.wins}<small>({percentage(overview.wins)})</small></strong></div><span className="count-operator">+</span><div className="count-term"><span>손실</span><strong className="is-loss">{overview.losses}<small>({percentage(overview.losses)})</small></strong></div><span className="count-operator">+</span><div className="count-term"><span>본전</span><strong>{overview.breakevens}<small>({percentage(overview.breakevens)})</small></strong></div></div></article>; }
function AveragePerformance({ overview }: { overview: TradeStatsOverview }) { return <article className="average-performance" aria-label="평균 성과"><div className="average-term average-primary"><MetricLabel>거래당 평균 PnL</MetricLabel><strong>${format(overview.averageRealizedPnl)}</strong></div><div className="average-term"><MetricLabel tooltip="각 진입의 실현 PnL을 해당 진입 Lot으로 나눈 뒤, 매매 단위에서는 그 진입별 값을 모두 더합니다. 표시값은 선택한 매매 또는 진입별 결과의 평균입니다.">거래당 평균 포인트</MetricLabel><strong>${format(overview.oneLotPnl)}</strong></div><div className="average-term"><MetricLabel>평균 수익 PnL</MetricLabel><strong className="is-profit">+${format(overview.averageWin === undefined ? undefined : Math.abs(overview.averageWin))}</strong></div><div className="average-term"><MetricLabel>평균 손실 PnL</MetricLabel><strong className="is-loss">-${format(overview.averageLoss === undefined ? undefined : Math.abs(overview.averageLoss))}</strong></div></article>; }
function IntegratedPerformanceViewer({ selected, groups }: { selected: TradeStatsDimension[]; groups: TradeStatsResponse['performanceGroups'] }) {
  const heat = (value: number | undefined, values: Array<number | undefined>, midpoint = 0) => {
    if (value === undefined || !Number.isFinite(value)) return undefined;
    const distance = value - midpoint;
    if (distance === 0) return { backgroundColor: 'transparent' };
    const maxDistance = Math.max(...values.filter((entry): entry is number => entry !== undefined && Number.isFinite(entry)).map((entry) => Math.abs(entry - midpoint)), 1);
    const alpha = 0.08 + Math.min(1, Math.abs(distance) / maxDistance) * 0.24;
    return { backgroundColor: distance > 0 ? `rgba(25, 128, 56, ${alpha})` : `rgba(218, 30, 40, ${alpha})` };
  };
  const totals = groups.map((group) => group.totalPnl), averages = groups.map((group) => group.averagePnl), winRates = groups.map((group) => group.winRate), points = groups.map((group) => group.averagePoint);
  const displayWidth = (value: string) => [...value].reduce((width, character) => width + (/[\u1100-\u11ff\u2e80-\u9fff\uac00-\ud7af]/.test(character) ? 2 : 1), 0);
  const conditionWidths = selected.map((dimension, index) => Math.max(
    displayWidth(dimensions.find(([value]) => value === dimension)?.[1] ?? ''),
    ...groups.map((group) => displayWidth(group.labels[index] ?? '')),
  ) + 2);
  const conditionWidth = conditionWidths.reduce((sum, width) => sum + width, 0);
  return <section className="integrated-performance">
    {selected.length ? <div className="stats-table-wrap"><table className="stats-table integrated-performance-table"><colgroup>{selected.map((dimension, index) => <col className="condition-column" key={dimension} style={{ width: `${conditionWidths[index]}ch` }} />)}<col className="count-column" style={{ width: '7ch' }} />{Array.from({ length: 4 }, (_, index) => <col className="value-column" key={index} style={{ width: `calc((100% - ${conditionWidth + 7}ch) / 4)` }} />)}</colgroup><thead><tr>{selected.map((dimension, index) => <th className={`condition-cell${index === selected.length - 1 ? ' condition-divider' : ''}`} key={dimension}>{dimensions.find(([value]) => value === dimension)?.[1]}</th>)}<th>건수</th><th>총 PnL</th><th>평균 PnL</th><th>승률</th><th>평균 포인트</th></tr></thead><tbody>{groups.map((group) => <tr key={group.key}>{group.labels.map((label, index) => <th className={`condition-cell${index === selected.length - 1 ? ' condition-divider' : ''}`} key={`${group.key}-${selected[index]}`}>{label}</th>)}<td>{group.count}</td><td style={heat(group.totalPnl, totals)}>{format(group.totalPnl)}</td><td style={heat(group.averagePnl, averages)}>{format(group.averagePnl)}</td><td style={heat(group.winRate, winRates, 50)}>{format(group.winRate, '%')}</td><td style={heat(group.averagePoint, points)}>{format(group.averagePoint)}</td></tr>)}</tbody></table></div> : <p className="integrated-performance-empty">비교할 기준을 하나 이상 선택하세요.</p>}
  </section>;
}
function StatsToolbar({ unit, setUnit, filters, setFilters, throughLatest, setThroughLatest, today, defaultFrom }: { unit: TradeStatsUnit; setUnit: (value: TradeStatsUnit) => void; filters: Filters; setFilters: (next: Filters) => void; throughLatest: boolean; setThroughLatest: (value: boolean) => void; today: string; defaultFrom?: string }) { const skipFirstWrite = useRef(true); const initialFrom = useRef(defaultFrom); useEffect(() => { if (skipFirstWrite.current) { skipFirstWrite.current = false; return; } writeCachedControls({ unit, filters: { ...filters, to: throughLatest ? today : filters.to }, throughLatest }); }, [filters, throughLatest, today, unit]); useEffect(() => { const cached = readCachedControls(today); if (!cached) return; setUnit(cached.unit); setThroughLatest(cached.throughLatest); setFilters(cached.filters ?? {}); }, []); const selectUnit = (next: TradeStatsUnit) => { setUnit(next); if (next === 'campaign') { const { exitReasons: _exitReasons, baseTimeframes: _baseTimeframes, bollingerSetups: _bollingerSetups, evaluations: _evaluations, violations: _violations, ...campaignFilters } = filters; setFilters({ ...campaignFilters, groupDimensions: campaignFilters.groupDimensions?.filter((dimension) => !entryOnlyDimensions.has(dimension)) }); } }; const reset = () => { localStorage.removeItem(STATS_CONTROLS_KEY); setUnit('campaign'); setThroughLatest(true); setFilters({ from: initialFrom.current, to: today }); }; return <section className="stats-toolbar" aria-label="통계 조회 조건"><div className="stats-unit"><button type="button" className={unit === 'campaign' ? 'active' : ''} onClick={() => selectUnit('campaign')}>매매</button><button type="button" className={unit === 'trade' ? 'active' : ''} onClick={() => selectUnit('trade')}>진입</button></div><div className="stats-date-range"><input aria-label="시작일" type="date" value={filters.from ?? ''} onChange={(event) => setFilters({ ...filters, from: event.target.value || undefined })} /><span aria-hidden="true">~</span><input aria-label="종료일" type="date" disabled={throughLatest} value={filters.to ?? today} onChange={(event) => setFilters({ ...filters, to: event.target.value || undefined })} /><label className="stats-through-latest">오늘<input type="checkbox" checked={throughLatest} onChange={(event) => { const checked = event.target.checked; setThroughLatest(checked); setFilters({ ...filters, to: checked ? today : filters.to ?? today }); }} /></label></div><div className="stats-toolbar-actions"><button type="button" className="secondary-button stats-recalculate" onClick={() => setFilters({ ...filters })}>다시 계산</button><FilterToggleButton /><button type="button" className="secondary-button stats-reset" onClick={reset}>필터 초기화</button></div></section>; }
function FilterOptionsPanel({ unit, options, filters, setFilters }: { unit: TradeStatsUnit; options: NonNullable<TradeStatsResponse['filterOptions']>; filters: Filters; setFilters: (next: Filters) => void }) {
  const [open, setOpen] = useFilterPanelVisibility();
  const visibleDimensions = dimensions.filter(([dimension]) => unit === 'trade' || !entryOnlyDimensions.has(dimension));
  const valuesFor = (dimension: TradeStatsDimension) => [...(options[dimension] ?? [])].sort((left, right) => dimension === 'entryWeekday' ? weekdayOrder.indexOf(left.key) - weekdayOrder.indexOf(right.key) : left.label.localeCompare(right.label, 'ko'));
  const toggle = (dimension: TradeStatsDimension, key: string) => {
    const filterKey = predicateFilter[dimension], selected = (filters[filterKey] as string[] | undefined) ?? [];
    const nextSelected = selected.includes(key) ? selected.filter((value) => value !== key) : [...selected, key];
    const grouped = filters.groupDimensions?.includes(dimension) ?? false;
    setFilters({
      ...filters,
      [filterKey]: nextSelected.length ? nextSelected as never : undefined,
      groupDimensions: nextSelected.length
        ? grouped ? filters.groupDimensions : [...(filters.groupDimensions ?? []), dimension]
        : filters.groupDimensions?.filter((value) => value !== dimension),
    });
  };
  const toggleAll = (dimension: TradeStatsDimension) => {
    const filterKey = predicateFilter[dimension], values = valuesFor(dimension).map(({ key }) => key);
    const grouped = filters.groupDimensions?.includes(dimension) ?? false;
    setFilters({
      ...filters,
      groupDimensions: grouped ? filters.groupDimensions?.filter((value) => value !== dimension) : [...(filters.groupDimensions ?? []), dimension],
      [filterKey]: grouped ? undefined : values as never,
    });
  };
  if (!open) return null;
  return <><button className="stats-filter-backdrop" type="button" aria-label="필터 닫기" onClick={() => setOpen(false)} /><aside className="stats-filter-drawer" role="dialog" aria-modal="true" aria-label="대시보드 필터">
    <header><div><strong>대시보드 필터</strong><span>모든 성과 지표와 그래프에 공통 적용</span></div><button type="button" className="secondary-button compact" onClick={() => setOpen(false)}>닫기</button></header>
    <section className="drawer-period-filter"><label className="filter-category-master"><input type="checkbox" checked={Boolean(filters.from || filters.to)} onChange={(event) => setFilters({ ...filters, from: event.target.checked ? filters.from ?? seoulToday() : undefined, to: event.target.checked ? filters.to ?? seoulToday() : undefined })} />기간</label><span>{filters.from ?? '전체'} ~ {filters.to ?? '오늘'}</span></section>
    <div className="stats-option-panel" aria-label="상세 조회 조건">{visibleDimensions.map(([dimension, label]) => {
      const values = valuesFor(dimension); if (!values.length) return null;
      const selected = (filters[predicateFilter[dimension]] as string[] | undefined) ?? [], grouped = filters.groupDimensions?.includes(dimension) ?? false;
      return <fieldset key={dimension}><legend><label className="filter-category-master"><input type="checkbox" checked={grouped} onChange={() => toggleAll(dimension)} />{label}</label></legend><div>{values.map((option) => <label key={option.key}><input type="checkbox" checked={selected.includes(option.key)} onChange={() => toggle(dimension, option.key)} /><span>{dimension === 'session' ? sessionLabels[option.key] ?? option.label : option.label}</span></label>)}</div></fieldset>;
    })}</div>
  </aside></>;
}
function DashboardFilterSidebar({ unit, setUnit, filters, setFilters, throughLatest, setThroughLatest, today, defaultFrom, options }: { unit: TradeStatsUnit; setUnit: (value: TradeStatsUnit) => void; filters: Filters; setFilters: (next: Filters) => void; throughLatest: boolean; setThroughLatest: (value: boolean) => void; today: string; defaultFrom?: string; options: NonNullable<TradeStatsResponse['filterOptions']> }) {
  const [open, setOpen] = useFilterPanelVisibility();
  const skipFirstWrite = useRef(true), initialFrom = useRef(defaultFrom);
  useEffect(() => {
    if (skipFirstWrite.current) { skipFirstWrite.current = false; return; }
    writeCachedControls({ unit, filters: { ...filters, to: throughLatest ? today : filters.to }, throughLatest });
  }, [filters, throughLatest, today, unit]);
  useEffect(() => {
    const cached = readCachedControls(today); if (!cached) return;
    setUnit(cached.unit); setThroughLatest(cached.throughLatest); setFilters(cached.filters ?? {});
  }, []);
  const selectUnit = (next: TradeStatsUnit) => {
    setUnit(next);
    if (next === 'campaign') {
      const { exitReasons: _exitReasons, baseTimeframes: _baseTimeframes, bollingerSetups: _bollingerSetups, evaluations: _evaluations, violations: _violations, ...campaignFilters } = filters;
      setFilters({ ...campaignFilters, groupDimensions: campaignFilters.groupDimensions?.filter((dimension) => !entryOnlyDimensions.has(dimension)) });
    }
  };
  const reset = () => {
    localStorage.removeItem(STATS_CONTROLS_KEY);
    setUnit('campaign'); setThroughLatest(true); setFilters({ from: initialFrom.current, to: today });
  };
  const visibleDimensions = dimensions.filter(([dimension]) => unit === 'trade' || !entryOnlyDimensions.has(dimension));
  const valuesFor = (dimension: TradeStatsDimension) => [...(options[dimension] ?? [])].sort((left, right) => dimension === 'entryWeekday' ? weekdayOrder.indexOf(left.key) - weekdayOrder.indexOf(right.key) : left.label.localeCompare(right.label, 'ko'));
  const toggle = (dimension: TradeStatsDimension, key: string) => {
    const filterKey = predicateFilter[dimension], selected = (filters[filterKey] as string[] | undefined) ?? [];
    const nextSelected = selected.includes(key) ? selected.filter((value) => value !== key) : [...selected, key];
    const grouped = filters.groupDimensions?.includes(dimension) ?? false;
    setFilters({
      ...filters,
      [filterKey]: nextSelected.length ? nextSelected as never : undefined,
      groupDimensions: nextSelected.length
        ? grouped ? filters.groupDimensions : [...(filters.groupDimensions ?? []), dimension]
        : filters.groupDimensions?.filter((value) => value !== dimension),
    });
  };
  const toggleAll = (dimension: TradeStatsDimension) => {
    const filterKey = predicateFilter[dimension], values = valuesFor(dimension).map(({ key }) => key);
    const grouped = filters.groupDimensions?.includes(dimension) ?? false;
    setFilters({
      ...filters,
      groupDimensions: grouped ? filters.groupDimensions?.filter((value) => value !== dimension) : [...(filters.groupDimensions ?? []), dimension],
      [filterKey]: grouped ? undefined : values as never,
    });
  };
  return <aside className={`dashboard-filter-sidebar${open ? ' is-open' : ''}`} aria-label="대시보드 공통 필터">
    <div className="dashboard-filter-rail">
      <div className="stats-unit dashboard-unit"><button type="button" className={unit === 'campaign' ? 'active' : ''} onClick={() => selectUnit('campaign')}>매매</button><button type="button" className={unit === 'trade' ? 'active' : ''} onClick={() => selectUnit('trade')}>진입</button></div>
      <button type="button" className="secondary-button" onClick={() => setFilters({ ...filters })}>다시 계산</button>
      <button type="button" className="secondary-button" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? '필터 닫기' : '필터 열기'}</button>
      <button type="button" className="secondary-button" onClick={reset}>필터 초기화</button>
    </div>
    {open ? <div className="dashboard-filter-expanded">
      <header><strong>필터 설정</strong><span>대시보드 전체에 적용됩니다.</span></header>
      <section className="dashboard-filter-dates">
        <label className="filter-category-master"><input type="checkbox" checked={Boolean(filters.from || filters.to)} onChange={(event) => setFilters({ ...filters, from: event.target.checked ? filters.from ?? initialFrom.current ?? today : undefined, to: event.target.checked ? filters.to ?? today : undefined })} />기간</label>
        <div><input aria-label="시작일" type="date" value={filters.from ?? ''} onChange={(event) => setFilters({ ...filters, from: event.target.value || undefined })} /><span>~</span><input aria-label="종료일" type="date" disabled={throughLatest} value={filters.to ?? today} onChange={(event) => setFilters({ ...filters, to: event.target.value || undefined })} /></div>
        <label className="stats-through-latest">오늘까지<input type="checkbox" checked={throughLatest} onChange={(event) => { const checked = event.target.checked; setThroughLatest(checked); setFilters({ ...filters, to: checked ? today : filters.to ?? today }); }} /></label>
      </section>
      <div className="dashboard-filter-criteria">{visibleDimensions.map(([dimension, label]) => {
        const values = valuesFor(dimension); if (!values.length) return null;
        const selected = (filters[predicateFilter[dimension]] as string[] | undefined) ?? [], grouped = filters.groupDimensions?.includes(dimension) ?? false;
        return <fieldset key={dimension}><legend><label className="filter-category-master"><input type="checkbox" checked={grouped} onChange={() => toggleAll(dimension)} />{label}</label></legend><div>{values.map((option) => <label key={option.key}><input type="checkbox" checked={selected.includes(option.key)} onChange={() => toggle(dimension, option.key)} /><span>{dimension === 'session' ? sessionLabels[option.key] ?? option.label : option.label}</span></label>)}</div></fieldset>;
      })}</div>
    </div> : null}
  </aside>;
}
function DistributionBars({ distribution, label }: { distribution: ExcursionDistribution; label: string }) {
  const bins = distribution.bins;
  const maxCount = Math.max(1, ...bins.map((bin) => bin.count));
  const binDescription = bins.map((bin) => `${format(bin.min)}에서 ${format(bin.max)}까지 ${bin.count}건`).join(', ');
  return <div className="excursion-distribution-bars" role="img" aria-label={`${label} 분포. 표본 ${distribution.sampleCount}건, 중앙값 ${format(distribution.median)}. ${binDescription}`}>
    {bins.map((bin, index) => <span aria-hidden="true" key={`${bin.min}:${bin.max}:${index}`} style={{ height: `${Math.max(8, bin.count / maxCount * 100)}%` }} title={`${format(bin.min)}~${format(bin.max)}: ${bin.count}건`} />)}
  </div>;
}
const captureBandLabels: Record<ExcursionCaptureBandKey, string> = {
  opportunity_loss: '기회 후 손실',
  under_25: '25% 미만',
  '25_50': '25~50%',
  '50_75': '50~75%',
  '75_100': '75~100%',
  '100_plus': '100% 이상',
};
function Diagnostics({ diagnostics, excursions }: { diagnostics: TradeStatsResponse['diagnostics']; excursions?: TradeStatsResponse['excursions'] }) {
  const entries = [['시드 잔고', diagnostics.missingSeedCount, diagnostics.missingSeedIds], ['lot', diagnostics.missingLotsCount, diagnostics.missingLotsIds]] as const;
  const families = excursions?.families ?? [];
  const pnlFamily = families.find((family) => 'unrealizedPnl' in family);
  const headlineFamilies = excursions?.unit === 'campaign' ? families.filter((family) => family.family === 'campaign_unrealized_pnl') : families;
  const status = headlineFamilies.reduce((sum, family) => ({ success: sum.success + family.status.success, stale: sum.stale + family.status.stale, failed: sum.failed + family.status.failed, unsupported: sum.unsupported + family.status.unsupported, missing: sum.missing + family.status.missing }), { success: 0, stale: 0, failed: 0, unsupported: 0, missing: 0 });
  const opportunity = pnlFamily && 'unrealizedPnl' in pnlFamily ? pnlFamily.unrealizedPnl.mfe : undefined;
  const risk = pnlFamily && 'unrealizedPnl' in pnlFamily ? pnlFamily.unrealizedPnl.mae : undefined;
  const management = pnlFamily && 'management' in pnlFamily ? pnlFamily.management : undefined;
  const money = (value?: number) => `${format(value)}${management?.accountCurrency ? ` ${management.accountCurrency}` : ''}`;
  return <><section className="excursion-summary" aria-label="시장 진행 분석 요약">
    <header><div><h2>시장 진행 분석</h2><p>보유 중 있었던 최대 수익 기회와 손실 위험, 실제 청산 효율을 요약합니다.</p></div><span>계산 완료 {status.success} / {status.success + status.stale + status.failed + status.unsupported + status.missing}</span></header>
    <div className="excursion-card-grid">
      <article><span>최대 수익 기회 중앙값</span><strong className="is-positive">{money(opportunity?.median)}</strong><small>계산 완료 표본 {opportunity?.sampleCount ?? 0}건</small></article>
      <article><span>최대 손실 위험 중앙값</span><strong className="is-negative">{money(risk?.median)}</strong><small>계산 완료 표본 {risk?.sampleCount ?? 0}건</small></article>
      <article><span>수익 거래 실현률 중앙값</span><strong>{format(management?.profitableCapture.distribution.median, '%')}</strong><small>수익 거래 {management?.profitableCapture.eligibleCount ?? 0}건만 집계</small></article>
    </div>
    {management ? <div className="excursion-quality-grid" aria-label="청산 및 경로 품질">
      <article><strong>{management.opportunityReversal.count}건 · {format(management.opportunityReversal.rate, '%')}</strong><span>수익 기회 후 손실 전환</span><small>수익 기회가 있었지만 손실 또는 본전으로 종료</small></article>
      <article><strong>{management.profitableCapture.belowFiftyCount}건 · {format(management.profitableCapture.belowFiftyRate, '%')}</strong><span>낮은 수익 실현률</span><small>수익 거래 중 최대 기회의 50% 미만 실현</small></article>
      <article><strong>{management.riskDominant.count}건 · {format(management.riskDominant.rate, '%')}</strong><span>손실 위험 우세</span><small>최대 손실 위험이 최대 수익 기회보다 큼</small></article>
    </div> : null}
    {opportunity && risk ? <section className="excursion-distribution" aria-label="최대 수익 기회와 최대 손실 위험 분포">
      <header><div><span>최대 손실 위험</span><strong>{money(risk.median)}</strong></div><b>0</b><div><span>최대 수익 기회</span><strong>{money(opportunity.median)}</strong></div></header>
      <div className="excursion-mirrored-bars"><DistributionBars distribution={risk} label="최대 손실 위험" /><i aria-hidden="true" /><DistributionBars distribution={opportunity} label="최대 수익 기회" /></div>
      <p>굵은 값은 중앙값이며 막대는 각 손익 구간의 표본 수를 나타냅니다.</p>
    </section> : null}
    {management ? <section className="excursion-capture-bands" aria-label="수익 실현률 구간"><h3>수익 실현률 구간</h3><div>{management.profitableCapture.bands.map((band) => <article key={band.key}><strong>{band.count}</strong><span>{captureBandLabels[band.key]}</span></article>)}</div><p>손실 전환은 별도 집계하고, 나머지 구간은 수익 거래만 포함합니다.</p></section> : null}
    <details><summary>데이터 품질 및 기술 통계</summary><p>재계산 필요 {status.stale} · 자동 계산 중단 {status.failed} · 계산 불가 {status.unsupported} · 아직 없음 {status.missing}</p>{status.failed > 0 ? <p className="muted">거래 기록에는 영향이 없으며, 시장 진행 분석 계산만 중단된 상태입니다.</p> : null}{families.map((family) => <div className="excursion-diagnostic-family" key={family.family}><h3>{family.family === 'trade' ? '분할 진입' : family.family === 'campaign_price' ? '매매 전체 가격' : '매매 전체 평가손익'}</h3>{'price' in family ? <p>가격 최대 유리 변동 평균 {format(family.price.mfe.mean)} · 최대 불리 변동 평균 {format(family.price.mae.mean)} · 표본 {family.price.mfe.sampleCount}</p> : null}{'unrealizedPnl' in family ? <p>평가손익 최대 수익 평균 {format(family.unrealizedPnl.mfe.mean)} · 최대 손실 평균 {format(family.unrealizedPnl.mae.mean)} · 표본 {family.unrealizedPnl.mfe.sampleCount}</p> : null}</div>)}</details>
  </section>{entries.filter(([, count]) => count > 0).map(([label, count, ids]) => <p key={label} className="error-banner" role="alert">{label} 누락/주의 {count}건: {ids.join(', ')}</p>)}</>;
}
function Series({ series, granularity, setGranularity, unit }: { series: TradeStatsResponse['timeSeries']; granularity: TradeStatsGranularity; setGranularity: (value: TradeStatsGranularity) => void; unit: TradeStatsUnit }) {
  const [chartType, setChartType] = useState<'equity' | 'winRate' | 'oneLotPnl'>('equity');
  const [spacing, setSpacing] = useState<'time' | 'uniform'>('time');
  const active = series[granularity];
  const unitLabel = unit === 'campaign' ? '매매' : '진입';
  const labels = granularities.map(([value, label]) => [value, value === 'sequence' ? unitLabel : label] as const);
  const chartTypes = [
    ['equity', '누적 실현 PnL', (point: TradeStatsResponse['timeSeries'][TradeStatsGranularity]['points'][number]) => point.equity, false],
    ['winRate', '승률', (point: TradeStatsResponse['timeSeries'][TradeStatsGranularity]['points'][number]) => point.winRate ?? 0, true],
    ['oneLotPnl', '총 먹은 포인트', (point: TradeStatsResponse['timeSeries'][TradeStatsGranularity]['points'][number]) => point.oneLotPnl, false],
  ] as const;
  const selectedChart = chartTypes.find(([type]) => type === chartType)!;
  const note = granularity === 'sequence'
    ? `${spacing === 'time' ? '실제 청산 시간 간격' : '균등 간격'} · ${unitLabel}당 평균 ${format(active.activeBucketAverage)}`
    : `활성 기간 평균 ${format(active.activeBucketAverage)} · 달력 기간 평균 ${format(active.calendarBucketAverage)}. 진행 중인 현재 ${labels.find(([value]) => value === granularity)?.[1]} 기간은 완료 기간과 다를 수 있습니다.`;
  return <section id="dashboard-charts" className="stats-series dashboard-section">
    <header>
      <div className="stats-unit" role="tablist" aria-label="시계열 단위">{labels.map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={granularity === value} className={granularity === value ? 'active' : ''} onClick={() => setGranularity(value)}>{label}</button>)}</div>
      <div className="stats-unit" role="tablist" aria-label="차트 유형">{chartTypes.map(([type, label]) => <button key={type} id={`chart-type-${type}`} type="button" role="tab" aria-selected={chartType === type} className={chartType === type ? 'active' : ''} onClick={() => setChartType(type)}>{label}</button>)}</div>
      {granularity === 'sequence' ? <div className="stats-unit stats-chart-spacing" role="tablist" aria-label="차트 간격"><button type="button" role="tab" aria-selected={spacing === 'time'} className={spacing === 'time' ? 'active' : ''} onClick={() => setSpacing('time')}>실제 시간 간격</button><button type="button" role="tab" aria-selected={spacing === 'uniform'} className={spacing === 'uniform' ? 'active' : ''} onClick={() => setSpacing('uniform')}>균등 간격</button></div> : null}
    </header>
    <p className="stats-note">{note}</p>
    {active.points.length ? <section className="stats-chart-panel" role="tabpanel" aria-labelledby={`chart-type-${chartType}`}><h3>{selectedChart[1]}</h3>{chartType === 'oneLotPnl' ? <p className="stats-chart-description">각 진입의 실현 PnL ÷ Lot을 더한 누적값입니다.</p> : null}<StatsLineChart points={active.points} value={selectedChart[2]} label="성과 추이" percent={selectedChart[3]} spacing={granularity === 'sequence' ? spacing : 'time'} /></section> : <p className="muted">선택한 기간의 시계열이 없습니다.</p>}
  </section>;
}
export function StatsPage({ accountId, request }: StatsPageProps) { const [stats, setStats] = useState<TradeStatsResponse | null>(null); const [unit, setUnit] = useState<TradeStatsUnit>('campaign'); const [filters, setFilters] = useState<Filters>({}); const [throughLatest, setThroughLatest] = useState(true); const [granularity, setGranularity] = useState<TradeStatsGranularity>('day'); const [error, setError] = useState(''); const requestVersion = useRef(0); const initializedAccount = useRef(''); const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); const loadStats = useCallback(async () => { const version = ++requestVersion.current; setError(''); try { const next = await request<TradeStatsResponse>(`/trade-log/stats?${query(accountId, unit, filters)}`); if (version !== requestVersion.current) return; setStats(next); if (initializedAccount.current !== accountId) { initializedAccount.current = accountId; const firstTradeDate = next.drilldown.reduce<string | undefined>((first, record) => !first || record.journalDate < first ? record.journalDate : first, undefined); setThroughLatest(true); setFilters({ from: firstTradeDate ?? today }); } } catch { if (version === requestVersion.current) setError('통계를 불러올 수 없습니다.'); } }, [accountId, filters, request, today, unit]); useEffect(() => { void loadStats(); }, [loadStats]); if (!stats) return <p className="muted" role={error ? 'alert' : 'status'}>{error || '통계를 불러오는 중입니다…'}</p>; const overview = stats.overview; return <main className="stats-page"><section className="dashboard-period-section"><FilterVisibilityProvider><DashboardFilterSidebar unit={unit} setUnit={setUnit} filters={filters} setFilters={setFilters} throughLatest={throughLatest} setThroughLatest={setThroughLatest} today={today} defaultFrom={stats.drilldown.reduce((first, record) => !first || record.journalDate < first ? record.journalDate : first, undefined as string | undefined)} options={stats.filterOptions ?? {}} /></FilterVisibilityProvider></section>{error && <p className="error-banner" role="alert">{error} 이전 결과를 표시합니다.</p>}<Diagnostics diagnostics={stats.diagnostics} excursions={stats.excursions} /><section className="metric-grid" aria-label="핵심 성과 지표"><PnlHero overview={overview} /><AveragePerformance overview={overview} /></section><Series series={stats.timeSeries} granularity={granularity} setGranularity={setGranularity} unit={unit} /><IntegratedPerformanceViewer selected={filters.groupDimensions ?? []} groups={stats.performanceGroups} /><section className="advanced-metric-grid" aria-label="고급 성과 지표"><TradeQuality overview={overview} /><StreakPerformance overview={overview} /><RiskAdjustedPerformance overview={overview} /><DrawdownPerformance drawdown={stats.drawdown} /></section></main>; }
