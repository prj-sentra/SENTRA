import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { TradeStatsSeriesPoint } from '@trading-journal/shared';
import { StatsLineChart } from './StatsLineChart';

afterEach(cleanup);

const points: TradeStatsSeriesPoint[] = [
  { key: 'first', label: '첫 번째 거래', timestamp: Date.parse('2026-01-01T00:00:00Z'), count: 1, realizedPnl: 10, equity: 10, oneLotPnl: 10, winRate: 100 },
  { key: 'last', label: '마지막 거래', timestamp: Date.parse('2026-01-02T00:00:00Z'), count: 1, realizedPnl: 25, equity: 25, oneLotPnl: 25, winRate: 100 },
];
const unevenPoints: TradeStatsSeriesPoint[] = [
  { key: 'first', label: '첫 번째 거래', timestamp: Date.parse('2026-01-01T00:00:00Z'), count: 1, realizedPnl: 10, equity: 10, oneLotPnl: 10, winRate: 100 },
  { key: 'second', label: '두 번째 거래', timestamp: Date.parse('2026-01-01T01:00:00Z'), count: 1, realizedPnl: 20, equity: 20, oneLotPnl: 20, winRate: 100 },
  { key: 'last', label: '마지막 거래', timestamp: Date.parse('2026-01-02T00:00:00Z'), count: 1, realizedPnl: 30, equity: 30, oneLotPnl: 30, winRate: 100 },
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

  it('uses different path geometry and nearest pointer selection for time and uniform spacing', () => {
    const { rerender } = render(<StatsLineChart points={unevenPoints} value={(point) => point.equity} label="성과 추이" spacing="time" />);
    const timeChart = screen.getByRole('img', { name: '성과 추이' });
    const timePath = timeChart.querySelector('.stats-line-chart-path')!.getAttribute('d');
    fireEvent.pointerMove(timeChart, { clientX: 150 });
    expect(timeChart.parentElement!.querySelector('.stats-line-chart-legend')).toHaveTextContent('두 번째 거래');

    rerender(<StatsLineChart points={unevenPoints} value={(point) => point.equity} label="성과 추이" spacing="uniform" />);
    const uniformChart = screen.getByRole('img', { name: '성과 추이' });
    expect(uniformChart.querySelector('.stats-line-chart-path')!.getAttribute('d')).not.toBe(timePath);
    expect(uniformChart).toHaveTextContent('첫 번째 거래');
    expect(uniformChart).toHaveTextContent('두 번째 거래');
    expect(uniformChart).toHaveTextContent('마지막 거래');
    fireEvent.pointerMove(uniformChart, { clientX: 150 });
    expect(uniformChart.parentElement!.querySelector('.stats-line-chart-legend')).toHaveTextContent('첫 번째 거래');
  });
});
