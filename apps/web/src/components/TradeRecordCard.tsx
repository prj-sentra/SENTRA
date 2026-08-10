import { useState } from 'react';
import type { PatchTradeAnalysisRequest, TradeCampaign, TradeCampaignImage } from '@trading-journal/shared';
import { ImageLightbox } from './ImageLightbox';
import { TradeDetail } from './TradeDetail';
import { TradeImageGallery } from './TradeImageGallery';

export interface TradeRecordCardProps {
  campaign: TradeCampaign;
  imageUrl: (campaignId: string, imageId: string) => string;
  onPatchAnalysis: (tradeId: string, patch: PatchTradeAnalysisRequest) => Promise<void>;
  onUploadImage: (campaignId: string, file: File, uploadId: string) => Promise<TradeCampaignImage>;
  onReorderImages: (campaignId: string, imageIds: string[]) => Promise<void>;
  onDeleteImage: (campaignId: string, imageId: string) => Promise<void>;
}

const metric = (value?: number, suffix = '') => value === undefined ? '—' : `${value.toLocaleString('ko-KR')}${suffix}`;
const signedMetric = (value?: number) => value === undefined ? '—' : `${value > 0 ? '+' : ''}${value.toLocaleString('ko-KR')}`;
const time = (value?: string) => value ? new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—';
const sideLabel = (side: string) => side === 'long' ? 'Long' : 'Short';

export function TradeRecordCard(props: TradeRecordCardProps) {
  const { campaign } = props;
  const [expanded, setExpanded] = useState(false);
  const [previewImageId, setPreviewImageId] = useState<string | null>(null);
  const orderedImages = [...campaign.images].sort((a, b) => a.position - b.position);
  const firstImage = orderedImages[0];
  const previewIndex = previewImageId ? orderedImages.findIndex((image) => image.id === previewImageId) : -1;
  const previewImage = orderedImages[previewIndex];
  const points = campaign.quantityLots === 0 ? undefined : campaign.realizedPnl / campaign.quantityLots;
  const postSeed = campaign.seedBalance === undefined ? undefined : campaign.seedBalance + campaign.realizedPnl;
  const seedChangeRatio = campaign.seedBalance ? campaign.realizedPnl / campaign.seedBalance * 100 : undefined;
  const regret = campaign.regret?.trim();
  const regretPreview = regret || '작성 필요';
  return <article className="trade-record-card">
    <div className="trade-card-summary">
      {firstImage
        ? <button className="trade-cover" type="button" onClick={() => setPreviewImageId(firstImage.id)} aria-label={`${campaign.symbol} 거래 이미지 전체 보기`}><img src={props.imageUrl(campaign.id, firstImage.id)} alt={`${campaign.symbol} 거래 차트`} /></button>
        : <div className="trade-cover"><span>차트 이미지 없음</span></div>}
      <div className="trade-summary-body">
        <header><div className="trade-header-main"><h2>{campaign.symbol}</h2><span className={`direction ${campaign.side}`}>{sideLabel(campaign.side)}</span><strong className={`trade-header-pnl pnl ${campaign.realizedPnl >= 0 ? 'positive' : 'negative'}`}>{signedMetric(campaign.realizedPnl)}</strong></div><strong>{campaign.members.length}건 분할 매매</strong></header>
        <p className="trade-time">{time(campaign.openedAt)} → {time(campaign.closedAt)}</p>
        <div className="trade-summary-metrics">
          <dl>
            <div><dt>평균 진입가 / 평균 청산가</dt><dd>{metric(campaign.entryPrice)} / {metric(campaign.exitPrice)}</dd></div>
            <div><dt>총 수량</dt><dd>{metric(campaign.quantityLots, ' lot')}</dd></div>
            <div><dt>거래 전후 시드 변화 / 비율</dt><dd>{metric(campaign.seedBalance)} → {metric(postSeed)} / {seedChangeRatio === undefined ? '—' : `${seedChangeRatio >= 0 ? '+' : ''}${seedChangeRatio.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}%`}</dd></div>
            <div><dt>포인트 (PnL / 수량; 1랏 기준 PnL)</dt><dd title={points === undefined ? '수량이 없어 포인트를 계산할 수 없습니다.' : undefined}>{metric(points)}</dd></div>
          </dl>
          <label className="regret-metric">
            <span>아쉬운 점</span>
            <textarea aria-label="아쉬운 점" value={regret ?? ''} placeholder="작성 필요" readOnly />
          </label>
        </div>
        <div className="trade-mobile-summary"><div className="mobile-summary-first"><strong>{campaign.symbol}</strong><span className={`direction ${campaign.side}`}>{sideLabel(campaign.side)}</span><strong className={campaign.realizedPnl >= 0 ? 'pnl positive' : 'pnl negative'}>{signedMetric(campaign.realizedPnl)}</strong></div><div className="mobile-summary-second"><span><b>성과</b> 포인트 {metric(points)}</span><span className="regret-preview"><b>아쉬운 점</b> {regretPreview}</span><span className={campaign.analysisComplete ? 'complete' : 'incomplete'}><b>작성</b> {campaign.analysisComplete ? '완료' : '필요'}</span></div></div>
        <button className="detail-toggle" type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? '상세 닫기' : '상세 보기'}</button>
      </div>
    </div>
    {expanded ? <div className="expanded-content"><TradeImageGallery campaignId={campaign.id} symbol={campaign.symbol} images={campaign.images} imageUrl={props.imageUrl} onUpload={props.onUploadImage} onReorder={props.onReorderImages} onDelete={props.onDeleteImage} /><TradeDetail campaign={campaign} onPatchAnalysis={props.onPatchAnalysis} /></div> : null}
    {previewImage ? <ImageLightbox
      src={props.imageUrl(campaign.id, previewImage.id)}
      alt={`${campaign.symbol} 거래 차트 ${previewIndex + 1}`}
      onClose={() => setPreviewImageId(null)}
      onPrevious={previewIndex > 0 ? () => setPreviewImageId(orderedImages[previewIndex - 1].id) : undefined}
      onNext={previewIndex < orderedImages.length - 1 ? () => setPreviewImageId(orderedImages[previewIndex + 1].id) : undefined}
    /> : null}
  </article>;
}
