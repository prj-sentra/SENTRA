import type { ReactNode } from 'react';
import type { PatchTradeAnalysisRequest, TradeCampaign, TradeCampaignImage } from '@trading-journal/shared';
import { TradeRecordCard } from './TradeRecordCard';

export interface TradeJournalPageProps {
  campaigns: TradeCampaign[];
  date?: string;
  previousDate?: string;
  nextDate?: string;
  onSelectDate: (date: string) => void;
  loading?: boolean;
  error?: string | null;
  imageUrl: (campaignId: string, imageId: string) => string;
  onPatchAnalysis: (tradeId: string, patch: PatchTradeAnalysisRequest) => Promise<void>;
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

export function TradeJournalPage({ campaigns, date, previousDate, nextDate, onSelectDate, loading = false, error, toolbar, ...actions }: TradeJournalPageProps) {
  return <section className="trade-journal-page" aria-busy={loading}>
    <header className="journal-page-heading">
      <nav className="date-navigation" aria-label="거래일 탐색">
        <button type="button" className="secondary-button compact" aria-label="이전 거래일" disabled={!previousDate || loading} onClick={() => previousDate && onSelectDate(previousDate)}>이전</button>
        <label className="calendar-picker"><span className="sr-only">거래일 선택</span><input type="date" value={date ?? ''} onChange={(event) => event.target.value && onSelectDate(event.target.value)} disabled={loading} /></label>
        <time dateTime={date}><span className="date-long">{koreanDate(date)}</span><span className="date-short">{koreanDateShort(date)}</span></time>
        <button type="button" className="secondary-button compact" aria-label="다음 거래일" disabled={!nextDate || loading} onClick={() => nextDate && onSelectDate(nextDate)}>다음</button>
      </nav>
      {toolbar ? <div className="journal-page-toolbar">{toolbar}</div> : null}
    </header>
    {error ? <p className="error" role="alert">{error}</p> : null}
    {loading ? <p className="journal-state" role="status">거래 기록을 불러오는 중입니다…</p> : campaigns.length === 0 ? <p className="journal-state">선택한 날짜에 거래 기록이 없습니다.</p> : <div className="trade-card-list">{campaigns.map((campaign) => <TradeRecordCard key={campaign.id} campaign={campaign} {...actions} />)}</div>}
  </section>;
}
