import type { PatchTradeAnalysisRequest, TradeCampaign, TradeRecord, UpdateTradeRequest } from '@trading-journal/shared';
import { ExecutionTradeRow } from './ExecutionTradeRow';
import { TradeAnalysisEditor } from './TradeAnalysisEditor';
import { TradeMetadataEditor } from './TradeMetadataEditor';

export interface TradeDetailProps {
  campaign: TradeCampaign;
  onUpdateTrade: (tradeId: string, patch: UpdateTradeRequest) => Promise<void>;
  onPatchAnalysis: (tradeId: string, patch: PatchTradeAnalysisRequest) => Promise<void>;
  onUpdateExecutionNote: (tradeId: string, kind: 'entry' | 'exit', note: string) => Promise<void>;
}

export function TradeDetail({ campaign, onUpdateTrade, onPatchAnalysis, onUpdateExecutionNote }: TradeDetailProps) {
  return <div className="trade-detail">
    <section><h3>MT5 executions</h3>{campaign.members.map((trade) => <ExecutionTradeRow key={trade.id} trade={trade} onSaveNote={onUpdateExecutionNote} />)}</section>
    {campaign.members.map((trade: TradeRecord) => <div className="trade-editor-grid" key={`edit-${trade.id}`}><TradeMetadataEditor trade={trade} onSave={onUpdateTrade} /><TradeAnalysisEditor trade={trade} onSave={onPatchAnalysis} /></div>)}
  </div>;
}
