import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { PatchTradeAnalysisRequest, TradeAnalysisEconomicIndicatorInput, TradeRecord } from '@trading-journal/shared';

type Draft = Omit<PatchTradeAnalysisRequest, 'expectedUpdatedAt'>;
const numeric = (value: string): number | null => value === '' ? null : Number(value);
const timeframes = ['1m', '5m', '15m', '30m', '1h', '4h', '1D', '1W', '1MN'];

function draftFor(trade: TradeRecord): Draft {
  const { createdAt: _createdAt, updatedAt: _updatedAt, schemaVersion: _schemaVersion, ...analysis } = trade.analysis;
  return { ...analysis, plannedTakeProfitPrice: trade.plannedTakeProfitPrice ?? null, plannedStopLossPrice: trade.plannedStopLossPrice ?? null, economicIndicators: analysis.economicIndicators.map(({ id, type, impact }) => ({ id, type, impact })) };
}

export function canonicalAnalysisPatch(draft: Draft, expectedUpdatedAt: string): PatchTradeAnalysisRequest {
  return { ...draft, marketZoneHigh: draft.marketZoneEnabled ? draft.marketZoneHigh ?? null : null, marketZoneLow: draft.marketZoneEnabled ? draft.marketZoneLow ?? null : null, chartPatternTimeframe: draft.chartPatternObserved ? draft.chartPatternTimeframe ?? null : null, chartPatternType: draft.chartPatternObserved ? draft.chartPatternType ?? null : null, retailBuyAveragePrice: draft.retailPositionEnabled ? draft.retailBuyAveragePrice ?? null : null, retailSellAveragePrice: draft.retailPositionEnabled ? draft.retailSellAveragePrice ?? null : null, retailBuyRatio: draft.retailPositionEnabled ? draft.retailBuyRatio ?? null : null, fibonacciStartPrice: draft.fibonacciEnabled ? draft.fibonacciStartPrice ?? null : null, fibonacciEndPrice: draft.fibonacciEnabled ? draft.fibonacciEndPrice ?? null : null, expectedUpdatedAt };
}

