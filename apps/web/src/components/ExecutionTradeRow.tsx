import { useState } from 'react';
import type { TradeRecord } from '@trading-journal/shared';

export function ExecutionTradeRow({ trade, onSaveNote }: { trade: TradeRecord; onSaveNote: (tradeId: string, kind: 'entry' | 'exit', note: string) => Promise<void> }) {
  const [entryNote, setEntryNote] = useState(trade.entry?.note ?? '');
  const [exitNote, setExitNote] = useState(trade.exit?.note ?? '');
  return <article className="execution-row">
    <header><strong>{trade.symbol}</strong><span>{trade.side} · {trade.status}</span></header>
    <div><span>Entry {trade.entry?.price ?? trade.entryPrice ?? '—'}</span><span>{trade.openedAt ? new Date(trade.openedAt).toLocaleString() : '—'}</span></div>
    <label><span>Entry note</span><input value={entryNote} onChange={(event) => setEntryNote(event.target.value)} /><button type="button" onClick={() => void onSaveNote(trade.id, 'entry', entryNote)}>Save</button></label>
    <div><span>Exit {trade.exit?.price ?? trade.exitPrice ?? '—'}</span><span>{trade.closedAt ? new Date(trade.closedAt).toLocaleString() : '—'}</span></div>
    <label><span>Exit note</span><input value={exitNote} onChange={(event) => setExitNote(event.target.value)} disabled={!trade.exit && trade.exitPrice === undefined} /><button type="button" disabled={!trade.exit && trade.exitPrice === undefined} onClick={() => void onSaveNote(trade.id, 'exit', exitNote)}>Save</button></label>
  </article>;
}
