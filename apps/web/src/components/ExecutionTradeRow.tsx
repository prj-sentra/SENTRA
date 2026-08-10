import type { TradeRecord } from '@trading-journal/shared';

const number = (value?: number) => value === undefined ? '—' : value.toLocaleString('ko-KR');
const price = (value?: number) => value === undefined ? '—' : value.toLocaleString('ko-KR', { maximumFractionDigits: 5 });
const dateTime = (value?: string) => value ? new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—';

export function ExecutionTradeRow({ trade }: { trade: TradeRecord }) {
  const postSeed = trade.seedBalance === undefined || trade.realizedPnl === undefined ? undefined : trade.seedBalance + trade.realizedPnl;

  return <article className="execution-row">
    <p className="execution-time">{dateTime(trade.openedAt)} - {dateTime(trade.closedAt)}</p>
    <dl className="execution-metrics">
      <div className="entry-price"><dt>진입가</dt><dd>{price(trade.entry?.price ?? trade.entryPrice)}</dd></div>
      <div className="quantity"><dt>수량</dt><dd>{trade.entry?.quantity ?? trade.quantityLots ?? '—'}</dd></div>
      <div className="exit-price"><dt>청산가</dt><dd>{price(trade.exit?.price ?? trade.exitPrice)}</dd></div>
      <div className="exit-reason"><dt>청산 사유</dt><dd>{trade.exit?.reason ?? trade.exitReason ?? '—'}</dd></div>
      <div className="seed-change"><dt>시드 변화</dt><dd>{number(trade.seedBalance)} → {number(postSeed)}</dd></div>
      <div className="trade-pnl"><dt>PnL</dt><dd className={`pnl${trade.realizedPnl === undefined ? '' : trade.realizedPnl >= 0 ? ' positive' : ' negative'}`}>{number(trade.realizedPnl)}</dd></div>
    </dl>
  </article>;
}
