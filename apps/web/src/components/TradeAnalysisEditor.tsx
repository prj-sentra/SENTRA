import { useEffect, useState, type FormEvent } from 'react';
import type { PatchTradeAnalysisRequest, TradeAnalysisEconomicIndicatorInput, TradeRecord } from '@trading-journal/shared';

type Draft = Omit<PatchTradeAnalysisRequest, 'expectedUpdatedAt'>;
const numeric = (value: string): number | null => value === '' ? null : Number(value);
const timeframes = ['1m', '5m', '15m', '30m', '1h', '4h', '1D', '1W', '1MN'];

function draftFor(trade: TradeRecord): Draft {
  const { createdAt: _createdAt, updatedAt: _updatedAt, schemaVersion: _schemaVersion, ...analysis } = trade.analysis;
  return {
    ...analysis,
    plannedTakeProfitPrice: trade.plannedTakeProfitPrice ?? null,
    plannedStopLossPrice: trade.plannedStopLossPrice ?? null,
    economicIndicators: analysis.economicIndicators.map(({ id, type, impact }) => ({ id, type, impact })),
  };
}

export function canonicalAnalysisPatch(draft: Draft, expectedUpdatedAt: string): PatchTradeAnalysisRequest {
  return { ...draft, marketZoneHigh: draft.marketZoneEnabled ? draft.marketZoneHigh ?? null : null, marketZoneLow: draft.marketZoneEnabled ? draft.marketZoneLow ?? null : null, chartPatternTimeframe: draft.chartPatternObserved ? draft.chartPatternTimeframe ?? null : null, chartPatternType: draft.chartPatternObserved ? draft.chartPatternType ?? null : null, retailBuyAveragePrice: draft.retailPositionEnabled ? draft.retailBuyAveragePrice ?? null : null, retailSellAveragePrice: draft.retailPositionEnabled ? draft.retailSellAveragePrice ?? null : null, retailBuyRatio: draft.retailPositionEnabled ? draft.retailBuyRatio ?? null : null, fibonacciStartPrice: draft.fibonacciEnabled ? draft.fibonacciStartPrice ?? null : null, fibonacciEndPrice: draft.fibonacciEnabled ? draft.fibonacciEndPrice ?? null : null, expectedUpdatedAt };
}

