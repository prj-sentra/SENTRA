import { useEffect, useRef, useState } from 'react';
import { ColorType, createChart, LineSeries, LineType, type IChartApi, type Time, type UTCTimestamp } from 'lightweight-charts';
import type { TradeStatsSeriesPoint } from '@trading-journal/shared';

interface StatsTradingViewChartProps {
  points: TradeStatsSeriesPoint[];
  value: (point: TradeStatsSeriesPoint) => number;
  label: string;
  percent?: boolean;
  proportionalTime?: boolean;
}

function shortTimeLabel(timestamp: number): string {
  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(timestamp));
}

export function StatsTradingViewChart({ points, value, label, percent = false, proportionalTime = false }: StatsTradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [hovered, setHovered] = useState<{ label: string; value: number }>();

  useEffect(() => {
    const container = containerRef.current;
    if (!container || navigator.userAgent.includes('jsdom')) return;
    const labels = new Map<number, string>();
    const actualData = points.map((point) => {
      const time = Math.floor(point.timestamp / 1000) as UTCTimestamp;
      labels.set(time, point.label);
      return { time, value: value(point) };
    });
    const data: Array<{ time: UTCTimestamp; value?: number }> = [...actualData];
    if (proportionalTime && actualData.length > 1) {
      const first = Number(actualData[0].time);
      const last = Number(actualData.at(-1)!.time);
      const interval = Math.max(60, Math.ceil((last - first) / 300 / 60) * 60);
      const occupied = new Set(actualData.map((point) => Number(point.time)));
      for (let time = first; time <= last; time += interval) {
        if (!occupied.has(time)) data.push({ time: time as UTCTimestamp });
      }
      data.sort((left, right) => Number(left.time) - Number(right.time));
    }
    const chart = createChart(container, {
      autoSize: true,
      height: 270,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#697386', fontFamily: "'IBM Plex Mono', ui-monospace, monospace", fontSize: 11 },
      grid: { vertLines: { color: '#e8eaed' }, horzLines: { color: '#e8eaed' } },
      rightPriceScale: { borderColor: '#d7dadd', scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: {
        borderColor: '#d7dadd',
        timeVisible: proportionalTime,
        secondsVisible: false,
        tickMarkFormatter: (time: Time) => {
          const timestamp = Number(time) * 1000;
          if (proportionalTime) return shortTimeLabel(timestamp);
          return new Intl.DateTimeFormat('ko-KR', { month: '2-digit', day: '2-digit' }).format(new Date(timestamp));
        },
        minBarSpacing: proportionalTime ? 8 : 12,
      },
      crosshair: { vertLine: { color: '#8ba6c1', width: 1, labelBackgroundColor: '#25364a' }, horzLine: { color: '#8ba6c1', width: 1, labelBackgroundColor: '#25364a' } },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
      localization: {
        priceFormatter: (entry: number) => percent ? `${entry.toFixed(1)}%` : entry.toLocaleString('ko-KR', { maximumFractionDigits: 2 }),
        timeFormatter: (time: Time) => labels.get(Number(time)) ?? new Date(Number(time) * 1000).toLocaleString('ko-KR'),
      },
    });
    chartRef.current = chart;
    const series = chart.addSeries(LineSeries, { color: '#0f62fe', lineWidth: 2, lineType: LineType.WithSteps, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: true });
    series.setData(data);
    chart.timeScale().fitContent();
    chart.subscribeCrosshairMove((param) => {
      const entry = param.seriesData.get(series);
      if (!param.time || !entry || !('value' in entry)) return setHovered(undefined);
      setHovered({ label: labels.get(Number(param.time)) ?? '', value: entry.value });
    });
    return () => {
      chartRef.current = null;
      chart.remove();
    };
  }, [percent, points, value]);

  return <div className="tradingview-chart-shell" role="img" aria-label={label}>
    <div className="tradingview-chart-legend">{hovered ? <><span>{hovered.label}</span><strong>{percent ? `${hovered.value.toFixed(2)}%` : hovered.value.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}</strong></> : <span>그래프 위에 마우스를 올려 값을 확인하세요.</span>}</div>
    <div className="tradingview-chart" ref={containerRef} />
  </div>;
}
