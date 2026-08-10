import type { TradeRecord } from '@trading-journal/shared';

const number = (value?: number) => value === undefined ? '—' : value.toLocaleString('ko-KR');
const price = (value?: number) => value === undefined ? '—' : value.toLocaleString('ko-KR', { maximumFractionDigits: 5 });
const dateTime = (value?: string) => value ? new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—';

export function ExecutionTradeRow({ trade }: { trade: TradeRecord }) {
  return <article className="execution-row">
    <dl className="execution-metrics">
      <div className="execution-period"><dt>진입시간 / 청산시간</dt><dd>{dateTime(trade.openedAt)} / {dateTime(trade.closedAt)}</dd></div>
      <div className="price-range"><dt>진입가 / 청산가</dt><dd>{price(trade.entry?.price ?? trade.entryPrice)} / {price(trade.exit?.price ?? trade.exitPrice)}</dd></div>
      <div className="quantity"><dt>수량</dt><dd>{number(trade.entry?.quantity ?? trade.quantityLots)}</dd></div>
      <div className="exit-reason"><dt>청산 사유</dt><dd>{trade.exit?.reason ?? trade.exitReason ?? '—'}</dd></div>
      <div className="trade-pnl"><dt>PNL</dt><dd>{number(trade.realizedPnl)}</dd></div>
    </dl>
  </article>;
}
