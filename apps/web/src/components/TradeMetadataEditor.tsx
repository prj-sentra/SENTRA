import { useState, type FormEvent } from 'react';
import type { TradeRecord, UpdateTradeRequest } from '@trading-journal/shared';

export function TradeMetadataEditor({ trade, onSave }: { trade: TradeRecord; onSave: (tradeId: string, patch: UpdateTradeRequest) => Promise<void> }) {
  const [form, setForm] = useState({ strategy: trade.strategy ?? '', thesis: trade.thesis ?? '', entryRationale: trade.entryRationale ?? '', exitRationale: trade.exitRationale ?? '', takeProfitCriteria: trade.takeProfitCriteria ?? '', stopLossCriteria: trade.stopLossCriteria ?? '', note: trade.note ?? '' });
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent) { event.preventDefault(); setSaving(true); try { await onSave(trade.id, form); } finally { setSaving(false); } }
  return <form className="detail-editor" onSubmit={(event) => void submit(event)}>
    <h4>Trade notes</h4>
    {Object.entries(form).map(([key, value]) => <label key={key}><span>{key.replace(/([A-Z])/g, ' $1')}</span><textarea rows={2} value={value} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))} /></label>)}
    <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save notes'}</button>
  </form>;
}
