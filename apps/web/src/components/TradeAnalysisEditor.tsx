import { forwardRef, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { PatchTradeAnalysisRequest, PatchTradeCampaignAnalysisRequest, TradeAnalysisEconomicIndicatorInput, TradeAnalysisMaReading, TradeCampaign, TradeRecord } from '@trading-journal/shared';

type Draft = Omit<PatchTradeAnalysisRequest, 'expectedUpdatedAt'> & Omit<PatchTradeCampaignAnalysisRequest, 'expectedUpdatedAt'>;
const numeric = (value: string): number | null => value === '' ? null : Number(value);
const datetimeLocal = (value?: string | null): string => {
  if (!value) return '';
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};
const timeframes = ['1m', '5m', '15m', '30m', '1h', '4h', '1D', '1W', '1MN'];
const maTimeframes = ['15m', '30m', '1h', '4h', '1D', '1W', '1MN'] as const;
const defaultMaTimeframes = () => Object.fromEntries(maTimeframes.map((timeframe) => [timeframe, { arrangement: 'congested' as const, cross20_60: 'none' as const, cross20_120: 'none' as const }]));

function draftFor(trade: TradeRecord): Draft {
  return {
    baseTimeframe: trade.analysis.baseTimeframe ?? null,
    bollingerBandCount: trade.analysis.bollingerBandCount ?? null,
    bollingerDirection: trade.analysis.bollingerDirection ?? null,
    executionEvaluation: trade.analysis.executionEvaluation ?? null,
    unplannedAdditionalEntry: trade.analysis.unplannedAdditionalEntry,
    excessiveSize: trade.analysis.excessiveSize,
    stopLossViolation: trade.analysis.stopLossViolation,
    earlyExit: trade.analysis.earlyExit,
    lateExit: trade.analysis.lateExit,
    otherViolation: trade.analysis.otherViolation ?? null,
    plannedTakeProfitPrice: trade.plannedTakeProfitPrice ?? null,
    plannedStopLossPrice: trade.plannedStopLossPrice ?? null,
  };
}

function draftForCampaign(campaign: TradeCampaign): Draft {
  const { createdAt: _createdAt, updatedAt: _updatedAt, schemaVersion: _schemaVersion, ...analysis } = campaign.analysis;
  return {
    ...analysis,
    maTimeframes: Object.fromEntries(maTimeframes.map((timeframe) => [timeframe, { arrangement: 'congested', cross20_60: 'none', cross20_120: 'none', ...analysis.maTimeframes[timeframe] }])) as Draft['maTimeframes'],
    economicIndicators: analysis.economicIndicators.map(({ id, type, impact, announcedAt }) => ({ id, type, impact, announcedAt })),
  };
}

export function canonicalAnalysisPatch(draft: Draft, expectedUpdatedAt: string): PatchTradeAnalysisRequest {
  return {
    expectedUpdatedAt,
    baseTimeframe: draft.baseTimeframe ?? null,
    bollingerBandCount: draft.bollingerBandCount ?? null,
    bollingerDirection: draft.bollingerDirection ?? null,
    executionEvaluation: draft.executionEvaluation ?? null,
    unplannedAdditionalEntry: draft.executionEvaluation === 'plan_violated' ? draft.unplannedAdditionalEntry ?? false : false,
    excessiveSize: draft.executionEvaluation === 'plan_violated' ? draft.excessiveSize ?? false : false,
    stopLossViolation: draft.executionEvaluation === 'plan_violated' ? draft.stopLossViolation ?? false : false,
    earlyExit: draft.executionEvaluation === 'plan_violated' ? draft.earlyExit ?? false : false,
    lateExit: draft.executionEvaluation === 'plan_violated' ? draft.lateExit ?? false : false,
    otherViolation: draft.executionEvaluation === 'plan_violated' ? draft.otherViolation?.trim() || null : null,
    plannedTakeProfitPrice: draft.plannedTakeProfitPrice ?? null,
    plannedStopLossPrice: draft.plannedStopLossPrice ?? null,
  };
}

export function canonicalCampaignAnalysisPatch(draft: Draft, expectedUpdatedAt: string): PatchTradeCampaignAnalysisRequest {
  return {
    expectedUpdatedAt,
    primaryTrend: draft.primaryTrend ?? null,
    maTimeframes: draft.maTimeframes ?? {},
    marketZoneEnabled: draft.marketZoneEnabled ?? false,
    marketZoneHigh: draft.marketZoneEnabled ? draft.marketZoneHigh ?? null : null,
    marketZoneLow: draft.marketZoneEnabled ? draft.marketZoneLow ?? null : null,
    retailPositionEnabled: draft.retailPositionEnabled ?? false,
    retailBuyAveragePrice: draft.retailPositionEnabled ? draft.retailBuyAveragePrice ?? null : null,
    retailSellAveragePrice: draft.retailPositionEnabled ? draft.retailSellAveragePrice ?? null : null,
    retailBuyRatio: draft.retailPositionEnabled ? draft.retailBuyRatio ?? null : null,
    fibonacciEnabled: draft.fibonacciEnabled ?? false,
    fibonacciStartPrice: draft.fibonacciEnabled ? draft.fibonacciStartPrice ?? null : null,
    fibonacciEndPrice: draft.fibonacciEnabled ? draft.fibonacciEndPrice ?? null : null,
    economicIndicators: draft.economicIndicators ?? [],
  };
}

const Info = ({ text }: { text: string }) => <button className="analysis-info" type="button" aria-label={text} title={text}>i</button>;
const Row = ({ title, help, className, children }: { title: string; help: string; className?: string; children: ReactNode }) => <fieldset className={`analysis-row${className ? ` ${className}` : ''}`}><legend>{title} <Info text={help} /></legend><div className="analysis-fields">{children}</div></fieldset>;

export const TradeAnalysisEditor = forwardRef<HTMLFormElement, { trade: TradeRecord; campaign?: TradeCampaign; scope?: 'execution' | 'campaign'; onSave: (tradeId: string, patch: PatchTradeAnalysisRequest) => Promise<void>; onSaveCampaign?: (campaignId: string, patch: PatchTradeCampaignAnalysisRequest) => Promise<void> }>(({ trade, campaign, scope = 'execution', onSave, onSaveCampaign }, ref) => {
  if (scope === 'campaign' && !campaign) throw new Error('Campaign analysis editor requires a campaign');
  const makeDraft = () => scope === 'campaign' ? draftForCampaign(campaign!) : draftFor(trade);
  const sourceUpdatedAt = scope === 'campaign' ? campaign!.analysis.updatedAt : trade.analysis.updatedAt;
  const [draft, setDraft] = useState<Draft>(makeDraft);
  const [, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setDraft(makeDraft()), [sourceUpdatedAt]);
  const patch = (next: Partial<Draft>) => setDraft((current) => ({ ...current, ...next }));
  const indicators = draft.economicIndicators ?? [];
  const numberField = (label: string, key: keyof Draft, disabled = false) => <label><span>{label}</span><input type="number" step="any" disabled={disabled} value={(draft[key] as number | undefined) ?? ''} onChange={(event) => patch({ [key]: numeric(event.target.value) })} /></label>;
  const toggle = (label: string, key: keyof Draft) => <label className="analysis-toggle"><input type="checkbox" checked={(draft[key] as boolean | undefined) ?? false} onChange={(event) => patch({ [key]: event.target.checked })} /> {label}</label>;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (scope === 'campaign' && draft.marketZoneEnabled && (draft.marketZoneHigh == null || draft.marketZoneLow == null || draft.marketZoneHigh <= draft.marketZoneLow)) return setError('매물대 윗 가격은 아랫 가격보다 커야 합니다.');
    if (scope === 'campaign' && draft.retailPositionEnabled && (draft.retailBuyAveragePrice == null || draft.retailSellAveragePrice == null || draft.retailBuyRatio == null || draft.retailBuyRatio < 0 || draft.retailBuyRatio > 100)) return setError('개미 포지션에는 두 평단가와 0~100의 매수 비율이 필요합니다.');
    if (scope === 'campaign' && draft.fibonacciEnabled && (draft.fibonacciStartPrice == null || draft.fibonacciEndPrice == null)) return setError('피보나치에는 시작 가격과 끝 가격이 필요합니다.');
    if (scope === 'execution' && (draft.plannedTakeProfitPrice == null) !== (draft.plannedStopLossPrice == null)) return setError('TP와 SL 가격을 모두 입력해 주세요.');
    setError(null); setSaving(true);
    try {
      if (scope === 'campaign') {
        if (!onSaveCampaign) throw new Error('Campaign analysis save handler is missing');
        await onSaveCampaign(campaign!.id, canonicalCampaignAnalysisPatch(draft, sourceUpdatedAt));
      } else {
        await onSave(trade.id, canonicalAnalysisPatch(draft, sourceUpdatedAt));
      }
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : '분석 저장에 실패했습니다.'); }
    finally { setSaving(false); }
  }

  const returnMetric = trade.returnPercent === undefined ? '—' : `${trade.returnPercent.toFixed(2)}%`;
  const riskMetric = trade.riskPercent === undefined ? '—' : `${trade.riskPercent.toFixed(2)}%`;
  const rrMetric = trade.rr === undefined ? '—' : `1:${trade.rr.toFixed(2)}`;
  return <form ref={ref} className="detail-editor analysis-editor" onSubmit={(event) => void submit(event)} onReset={() => { setDraft(makeDraft()); setError(null); }}>
    {error ? <p className="error" role="alert">{error}</p> : null}
    {scope === 'execution' ? <>
      <Row className="target-price-row" title="목표 가격" help="이 실행에서 계획한 익절가(TP)와 손절가(SL)를 입력합니다.">
        <div className="target-price-inputs">{numberField('TP 가격', 'plannedTakeProfitPrice')}{numberField('SL 가격', 'plannedStopLossPrice')}</div>
        <div className="target-price-percentages"><label><span>Return 비율</span><output className="calculated-value">{returnMetric}</output></label><label><span>Risk 비율</span><output className="calculated-value">{riskMetric}</output></label></div>
        <label className="target-price-rr"><span>RR</span><output className="calculated-value">{rrMetric}</output></label>
      </Row>
      <Row className="full-width-select-row" title="기준봉" help="이 실행을 판단한 기준 시간 프레임을 기록합니다."><label><span>기준봉 선택</span><select value={draft.baseTimeframe ?? ''} onChange={(e) => patch({ baseTimeframe: e.target.value || null })}><option value="">선택</option>{timeframes.map((value) => <option key={value}>{value}</option>)}</select></label></Row>
      <Row title="볼린저밴드" help="이 실행의 볼린저밴드 터치 및 방향을 기록합니다."><label><span>볼린저밴드 터치</span><select value={draft.bollingerBandCount ?? ''} onChange={(e) => patch({ bollingerBandCount: (e.target.value || null) as Draft['bollingerBandCount'] })}><option value="">터치 안함</option><option value="one_band">원볼</option><option value="two_band">투볼</option></select></label><label><span>볼린저밴드 추세</span><select value={draft.bollingerDirection ?? ''} disabled={!draft.bollingerBandCount} onChange={(e) => patch({ bollingerDirection: (e.target.value || null) as Draft['bollingerDirection'] })}><option value="">선택</option><option value="normal">정볼</option><option value="reverse">역볼</option><option value="chase">추볼</option></select></label></Row>
      <Row className="execution-evaluation-row" title="실행 평가" help="이 매매가 사전에 세운 계획대로 실행되었는지 평가합니다.">
        <label><span>평가</span><select value={draft.executionEvaluation ?? ''} onChange={(event) => patch({ executionEvaluation: (event.target.value || null) as Draft['executionEvaluation'] })}><option value="">미평가</option><option value="as_planned">계획대로</option><option value="plan_violated">계획 위반</option></select></label>
        {draft.executionEvaluation === 'plan_violated' ? <div className="execution-violation-fields">
          {toggle('계획 외 추가 진입', 'unplannedAdditionalEntry')}
          {toggle('과도한 수량', 'excessiveSize')}
          {toggle('손절 계획 위반', 'stopLossViolation')}
          {toggle('조기 청산', 'earlyExit')}
          {toggle('늦은 청산', 'lateExit')}
          <label><span>기타</span><textarea value={draft.otherViolation ?? ''} onChange={(event) => patch({ otherViolation: event.target.value || null })} placeholder="그 밖의 계획 위반 내용을 입력하세요." /></label>
        </div> : null}
      </Row>
    </> : <>
      <Row className="full-width-select-row" title="추세" help="거래 전체의 주 추세 방향과 횡보 전환 여부를 기록합니다."><label><span>추세 선택</span><select value={draft.primaryTrend ?? ''} onChange={(e) => patch({ primaryTrend: (e.target.value || null) as Draft['primaryTrend'] })}><option value="">선택</option><option value="up">상승</option><option value="up_sideways">상승 후 횡보</option><option value="down">하락</option><option value="down_sideways">하락 후 횡보</option></select></label></Row>
      <Row className="ma-timeframe-row" title="이동평균선 & 차트 패턴" help="각 시간 프레임의 이동평균선 배열, 크로스와 차트 패턴을 함께 기록합니다.">
        <div className="ma-timeframe-heading" aria-hidden="true"><span>기준봉</span><span>배열</span><span>20-60 크로스</span><span>20-120 크로스</span><span>차트 패턴</span></div>
        {maTimeframes.map((timeframe) => {
          const reading: TradeAnalysisMaReading = draft.maTimeframes?.[timeframe] ?? defaultMaTimeframes()[timeframe]!;
          const update = (next: typeof reading) => patch({ maTimeframes: { ...draft.maTimeframes, [timeframe]: next } });
          return <div className="ma-timeframe-reading" key={timeframe}><strong>{timeframe}</strong><label><span className="sr-only">{timeframe} 배열</span><select aria-label={`${timeframe} 이동평균선 배열`} value={reading.arrangement ?? 'congested'} onChange={(event) => update({ ...reading, arrangement: event.target.value as typeof reading.arrangement })}><option value="bullish">정배열</option><option value="bearish">역배열</option><option value="congested">혼합</option></select></label><label><span className="sr-only">{timeframe} 20-60 크로스</span><select aria-label={`${timeframe} 20-60 이동평균선 크로스`} value={reading.cross20_60 ?? 'none'} onChange={(event) => update({ ...reading, cross20_60: event.target.value as typeof reading.cross20_60 })}><option value="none">없음</option><option value="golden">골든크로스</option><option value="dead">데드크로스</option></select></label><label><span className="sr-only">{timeframe} 20-120 크로스</span><select aria-label={`${timeframe} 20-120 이동평균선 크로스`} value={reading.cross20_120 ?? 'none'} onChange={(event) => update({ ...reading, cross20_120: event.target.value as typeof reading.cross20_120 })}><option value="none">없음</option><option value="golden">골든크로스</option><option value="dead">데드크로스</option></select></label><label><span className="sr-only">{timeframe} 차트 패턴</span><select aria-label={`${timeframe} 차트 패턴`} value={reading.chartPattern ?? ''} onChange={(event) => update({ ...reading, chartPattern: (event.target.value || undefined) as typeof reading.chartPattern })}><option value="">없음</option><option value="double_top">더블탑</option><option value="double_bottom">더블바텀</option><option value="head_shoulders">헤드앤숄더</option><option value="inverse_head_shoulders">역헤드앤숄더</option></select></label></div>;
        })}
      </Row>
    <Row className="analysis-row-3-columns" title="매물대" help="진입·청산 판단에 사용한 핵심 매물대의 상단과 하단 가격 범위를 기록합니다.">{toggle('매물대 사용', 'marketZoneEnabled')}{numberField('기준 매물대 윗 가격', 'marketZoneHigh', !draft.marketZoneEnabled)}{numberField('기준 매물대 아랫 가격', 'marketZoneLow', !draft.marketZoneEnabled)}</Row>
    <Row className="analysis-row-4-columns" title="개미 포지션" help="참고한 개인 투자자 매수·매도 평균가와 전체 중 매수 포지션 비율을 기록합니다.">{toggle('개미 포지션 사용', 'retailPositionEnabled')}{numberField('매수 평단가', 'retailBuyAveragePrice', !draft.retailPositionEnabled)}{numberField('매도 평단가', 'retailSellAveragePrice', !draft.retailPositionEnabled)}{numberField('매수 비율 (%)', 'retailBuyRatio', !draft.retailPositionEnabled)}</Row>
    <Row className="analysis-row-3-columns" title="정추세 피보나치" help="주 추세 방향으로 측정한 피보나치 구간의 시작 가격과 끝 가격을 기록합니다.">{toggle('정추세 피보나치 사용', 'fibonacciEnabled')}{numberField('시작 가격', 'fibonacciStartPrice', !draft.fibonacciEnabled)}{numberField('끝 가격', 'fibonacciEndPrice', !draft.fibonacciEnabled)}</Row>
    </>}
    {scope === 'campaign' ? <Row className="economic-indicator-row" title="경제지표" help="거래 전체에 영향을 준 경제지표와 발표 시간 및 결과를 기록합니다.">
      {indicators.map((indicator, index) => <div className="indicator-row" key={indicator.id ?? index}>
        <label><span>지표 이름</span><input aria-label={`경제지표 ${index + 1} 이름`} placeholder="예: CPI, FOMC" value={indicator.type} onChange={(e) => { const next = [...indicators]; next[index] = { ...indicator, type: e.target.value }; patch({ economicIndicators: next }); }} /></label><label><span>발표 시간</span><input type="datetime-local" aria-label={`경제지표 ${index + 1} 발표 시간`} value={datetimeLocal(indicator.announcedAt)} onChange={(e) => { const next = [...indicators]; next[index] = { ...indicator, announcedAt: e.target.value ? new Date(e.target.value).toISOString() : null }; patch({ economicIndicators: next }); }} /></label>
        <label><span>영향</span><select className={`indicator-impact ${indicator.impact}`} aria-label={`경제지표 ${index + 1} 결과`} value={indicator.impact} onChange={(e) => { const next = [...indicators]; next[index] = { ...indicator, impact: e.target.value as TradeAnalysisEconomicIndicatorInput['impact'] }; patch({ economicIndicators: next }); }}><option value="positive">호재</option><option value="negative">악재</option></select></label>
        <button className="indicator-delete-button" type="button" aria-label={`경제지표 ${index + 1} 삭제`} onClick={() => {
          if (!window.confirm(`${indicator.type || `${index + 1}번째 경제지표`}를 삭제하시겠습니까?`)) return;
          patch({ economicIndicators: indicators.filter((_, item) => item !== index) });
        }}>삭제</button>
      </div>)}
      <button className="indicator-add-button" type="button" onClick={() => patch({ economicIndicators: [...indicators, { type: '', impact: 'positive' }] })}><span className="indicator-add-icon">+</span><span>경제지표 추가</span></button>
    </Row> : null}
  </form>;
});