const Info = ({ text }: { text: string }) => <button className="analysis-info" type="button" aria-label={text} title={text}>i</button>;
const Row = ({ title, help, children }: { title: string; help: string; children: ReactNode }) => <fieldset className="analysis-row"><legend>{title} <Info text={help} /></legend><div className="analysis-fields">{children}</div></fieldset>;

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
    catch (cause) { setError(cause instanceof Error ? cause.message : '분석 저장에 실패했습니다.'); }
    finally { setSaving(false); }
  }

  const planMetrics = trade.riskPercent !== undefined && trade.returnPercent !== undefined && trade.rr !== undefined ? `Risk ${trade.riskPercent.toFixed(2)}% · Return ${trade.returnPercent.toFixed(2)}% · RR 1:${trade.rr.toFixed(2)}` : 'TP와 SL을 저장하면 Risk, Return, RR이 계산됩니다.';
  return <form className="detail-editor analysis-editor" onSubmit={(event) => void submit(event)}>
    <h3>매매 분석</h3>{error ? <p className="error" role="alert">{error}</p> : null}
    <Row title="목표 가격" help="진입 시 계획한 익절가(TP)와 손절가(SL)를 입력합니다.">{numberField('TP 가격', 'plannedTakeProfitPrice')}{numberField('SL 가격', 'plannedStopLossPrice')}<p className="analysis-plan-metrics">{planMetrics}</p></Row>
    <Row title="기준봉 · 추세" help="판단 기준이 된 시간 프레임과 해당 기준봉에서 본 주 추세를 기록합니다."><label><span>기준봉</span><select value={draft.baseTimeframe ?? ''} onChange={(e) => patch({ baseTimeframe: e.target.value || null })}><option value="">선택</option>{timeframes.map((value) => <option key={value}>{value}</option>)}</select></label><label><span>추세</span><select value={draft.primaryTrend ?? ''} onChange={(e) => patch({ primaryTrend: (e.target.value || null) as Draft['primaryTrend'] })}><option value="">선택</option><option value="up">상승</option><option value="sideways">횡보</option><option value="down">하락</option></select></label></Row>
    <Row title="볼린저밴드" help="가격이 밴드를 몇 겹 터치했는지와 밴드 방향이 추세에 순응하는지 기록합니다."><label><span>볼린저밴드 터치</span><select value={draft.bollingerBandCount ?? ''} onChange={(e) => patch({ bollingerBandCount: (e.target.value || null) as Draft['bollingerBandCount'] })}><option value="">터치 안함</option><option value="one_band">원볼</option><option value="two_band">투볼</option></select></label><label><span>볼린저밴드 추세</span><select value={draft.bollingerDirection ?? ''} disabled={!draft.bollingerBandCount} onChange={(e) => patch({ bollingerDirection: (e.target.value || null) as Draft['bollingerDirection'] })}><option value="">선택</option><option value="normal">정볼</option><option value="reverse">역볼</option><option value="chase">추볼</option></select></label></Row>
    <Row title="이동평균선" help="이동평균선의 정배열·역배열·혼합 상태와 주요 평균선의 크로스를 기록합니다."><label><span>이동평균선 배열</span><select value={draft.maArrangement ?? ''} onChange={(e) => patch({ maArrangement: (e.target.value || null) as Draft['maArrangement'] })}><option value="">선택</option><option value="bullish">정배열</option><option value="bearish">역배열</option><option value="congested">혼합</option></select></label><label><span>이동평균선 크로스</span><select value={draft.cross ?? ''} onChange={(e) => patch({ cross: (e.target.value || null) as Draft['cross'] })}><option value="">선택</option><option value="none">크로스 없음</option><option value="golden_20_60">20-60 골든크로스</option><option value="golden_20_120">20-120 골든크로스</option><option value="dead_20_60">20-60 데드크로스</option><option value="dead_20_120">20-120 데드크로스</option></select></label></Row>
    <Row title="차트 패턴" help="패턴이 실제 진입 판단에 사용된 경우 켜고, 관찰 시간 프레임과 패턴 종류를 기록합니다.">{toggle('차트 패턴 사용', 'chartPatternObserved')}{draft.chartPatternObserved ? <><label><span>패턴 기준봉</span><input value={draft.chartPatternTimeframe ?? ''} onChange={(e) => patch({ chartPatternTimeframe: e.target.value || null })} /></label><label><span>차트 패턴</span><select value={draft.chartPatternType ?? ''} onChange={(e) => patch({ chartPatternType: (e.target.value || null) as Draft['chartPatternType'] })}><option value="">선택</option><option value="double_top">더블탑</option><option value="double_bottom">더블바텀</option><option value="head_shoulders">헤드앤숄더</option><option value="inverse_head_shoulders">역헤드앤숄더</option></select></label></> : null}</Row>
    <Row title="매물대" help="진입·청산 판단에 사용한 핵심 매물대의 상단과 하단 가격 범위를 기록합니다.">{toggle('매물대 사용', 'marketZoneEnabled')}{draft.marketZoneEnabled ? <>{numberField('기준 매물대 윗 가격', 'marketZoneHigh')}{numberField('기준 매물대 아랫 가격', 'marketZoneLow')}</> : null}</Row>
    <Row title="개미 포지션" help="참고한 개인 투자자 매수·매도 평균가와 전체 중 매수 포지션 비율을 기록합니다.">{toggle('개미 포지션 사용', 'retailPositionEnabled')}{draft.retailPositionEnabled ? <>{numberField('매수 평단가', 'retailBuyAveragePrice')}{numberField('매도 평단가', 'retailSellAveragePrice')}{numberField('매수 비율 (%)', 'retailBuyRatio')}</> : null}</Row>
    <Row title="정추세 피보나치" help="주 추세 방향으로 측정한 피보나치 구간의 시작 가격과 끝 가격을 기록합니다.">{toggle('정추세 피보나치 사용', 'fibonacciEnabled')}{draft.fibonacciEnabled ? <>{numberField('시작 가격', 'fibonacciStartPrice')}{numberField('끝 가격', 'fibonacciEndPrice')}</> : null}</Row>
    <Row title="경제지표" help="거래 전후 영향을 준 경제지표와 시장에 긍정적·부정적이었던 결과를 기록합니다.">{indicators.map((indicator, index) => <div className="indicator-row" key={indicator.id ?? index}><input aria-label={`경제지표 ${index + 1} 이름`} value={indicator.type} onChange={(e) => { const next = [...indicators]; next[index] = { ...indicator, type: e.target.value }; patch({ economicIndicators: next }); }} /><select aria-label={`경제지표 ${index + 1} 결과`} value={indicator.impact} onChange={(e) => { const next = [...indicators]; next[index] = { ...indicator, impact: e.target.value as TradeAnalysisEconomicIndicatorInput['impact'] }; patch({ economicIndicators: next }); }}><option value="positive">호재</option><option value="negative">악재</option></select><button type="button" onClick={() => patch({ economicIndicators: indicators.filter((_, item) => item !== index) })}>삭제</button></div>)}<button type="button" onClick={() => patch({ economicIndicators: [...indicators, { type: '', impact: 'positive' }] })}>경제지표 추가</button></Row>
    <Row title="손절 기준" help="기술적 분석에서 무효화 기준으로 사용한 손절 가격선을 기록합니다.">{numberField('손절 기준 가격', 'stopLossLine')}</Row>
    <button type="submit" disabled={saving}>{saving ? '저장 중…' : '분석 저장'}</button>
  </form>;
}
