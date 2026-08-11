import { useEffect, useRef, type ReactNode } from 'react';
import type { PatchTradeAnalysisRequest, PatchTradeCampaignAnalysisRequest, PatchTradeCampaignMemoRequest, PatchTradeCampaignReviewRequest, TradeCalendarDay, TradeCampaign, TradeCampaignImage } from '@trading-journal/shared';
import { TradeCalendarPicker } from './TradeCalendarPicker';
import { TradeRecordCard } from './TradeRecordCard';

export interface TradeJournalPageProps {
  campaigns: TradeCampaign[];
  calendarDays: TradeCalendarDay[];
  date?: string;
  previousDate?: string;
  nextDate?: string;
  onSelectDate: (date: string) => void;
  targetId?: string;
  onTargetFocused?: () => void;
  loading?: boolean;
  error?: string | null;
  imageUrl: (campaignId: string, imageId: string) => string;
  onPatchAnalysis: (tradeId: string, patch: PatchTradeAnalysisRequest) => Promise<void>;
  onPatchCampaignAnalysis: (campaignId: string, patch: PatchTradeCampaignAnalysisRequest) => Promise<void>;
  onPatchCampaignReview: (campaignId: string, patch: PatchTradeCampaignReviewRequest) => Promise<void>;
  onPatchMemo: (campaignId: string, patch: PatchTradeCampaignMemoRequest) => Promise<void>;
  onRefresh?: () => Promise<void>;
  onUploadImage: (campaignId: string, file: File, uploadId: string) => Promise<TradeCampaignImage>;
  onReorderImages: (campaignId: string, imageIds: string[]) => Promise<void>;
  onDeleteImage: (campaignId: string, imageId: string) => Promise<void>;
  toolbar?: ReactNode;
}

function koreanDate(value?: string): string {
  if (!value) return '최근 거래일';
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'full' }).format(new Date(`${value}T00:00:00`));
}
function koreanDateShort(value?: string): string {
  if (!value) return '최근';
  return new Intl.DateTimeFormat('ko-KR', { month: 'short', day: 'numeric' }).format(new Date(`${value}T00:00:00`));
}

export function TradeJournalPage({ campaigns, calendarDays, date, previousDate, nextDate, onSelectDate, targetId, onTargetFocused, loading = false, error, toolbar, ...actions }: TradeJournalPageProps) {
  const targetRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (loading || !targetId || !targetRef.current) return;
    targetRef.current.scrollIntoView({ block: 'center' });
    targetRef.current.focus({ preventScroll: true });
    onTargetFocused?.();
  }, [campaigns, loading, onTargetFocused, targetId]);
  return <section className="trade-journal-page" aria-busy={loading}>
    <header className="journal-page-heading">
      <nav className="date-navigation" aria-label="거래일 탐색">
        <button type="button" className="secondary-button compact" aria-label="이전 거래일" title="이전 거래일" disabled={!previousDate || loading} onClick={() => previousDate && onSelectDate(previousDate)}>◀</button>
        <TradeCalendarPicker days={calendarDays} selectedDate={date} disabled={loading} onSelectDate={onSelectDate} />
        <time dateTime={date}><span className="date-long">{koreanDate(date)}</span><span className="date-short">{koreanDateShort(date)}</span></time>
        <button type="button" className="secondary-button compact" aria-label="다음 거래일" title="다음 거래일" disabled={!nextDate || loading} onClick={() => nextDate && onSelectDate(nextDate)}>▶</button>
      </nav>
      {toolbar ? <div className="journal-page-toolbar">{toolbar}</div> : null}
    </header>
    {error ? <p className="error" role="alert">{error}</p> : null}
    {loading && campaigns.length === 0 ? <p className="journal-state" role="status">거래 기록을 불러오는 중입니다…</p> : campaigns.length === 0 ? <p className="journal-state">선택한 날짜에 거래 기록이 없습니다.</p> : <div className="trade-card-list">{campaigns.map((campaign) => {
      const targeted = targetId === campaign.id || campaign.members.some((trade) => trade.id === targetId);
      return <article key={campaign.id} ref={targeted ? targetRef : undefined} tabIndex={targeted ? -1 : undefined} className={targeted ? 'trade-journal-target' : undefined}><TradeRecordCard campaign={campaign} {...actions} /></article>;
    })}</div>}
  </section>;
}
