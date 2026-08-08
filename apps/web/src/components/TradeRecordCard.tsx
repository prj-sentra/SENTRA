import { useState } from 'react';
import type { PatchTradeAnalysisRequest, TradeCampaign, UpdateTradeRequest } from '@trading-journal/shared';
import { TradeDetail } from './TradeDetail';
import { TradeImageGallery } from './TradeImageGallery';

export interface TradeRecordCardProps {
  campaign: TradeCampaign;
  imageUrl: (campaignId: string, imageId: string) => string;
  onUpdateTrade: (tradeId: string, patch: UpdateTradeRequest) => Promise<void>;
  onPatchAnalysis: (tradeId: string, patch: PatchTradeAnalysisRequest) => Promise<void>;
  onUpdateExecutionNote: (tradeId: string, kind: 'entry' | 'exit', note: string) => Promise<void>;
  onUploadImage: (campaignId: string, file: File) => Promise<void>;
  onReorderImages: (campaignId: string, imageIds: string[]) => Promise<void>;
  onDeleteImage: (campaignId: string, imageId: string) => Promise<void>;
}
const metric = (value?: number, suffix = '') => value === undefined ? '—' : `${value.toLocaleString()}${suffix}`;
const time = (value?: string) => value ? new Date(value).toLocaleString() : '—';

export function TradeRecordCard(props: TradeRecordCardProps) {
  const { campaign } = props;
  const [expanded, setExpanded] = useState(false);
  const firstImage = [...campaign.images].sort((a, b) => a.position - b.position)[0];
  return <article className="trade-record-card">
    <div className="trade-card-summary">
      <div className="trade-cover">{firstImage ? <img src={props.imageUrl(campaign.id, firstImage.id)} alt={`${campaign.symbol} representative trade chart`} /> : <span>No chart image</span>}</div>
      <div className="trade-summary-body">
        <header><div><h2>{campaign.symbol}</h2><span className={`direction ${campaign.side}`}>{campaign.side}</span><span>{campaign.status}</span></div><strong>{campaign.members.length} TRADES</strong></header>
        <p className="trade-time">{time(campaign.openedAt)} → {time(campaign.closedAt)}</p>
        <div className="trade-primary-metrics"><dl><div><dt>Entry</dt><dd>{metric(campaign.entryPrice)}</dd></div><div><dt>Quantity</dt><dd>{metric(campaign.quantityLots, ' lots')}</dd></div><div><dt>Exit</dt><dd>{metric(campaign.exitPrice)}</dd></div><div><dt>Reason</dt><dd>{campaign.exitReason ?? '—'}</dd></div></dl><strong className={campaign.realizedPnl >= 0 ? 'pnl positive' : 'pnl negative'}>{metric(campaign.realizedPnl)}</strong></div>
        <dl className="trade-risk-row"><div><dt>TP</dt><dd>{metric(campaign.takeProfitPrice)}</dd></div><div><dt>SL</dt><dd>{metric(campaign.stopLossPrice)}</dd></div><div><dt>Seed</dt><dd>{metric(campaign.seedBalance)}</dd></div><div><dt>Risk</dt><dd>{metric(campaign.riskAmount)} / {metric(campaign.riskPercent, '%')}</dd></div></dl>
        <button className="detail-toggle" type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? 'Hide details' : 'Show details'}</button>
      </div>
    </div>
    {expanded ? <div className="expanded-content"><TradeImageGallery campaignId={campaign.id} symbol={campaign.symbol} images={campaign.images} imageUrl={props.imageUrl} onUpload={props.onUploadImage} onReorder={props.onReorderImages} onDelete={props.onDeleteImage} /><TradeDetail campaign={campaign} onUpdateTrade={props.onUpdateTrade} onPatchAnalysis={props.onPatchAnalysis} onUpdateExecutionNote={props.onUpdateExecutionNote} /></div> : null}
  </article>;
}
