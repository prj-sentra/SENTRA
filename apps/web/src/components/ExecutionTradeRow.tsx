import type { TradeExitReason, TradeRecord } from '@trading-journal/shared';

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

export function ExecutionTradeRow({ trade }: { trade: TradeRecord }) {
  return <article className="execution-row">
    <dl className="execution-metrics">
      <div className="execution-period"><dt>진입시간 / 청산시간</dt><dd>{dateTime(trade.openedAt)} / {dateTime(trade.closedAt)}</dd></div>
      <div className="price-range"><dt>진입가 / 청산가</dt><dd>{price(trade.entry?.price ?? trade.entryPrice)} / {price(trade.exit?.price ?? trade.exitPrice)}</dd></div>
      <div className="quantity"><dt>수량</dt><dd>{number(trade.entry?.quantity ?? trade.quantityLots)}</dd></div>
      <div className="exit-reason"><dt>청산 사유</dt><dd>{exitReasonLabel(trade.exit?.reason ?? trade.exitReason)}</dd></div>
      <div className="trade-pnl"><dt>PNL</dt><dd>{number(trade.realizedPnl)}</dd></div>
    </dl>
  </article>;
}
