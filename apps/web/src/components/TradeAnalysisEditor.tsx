import { useEffect, useState, type FormEvent } from 'react';
import type { PatchTradeAnalysisRequest, TradeAnalysisEconomicIndicatorInput, TradeRecord } from '@trading-journal/shared';

type Draft = Omit<PatchTradeAnalysisRequest, 'expectedUpdatedAt'>;
const numeric = (value: string): number | null => value === '' ? null : Number(value);

function draftFor(trade: TradeRecord): Draft {
  const { createdAt: _createdAt, updatedAt: _updatedAt, schemaVersion: _schemaVersion, ...analysis } = trade.analysis;
  return { ...analysis, economicIndicators: analysis.economicIndicators.map(({ id, type, impact }) => ({ id, type, impact })) };
}

export function canonicalAnalysisPatch(draft: Draft, expectedUpdatedAt: string): PatchTradeAnalysisRequest {
  return {
    ...draft,
    marketZoneHigh: draft.marketZoneEnabled ? draft.marketZoneHigh ?? null : null,
    marketZoneLow: draft.marketZoneEnabled ? draft.marketZoneLow ?? null : null,
    chartPatternTimeframe: draft.chartPatternObserved ? draft.chartPatternTimeframe ?? null : null,
    chartPatternType: draft.chartPatternObserved ? draft.chartPatternType ?? null : null,
    retailBuyAveragePrice: draft.retailPositionEnabled ? draft.retailBuyAveragePrice ?? null : null,
    retailSellAveragePrice: draft.retailPositionEnabled ? draft.retailSellAveragePrice ?? null : null,
    retailBuyRatio: draft.retailPositionEnabled ? draft.retailBuyRatio ?? null : null,
    fibonacciStartPrice: draft.fibonacciEnabled ? draft.fibonacciStartPrice ?? null : null,
    fibonacciEndPrice: draft.fibonacciEnabled ? draft.fibonacciEndPrice ?? null : null,
    expectedUpdatedAt,
  };
}

