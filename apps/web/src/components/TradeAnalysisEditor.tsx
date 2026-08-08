import { useState, type FormEvent } from 'react';
import type { PatchTradeAnalysisRequest, TradeRecord } from '@trading-journal/shared';

export function TradeAnalysisEditor({ trade, onSave }: { trade: TradeRecord; onSave: (tradeId: string, patch: PatchTradeAnalysisRequest) => Promise<void> }) {
  const [baseTimeframe, setBaseTimeframe] = useState(trade.analysis.baseTimeframe ?? '');
  const [primaryTrend, setPrimaryTrend] = useState(trade.analysis.primaryTrend ?? '');
  const [regret, setRegret] = useState(trade.analysis.regret ?? '');
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true);
    try { await onSave(trade.id, { expectedUpdatedAt: trade.analysis.updatedAt, baseTimeframe: baseTimeframe || null, primaryTrend: (primaryTrend || null) as PatchTradeAnalysisRequest['primaryTrend'], regret: regret || null }); } finally { setSaving(false); }
  }
  return <form className="detail-editor" onSubmit={(event) => void submit(event)}><h4>Analysis</h4>
    <label><span>Base timeframe</span><input value={baseTimeframe} onChange={(event) => setBaseTimeframe(event.target.value)} /></label>
    <label><span>Primary trend</span><select value={primaryTrend} onChange={(event) => setPrimaryTrend(event.target.value)}><option value="">Not set</option><option value="up">Up</option><option value="sideways">Sideways</option><option value="down">Down</option></select></label>
    <label><span>Regret / review</span><textarea rows={3} value={regret} onChange={(event) => setRegret(event.target.value)} /></label>
    <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save analysis'}</button>
  </form>;
}
