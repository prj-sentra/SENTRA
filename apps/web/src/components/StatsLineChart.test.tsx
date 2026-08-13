import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { TradeStatsSeriesPoint } from '@trading-journal/shared';
import { StatsLineChart } from './StatsLineChart';

afterEach(cleanup);

const points: TradeStatsSeriesPoint[] = [
  { key: 'first', label: '첫 번째 거래', timestamp: Date.parse('2026-01-01T00:00:00Z'), count: 1, realizedPnl: 10, equity: 10, winRate: 100 },
  { key: 'last', label: '마지막 거래', timestamp: Date.parse('2026-01-02T00:00:00Z'), count: 1, realizedPnl: 25, equity: 25, winRate: 100 },
];

describe('StatsLineChart', () => {
  it('selects the nearest timestamp from pointer and keyboard navigation', () => {
    render(<StatsLineChart points={points} value={(point) => point.equity} label="PnL 추이" />);
    const chart = screen.getByRole('img', { name: 'PnL 추이' });
    const legend = chart.parentElement!.querySelector('.stats-line-chart-legend')!;

    fireEvent.pointerMove(chart, { clientX: 48 });
    expect(legend).toHaveTextContent('첫 번째 거래');
    expect(legend.querySelector('strong')).toHaveTextContent('10');

    fireEvent.pointerMove(chart, { clientX: 624 });
    expect(legend).toHaveTextContent('마지막 거래');
    expect(legend.querySelector('strong')).toHaveTextContent('25');

    fireEvent.focus(chart);
    fireEvent.keyDown(chart, { key: 'ArrowLeft' });
    expect(legend).toHaveTextContent('첫 번째 거래');
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    expect(legend).toHaveTextContent('마지막 거래');
  });
});