export function TradeAnalysisEditor({ trade, onSave }: { trade: TradeRecord; onSave: (tradeId: string, patch: PatchTradeAnalysisRequest) => Promise<void> }) {
  const [draft, setDraft] = useState<Draft>(() => draftFor(trade));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setDraft(draftFor(trade)), [trade.analysis.updatedAt]);
  const patch = (next: Partial<Draft>) => setDraft((current) => ({ ...current, ...next }));
  const indicators = draft.economicIndicators ?? [];

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (draft.marketZoneEnabled && (draft.marketZoneHigh == null || draft.marketZoneLow == null || draft.marketZoneHigh <= draft.marketZoneLow)) return setError('Market zone high must be greater than low.');
    if (draft.chartPatternObserved && (!draft.chartPatternTimeframe || !draft.chartPatternType)) return setError('Observed chart patterns require a timeframe and pattern.');
    if (draft.retailPositionEnabled && (draft.retailBuyAveragePrice == null || draft.retailSellAveragePrice == null || draft.retailBuyRatio == null || draft.retailBuyRatio < 0 || draft.retailBuyRatio > 100)) return setError('Retail position requires both prices and a buy ratio from 0 to 100.');
    if (draft.fibonacciEnabled && (draft.fibonacciStartPrice == null || draft.fibonacciEndPrice == null)) return setError('Fibonacci requires start and end prices.');
    setError(null); setSaving(true);
    try { await onSave(trade.id, canonicalAnalysisPatch(draft, trade.analysis.updatedAt)); }
    catch { setError('Analysis changed elsewhere. Latest values were reloaded.'); }
    finally { setSaving(false); }
  }

  const numberField = (label: string, key: keyof Draft) => <label><span>{label}</span><input type="number" step="any" value={(draft[key] as number | undefined) ?? ''} onChange={(event) => patch({ [key]: numeric(event.target.value) })} /></label>;
  return <form className="detail-editor analysis-editor" onSubmit={(event) => void submit(event)}><h4>Analysis</h4>
    {error ? <p className="error" role="alert">{error}</p> : null}
    <label><span>Base timeframe</span><input value={draft.baseTimeframe ?? ''} onChange={(event) => patch({ baseTimeframe: event.target.value || null })} /></label>
    <label><span>Primary trend</span><select value={draft.primaryTrend ?? ''} onChange={(event) => patch({ primaryTrend: (event.target.value || null) as Draft['primaryTrend'] })}><option value="">Not set</option><option value="up">Up</option><option value="sideways">Sideways</option><option value="down">Down</option></select></label>
    <label><span>Bollinger bands</span><select value={draft.bollingerBandCount ?? ''} onChange={(event) => patch({ bollingerBandCount: (event.target.value || null) as Draft['bollingerBandCount'] })}><option value="">Not set</option><option value="one_band">One band</option><option value="two_band">Two bands</option></select></label>
    <label><span>Bollinger direction</span><select value={draft.bollingerDirection ?? ''} onChange={(event) => patch({ bollingerDirection: (event.target.value || null) as Draft['bollingerDirection'] })}><option value="">Not set</option><option value="normal">Normal</option><option value="reverse">Reverse</option><option value="chase">Chase</option></select></label>
    <label><span>MA arrangement</span><select value={draft.maArrangement ?? ''} onChange={(event) => patch({ maArrangement: (event.target.value || null) as Draft['maArrangement'] })}><option value="">Not set</option><option value="bullish">Bullish</option><option value="bearish">Bearish</option><option value="congested">Congested</option></select></label>
    <label><span>Cross</span><select value={draft.cross ?? ''} onChange={(event) => patch({ cross: (event.target.value || null) as Draft['cross'] })}><option value="">Not set</option><option value="none">None</option><option value="golden_20_60">Golden 20/60</option><option value="golden_20_120">Golden 20/120</option><option value="dead_20_60">Dead 20/60</option><option value="dead_20_120">Dead 20/120</option></select></label>
    {numberField('Stop loss line', 'stopLossLine')}
    <label><input type="checkbox" checked={draft.marketZoneEnabled ?? false} onChange={(event) => patch({ marketZoneEnabled: event.target.checked })} /> Market zone</label>
    {draft.marketZoneEnabled ? <>{numberField('Market zone high', 'marketZoneHigh')}{numberField('Market zone low', 'marketZoneLow')}</> : null}
    <label><input type="checkbox" checked={draft.chartPatternObserved ?? false} onChange={(event) => patch({ chartPatternObserved: event.target.checked })} /> Chart pattern observed</label>
    {draft.chartPatternObserved ? <><label><span>Pattern timeframe</span><input value={draft.chartPatternTimeframe ?? ''} onChange={(event) => patch({ chartPatternTimeframe: event.target.value || null })} /></label><label><span>Pattern</span><select value={draft.chartPatternType ?? ''} onChange={(event) => patch({ chartPatternType: (event.target.value || null) as Draft['chartPatternType'] })}><option value="">Select</option><option value="double_top">Double top</option><option value="double_bottom">Double bottom</option><option value="head_shoulders">Head and shoulders</option><option value="inverse_head_shoulders">Inverse head and shoulders</option></select></label></> : null}
    <label><input type="checkbox" checked={draft.retailPositionEnabled ?? false} onChange={(event) => patch({ retailPositionEnabled: event.target.checked })} /> Retail position</label>
    {draft.retailPositionEnabled ? <>{numberField('Retail buy average', 'retailBuyAveragePrice')}{numberField('Retail sell average', 'retailSellAveragePrice')}{numberField('Retail buy ratio (%)', 'retailBuyRatio')}</> : null}
    <label><input type="checkbox" checked={draft.fibonacciEnabled ?? false} onChange={(event) => patch({ fibonacciEnabled: event.target.checked })} /> Fibonacci</label>
    {draft.fibonacciEnabled ? <>{numberField('Fibonacci start', 'fibonacciStartPrice')}{numberField('Fibonacci end', 'fibonacciEndPrice')}</> : null}
    <fieldset><legend>Economic indicators</legend>{indicators.map((indicator, index) => <div className="indicator-row" key={indicator.id ?? index}><input aria-label={`Indicator ${index + 1} type`} value={indicator.type} onChange={(event) => { const next = [...indicators]; next[index] = { ...indicator, type: event.target.value }; patch({ economicIndicators: next }); }} /><select aria-label={`Indicator ${index + 1} impact`} value={indicator.impact} onChange={(event) => { const next = [...indicators]; next[index] = { ...indicator, impact: event.target.value as TradeAnalysisEconomicIndicatorInput['impact'] }; patch({ economicIndicators: next }); }}><option value="positive">Positive</option><option value="negative">Negative</option></select><button type="button" onClick={() => patch({ economicIndicators: indicators.filter((_, item) => item !== index) })}>Remove</button></div>)}<button type="button" onClick={() => patch({ economicIndicators: [...indicators, { type: '', impact: 'positive' }] })}>Add indicator</button></fieldset>
    <label><span>Regret / review</span><textarea rows={3} value={draft.regret ?? ''} onChange={(event) => patch({ regret: event.target.value || null })} /></label>
    <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save analysis'}</button>
  </form>;
}
