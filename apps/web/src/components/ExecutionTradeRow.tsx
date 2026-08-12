import type { TradeCampaign, TradeExitReason, TradeRecord } from '@trading-journal/shared';

const number = (value?: number) => value === undefined ? '—' : value.toLocaleString('ko-KR');
const price = (value?: number) => value === undefined ? '—' : value.toLocaleString('ko-KR', { maximumFractionDigits: 5 });
const dateTime = (value?: string) => value ? new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—';

const EXIT_REASON_LABELS: Record<TradeExitReason, string> = {
  target_hit: '목표가 도달 (TP)',
  stop_loss: '손절가 도달 (SL)',
  manual: '수동 청산',
  forced_liquidation: '강제 청산',
  automated: '자동매매 청산',
  rollover: '롤오버 청산',
  variation_margin: '변동 증거금 정산',
  split: '종목 분할',
  corporate_action: '기업 활동',
  other: '기타',
  invalidated: '거래 근거 무효화',
  time_exit: '시간 기준 청산',
};

export const exitReasonLabel = (reason?: TradeExitReason): string => reason ? EXIT_REASON_LABELS[reason] : '—';

export interface ExecutionTradeRowProps {
  trade: TradeRecord;
  campaign?: TradeCampaign;
  busy?: boolean;
  onChangeCampaignHead?: (campaign: TradeCampaign, tradeId: string) => Promise<void>;
}

function campaignHeadConfirmation(isHead: boolean): string {
  return isHead
    ? '이 첫 매매 지정을 해제하시겠습니까?\n해제하면 시간 간격 기준으로 자동 재분류됩니다.\n완료될 때까지 이 계정의 첫 매매 변경은 잠깁니다. API 변경 요청 후 캠페인을 다시 불러오며, 이 매매를 다시 선택합니다.'
    : '이 매매를 첫 매매로 지정하시겠습니까?\n이 매매부터 별도 캠페인으로 분할됩니다.\n다른 캠페인은 시간 간격 기준으로 자동 재분류될 수 있습니다.\n완료될 때까지 이 계정의 첫 매매 변경은 잠깁니다. API 변경 요청 후 캠페인을 다시 불러오며, 이 매매를 다시 선택합니다.';
}

export function ExecutionTradeRow({ trade, campaign, busy = false, onChangeCampaignHead }: ExecutionTradeRowProps) {
  const isHead = campaign?.rootTradeId === trade.id;
  const canUnset = isHead && campaign?.headSource === 'MANUAL';
  const canSet = campaign && !isHead;
  const changeHead = canUnset || canSet;
  return <article className="execution-row">
    <div className="execution-time-row">
      <p className="execution-period">{dateTime(trade.openedAt)} - {dateTime(trade.closedAt)}</p>
      {isHead ? <span className="campaign-head-status">{campaign?.headSource === 'MANUAL' ? '첫 매매 · 수동 지정' : '첫 매매 · 자동 지정'}</span> : null}
      {changeHead ? <button type="button" className="secondary-button compact campaign-head-action" disabled={busy} onClick={() => {
        if (!campaign || !onChangeCampaignHead || !window.confirm(campaignHeadConfirmation(isHead))) return;
        void onChangeCampaignHead(campaign, trade.id);
      }}>{canUnset ? '지정 해제' : '첫 매매로 지정'}</button> : null}
    </div>
    <dl className="execution-metrics">
      <div className="price-range"><dt>진입가 / 청산가</dt><dd>{price(trade.entry?.price ?? trade.entryPrice)} / {price(trade.exit?.price ?? trade.exitPrice)}</dd></div>
      <div className="quantity"><dt>수량</dt><dd>{number(trade.entry?.quantity ?? trade.quantityLots)}</dd></div>
      <div className="exit-reason"><dt>청산 사유</dt><dd>{exitReasonLabel(trade.exit?.reason ?? trade.exitReason)}</dd></div>
      <div className="trade-pnl"><dt>PNL</dt><dd>{number(trade.realizedPnl)}</dd></div>
    </dl>
  </article>;
}