export function TradeAnalysisEditor({ trade, onSave }: { trade: TradeRecord; onSave: (tradeId: string, patch: PatchTradeAnalysisRequest) => Promise<void> }) {
  const [draft, setDraft] = useState<Draft>(() => draftFor(trade));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setDraft(draftFor(trade)), [trade.analysis.updatedAt]);
  const patch = (next: Partial<Draft>) => setDraft((current) => ({ ...current, ...next }));
  const indicators = draft.economicIndicators ?? [];
  const numberField = (label: string, key: keyof Draft) => <label><span>{label}</span><input type="number" step="any" value={(draft[key] as number | undefined) ?? ''} onChange={(event) => patch({ [key]: numeric(event.target.value) })} /></label>;
  const toggle = (label: string, key: keyof Draft) => <label className="analysis-toggle"><input type="checkbox" checked={(draft[key] as boolean | undefined) ?? false} onChange={(event) => patch({ [key]: event.target.checked })} /> {label}</label>;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (draft.marketZoneEnabled && (draft.marketZoneHigh == null || draft.marketZoneLow == null || draft.marketZoneHigh <= draft.marketZoneLow)) return setError('매물대 윗 가격은 아랫 가격보다 커야 합니다.');
    if (draft.chartPatternObserved && (!draft.chartPatternTimeframe || !draft.chartPatternType)) return setError('차트 패턴을 사용하면 기준봉과 패턴을 모두 선택해야 합니다.');
    if (draft.retailPositionEnabled && (draft.retailBuyAveragePrice == null || draft.retailSellAveragePrice == null || draft.retailBuyRatio == null || draft.retailBuyRatio < 0 || draft.retailBuyRatio > 100)) return setError('개미 포지션에는 두 평단가와 0~100의 매수 비율이 필요합니다.');
    if (draft.fibonacciEnabled && (draft.fibonacciStartPrice == null || draft.fibonacciEndPrice == null)) return setError('피보나치에는 시작 가격과 끝 가격이 필요합니다.');
    if ((draft.plannedTakeProfitPrice == null) !== (draft.plannedStopLossPrice == null)) return setError('TP와 SL 가격을 모두 입력해 주세요.');
    setError(null); setSaving(true);
    try { await onSave(trade.id, canonicalAnalysisPatch(draft, trade.analysis.updatedAt)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'TP/SL 저장에 실패했습니다.'); }
    finally { setSaving(false); }
  }

  const planMetrics = trade.riskPercent !== undefined && trade.returnPercent !== undefined && trade.rr !== undefined
    ? `Risk ${trade.riskPercent.toFixed(2)}% · Return ${trade.returnPercent.toFixed(2)}% · RR 1:${trade.rr.toFixed(2)}`
    : 'TP와 SL을 저장하면 Risk, Return, RR이 계산됩니다.';

  return <form className="detail-editor analysis-editor" onSubmit={(event) => void submit(event)}><h4>매매 분석</h4>{error ? <p className="error" role="alert">{error}</p> : null}<fieldset><legend>목표 가격</legend><div className="analysis-fields">{numberField('TP 가격', 'plannedTakeProfitPrice')}{numberField('SL 가격', 'plannedStopLossPrice')}</div><p className="analysis-plan-metrics">{planMetrics}</p></fieldset><div className="analysis-editor-columns"><section className="analysis-editor-memo"><label><span>통합 매매 노트</span><textarea rows={10} value={draft.note ?? ''} placeholder={'진입 근거:\n청산 근거:\nTP 설정 근거:\nSL 설정 근거:'} onChange={(event) => patch({ note: event.target.value || null })} /></label><label><span>아쉬운 점</span><textarea rows={5} value={draft.regret ?? ''} onChange={(event) => patch({ regret: event.target.value || null })} /></label></section><section className="analysis-editor-groups"><fieldset><legend>추세</legend><div className="analysis-fields"><label><span>기준봉</span><select value={draft.baseTimeframe ?? ''} onChange={(event) => patch({ baseTimeframe: event.target.value || null })}><option value="">선택</option>{timeframes.map((value) => <option key={value}>{value}</option>)}</select></label><label><span>추세</span><select value={draft.primaryTrend ?? ''} onChange={(event) => patch({ primaryTrend: (event.target.value || null) as Draft['primaryTrend'] })}><option value="">선택</option><option value="up">상승</option><option value="sideways">횡보</option><option value="down">하락</option></select></label></div></fieldset><fieldset><legend>기술적 분석</legend><div className="analysis-fields"><label><span>볼린저밴드 터치</span><select value={draft.bollingerBandCount ?? ''} onChange={(event) => patch({ bollingerBandCount: (event.target.value || null) as Draft['bollingerBandCount'] })}><option value="">터치 안함</option><option value="one_band">원볼</option><option value="two_band">투볼</option></select></label><label><span>볼린저밴드 추세</span><select value={draft.bollingerDirection ?? ''} disabled={!draft.bollingerBandCount} onChange={(event) => patch({ bollingerDirection: (event.target.value || null) as Draft['bollingerDirection'] })}><option value="">선택</option><option value="normal">정볼</option><option value="reverse">역볼</option><option value="chase">추볼</option></select></label><label><span>이동평균선 배열</span><select value={draft.maArrangement ?? ''} onChange={(event) => patch({ maArrangement: (event.target.value || null) as Draft['maArrangement'] })}><option value="">선택</option><option value="bullish">정배열</option><option value="bearish">역배열</option><option value="congested">혼합</option></select></label><label><span>이동평균선 크로스</span><select value={draft.cross ?? ''} onChange={(event) => patch({ cross: (event.target.value || null) as Draft['cross'] })}><option value="">선택</option><option value="none">크로스 없음</option><option value="golden_20_60">20-60 골든크로스</option><option value="golden_20_120">20-120 골든크로스</option><option value="dead_20_60">20-60 데드크로스</option><option value="dead_20_120">20-120 데드크로스</option></select></label>{numberField('손절 기준 가격', 'stopLossLine')}{toggle('차트 패턴 사용', 'chartPatternObserved')}{draft.chartPatternObserved ? <><label><span>패턴 기준봉</span><input value={draft.chartPatternTimeframe ?? ''} onChange={(event) => patch({ chartPatternTimeframe: event.target.value || null })} /></label><label><span>차트 패턴</span><select value={draft.chartPatternType ?? ''} onChange={(event) => patch({ chartPatternType: (event.target.value || null) as Draft['chartPatternType'] })}><option value="">선택</option><option value="double_top">더블탑</option><option value="double_bottom">더블바텀</option><option value="head_shoulders">헤드앤숄더</option><option value="inverse_head_shoulders">역헤드앤숄더</option></select></label></> : null}</div></fieldset><fieldset><legend>시장</legend><div className="analysis-fields">{toggle('매물대 사용', 'marketZoneEnabled')}{draft.marketZoneEnabled ? <>{numberField('매물대 윗 가격', 'marketZoneHigh')}{numberField('매물대 아랫 가격', 'marketZoneLow')}</> : null}{toggle('개미 포지션 사용', 'retailPositionEnabled')}{draft.retailPositionEnabled ? <>{numberField('매수 평단가', 'retailBuyAveragePrice')}{numberField('매도 평단가', 'retailSellAveragePrice')}{numberField('매수 비율 (%)', 'retailBuyRatio')}</> : null}{toggle('정추세 피보나치 사용', 'fibonacciEnabled')}{draft.fibonacciEnabled ? <>{numberField('시작 가격', 'fibonacciStartPrice')}{numberField('끝 가격', 'fibonacciEndPrice')}</> : null}</div></fieldset><fieldset><legend>경제지표</legend><div className="analysis-fields">{indicators.map((indicator, index) => <div className="indicator-row" key={indicator.id ?? index}><input aria-label={`경제지표 ${index + 1} 이름`} value={indicator.type} onChange={(event) => { const next = [...indicators]; next[index] = { ...indicator, type: event.target.value }; patch({ economicIndicators: next }); }} /><select aria-label={`경제지표 ${index + 1} 결과`} value={indicator.impact} onChange={(event) => { const next = [...indicators]; next[index] = { ...indicator, impact: event.target.value as TradeAnalysisEconomicIndicatorInput['impact'] }; patch({ economicIndicators: next }); }}><option value="positive">호재</option><option value="negative">악재</option></select><button type="button" onClick={() => patch({ economicIndicators: indicators.filter((_, item) => item !== index) })}>삭제</button></div>)}<button type="button" onClick={() => patch({ economicIndicators: [...indicators, { type: '', impact: 'positive' }] })}>경제지표 추가</button></div></fieldset></section></div><button type="submit" disabled={saving}>{saving ? '저장 중…' : '분석 저장'}</button></form>;
}
