import type { PatchTradeAnalysisRequest, TradeCampaign, UpdateTradeRequest } from '@trading-journal/shared';
import { TradeRecordCard } from './TradeRecordCard';

export interface TradeJournalPageProps {
  campaigns: TradeCampaign[];
  loading?: boolean;
  error?: string | null;
  imageUrl: (campaignId: string, imageId: string) => string;
  onUpdateTrade: (tradeId: string, patch: UpdateTradeRequest) => Promise<void>;
  onPatchAnalysis: (tradeId: string, patch: PatchTradeAnalysisRequest) => Promise<void>;
  onUpdateExecutionNote: (tradeId: string, kind: 'entry' | 'exit', note: string) => Promise<void>;
  onUploadImage: (campaignId: string, file: File) => Promise<void>;
  onReorderImages: (campaignId: string, imageIds: string[]) => Promise<void>;
  onDeleteImage: (campaignId: string, imageId: string) => Promise<void>;
}

export function TradeJournalPage({ campaigns, loading = false, error, ...actions }: TradeJournalPageProps) {
  return <section className="trade-journal-page" aria-busy={loading}>
    <header className="journal-page-heading"><div><p className="section-label">Trade Journal</p><h1>Closed trades</h1></div></header>
    {error ? <p className="error" role="alert">{error}</p> : null}
    {loading ? <p className="journal-state">Loading trades…</p> : campaigns.length === 0 ? <p className="journal-state">No trade records yet.</p> : <div className="trade-card-list">{campaigns.map((campaign) => <TradeRecordCard key={campaign.id} campaign={campaign} {...actions} />)}</div>}
  </section>;
}
