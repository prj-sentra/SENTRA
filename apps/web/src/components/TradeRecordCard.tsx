import { useRef, useState } from 'react';
import type { PatchTradeAnalysisRequest, PatchTradeCampaignAnalysisRequest, PatchTradeCampaignMemoRequest, PatchTradeCampaignReviewRequest, TradeCampaign, TradeCampaignImage } from '@trading-journal/shared';
import { ImageLightbox } from './ImageLightbox';
import { CampaignMemoEditor } from './CampaignMemoEditor';
import { TradeDetail, type TradeDetailHandle } from './TradeDetail';
import { TradeImageGallery } from './TradeImageGallery';

export interface TradeRecordCardProps {
  campaign: TradeCampaign;
  imageUrl: (campaignId: string, imageId: string) => string;
  onPatchAnalysis: (tradeId: string, patch: PatchTradeAnalysisRequest) => Promise<void>;
  onPatchCampaignAnalysis: (campaignId: string, patch: PatchTradeCampaignAnalysisRequest) => Promise<void>;
  onPatchCampaignReview: (campaignId: string, patch: PatchTradeCampaignReviewRequest) => Promise<void>;
  onPatchMemo: (campaignId: string, patch: PatchTradeCampaignMemoRequest) => Promise<void>;
  onRefresh?: () => Promise<void>;
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
  const [dirty, setDirty] = useState(false);
  const memoForm = useRef<HTMLFormElement>(null);
  const tradeDetail = useRef<TradeDetailHandle>(null);
  const orderedImages = [...campaign.images].sort((a, b) => a.position - b.position);
  const firstImage = orderedImages[0];
  const previewIndex = previewImageId ? orderedImages.findIndex((image) => image.id === previewImageId) : -1;
  const previewImage = orderedImages[previewIndex];
  const points = campaign.quantityLots === 0 ? undefined : campaign.realizedPnl / campaign.quantityLots;
  const postSeed = campaign.seedBalance === undefined ? undefined : campaign.seedBalance + campaign.realizedPnl;
  const seedChangeRatio = campaign.seedBalance ? campaign.realizedPnl / campaign.seedBalance * 100 : undefined;
  const memoPreview = campaign.memo?.trim() || '작성 필요';
  function saveAll() {
    memoForm.current?.requestSubmit();
    tradeDetail.current?.save();
    setDirty(false);
  }

  function collapse() {
    if (dirty) {
      if (!window.confirm('저장하지 않은 변경사항이 있습니다. 저장하고 간단히 보기로 전환하시겠습니까?')) return;
      saveAll();
    }
    setExpanded(false);
  }
  return <article className="trade-record-card">
    <div className="trade-card-summary">
      {firstImage
        ? <button className="trade-cover" type="button" onClick={() => setPreviewImageId(firstImage.id)} aria-label={`${campaign.symbol} 거래 이미지 전체 보기`}><img src={props.imageUrl(campaign.id, firstImage.id)} alt={`${campaign.symbol} 거래 차트`} /></button>
        : <div className="trade-cover"><span>차트 이미지 없음</span></div>}
      <div className="trade-summary-body">
        <header><div className="trade-header-main"><h2>{campaign.symbol}</h2><span className={`direction ${campaign.side}`}>{sideLabel(campaign.side)}</span><strong className={`trade-header-pnl pnl ${campaign.realizedPnl >= 0 ? 'positive' : 'negative'}`}>{signedMetric(campaign.realizedPnl)}</strong></div><div className="trade-header-meta"><strong>{campaign.members.length}건 분할 매매</strong><p className="trade-time">{time(campaign.openedAt)} - {time(campaign.closedAt)}</p></div></header>
        <div className="trade-summary-metrics">
          <dl>
            <div><dt>평균 진입가 / 평균 청산가</dt><dd>{metric(campaign.entryPrice)} / {metric(campaign.exitPrice)}</dd></div>
            <div><dt>총 수량</dt><dd>{metric(campaign.quantityLots, ' lot')}</dd></div>
            <div><dt>거래 전후 시드 변화 / 비율</dt><dd>{metric(campaign.seedBalance)} → {metric(postSeed)} / {seedChangeRatio === undefined ? '—' : `${seedChangeRatio >= 0 ? '+' : ''}${seedChangeRatio.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}%`}</dd></div>
            <div><dt>포인트 (PnL / 수량; 1랏 기준 PnL)</dt><dd title={points === undefined ? '수량이 없어 포인트를 계산할 수 없습니다.' : undefined}>{metric(points)}</dd></div>
          </dl>
          <div className="memo-preview-metric"><span>거래 메모</span><p>{memoPreview}</p></div>
        </div>
        <div className="trade-mobile-summary"><div className="mobile-summary-first"><strong>{campaign.symbol}</strong><span className={`direction ${campaign.side}`}>{sideLabel(campaign.side)}</span><strong className={campaign.realizedPnl >= 0 ? 'pnl positive' : 'pnl negative'}>{signedMetric(campaign.realizedPnl)}</strong></div><div className="mobile-summary-second"><span><b>성과</b> 포인트 {metric(points)}</span><span className="regret-preview"><b>메모</b> {memoPreview}</span><span className={campaign.analysisComplete ? 'complete' : 'incomplete'}><b>작성</b> {campaign.analysisComplete ? '완료' : '필요'}</span></div></div>
        <div className="detail-actions">
          {expanded ? <>
            <button className="detail-toggle" type="button" onClick={collapse}>간단하게 ▲</button>
            <button className="detail-action save-action" type="button" onClick={() => {
              if (!window.confirm('변경사항을 저장하시겠습니까?')) return;
              saveAll();
            }}>저장</button>
            <button className="detail-action cancel-action" type="button" onClick={() => {
              if (!window.confirm('저장하지 않은 변경사항을 취소하시겠습니까?')) return;
              void (props.onRefresh?.() ?? Promise.resolve()).then(() => {
                memoForm.current?.reset();
                tradeDetail.current?.reset();
                setDirty(false);
              });
            }}>변경사항 취소</button>
          </> : <button className="detail-toggle" type="button" aria-expanded="false" onClick={() => setExpanded(true)}>상세 보기</button>}
        </div>
      </div>
    </div>
    {expanded ? <div className="expanded-content" onChangeCapture={() => setDirty(true)}><TradeImageGallery campaignId={campaign.id} symbol={campaign.symbol} images={campaign.images} imageUrl={props.imageUrl} onUpload={props.onUploadImage} onReorder={props.onReorderImages} onDelete={props.onDeleteImage} /><div className="campaign-detail-layout"><CampaignMemoEditor ref={memoForm} campaign={campaign} onSave={props.onPatchMemo} onSaveReview={props.onPatchCampaignReview} /><TradeDetail ref={tradeDetail} campaign={campaign} onPatchAnalysis={props.onPatchAnalysis} onPatchCampaignAnalysis={props.onPatchCampaignAnalysis} /></div></div> : null}
    {previewImage ? <ImageLightbox
      src={props.imageUrl(campaign.id, previewImage.id)}
      alt={`${campaign.symbol} 거래 차트 ${previewIndex + 1}`}
      onClose={() => setPreviewImageId(null)}
      onPrevious={previewIndex > 0 ? () => setPreviewImageId(orderedImages[previewIndex - 1].id) : undefined}
      onNext={previewIndex < orderedImages.length - 1 ? () => setPreviewImageId(orderedImages[previewIndex + 1].id) : undefined}
    /> : null}
  </article>;
}
