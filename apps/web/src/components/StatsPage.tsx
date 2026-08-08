import type { TradeStatsBucket, TradeStatsResponse } from '@trading-journal/shared';

export interface StatsPageProps {
  stats: TradeStatsResponse | null;
  loading?: boolean;
  error?: string | null;
}

function metric(value: number, suffix = ''): string {
  if (!Number.isFinite(value)) return '—';
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}${suffix}`;
}

function Breakdown({ title, buckets }: { title: string; buckets: TradeStatsBucket[] }) {
  return (
    <section className="stats-breakdown">
      <h2>{title}</h2>
      {buckets.length ? (
        <div className="stats-table-wrap">
          <table className="stats-table">
            <thead><tr><th>Group</th><th>Trades</th><th>Win rate</th><th>Realized points</th></tr></thead>
            <tbody>{buckets.map((bucket) => (
              <tr key={bucket.key}><td>{bucket.label}</td><td>{metric(bucket.count)}</td><td>{metric(bucket.winRate, '%')}</td><td>{metric(bucket.realizedPoints)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      ) : <p className="muted">No closed trades in this scope.</p>}
    </section>
  );
}

export function StatsPage({ stats, loading = false, error = null }: StatsPageProps) {
  if (loading && !stats) return <p className="muted" role="status">Loading statistics…</p>;
  if (error && !stats) return <p className="error-banner" role="alert">Statistics are unavailable.</p>;
  if (!stats) return <p className="muted">No statistics available.</p>;
  const { overview } = stats;
  return (
    <main className="stats-page">
      {error ? <p className="error-banner" role="alert">Statistics may be out of date.</p> : null}
      <div className="metric-grid">
        <article><span>Realized points</span><strong>{metric(overview.totalRealizedPoints)}</strong></article>
        <article><span>Average points</span><strong>{metric(overview.averageRealizedPoints)}</strong></article>
        <article><span>Win rate</span><strong>{metric(overview.winRate, '%')}</strong></article>
        <article><span>Total risk</span><strong>{metric(overview.totalRiskAmount)}</strong></article>
        <article><span>Average risk</span><strong>{metric(overview.averageRiskPercent, '%')}</strong></article>
      </div>
      <Breakdown title="By session" buckets={stats.bySession} />
      <Breakdown title="By timeframe" buckets={stats.byBaseTimeframe} />
    </main>
  );
}
