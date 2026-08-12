import { useEffect, useRef, useState } from 'react';
import { ColorType, createChart, LineSeries, LineType, type IChartApi, type Time, type UTCTimestamp } from 'lightweight-charts';
import type { TradeStatsSeriesPoint } from '@trading-journal/shared';

interface StatsTradingViewChartProps {
  points: TradeStatsSeriesPoint[];
  value: (point: TradeStatsSeriesPoint) => number;
  label: string;
  percent?: boolean;
}

export function StatsTradingViewChart({ points, value, label, percent = false }: StatsTradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [hovered, setHovered] = useState<{ label: string; value: number }>();

  useEffect(() => {
    const container = containerRef.current;
    if (!container || navigator.userAgent.includes('jsdom')) return;
    const labels = new Map<number, string>();
    const base = Math.floor(Date.UTC(2000, 0, 1) / 1000);
    const data = points.map((point, index) => {
      const time = (base + index * 86400) as UTCTimestamp;
      labels.set(time, point.label);
      return { time, value: value(point) };
    });
    const chart = createChart(container, {
      autoSize: true,
      height: 270,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#697386', fontFamily: "'IBM Plex Mono', ui-monospace, monospace", fontSize: 11 },
      grid: { vertLines: { color: '#e8eaed' }, horzLines: { color: '#e8eaed' } },
      rightPriceScale: { borderColor: '#d7dadd', scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: { borderColor: '#d7dadd', timeVisible: false, secondsVisible: false, tickMarkFormatter: (time: Time) => labels.get(Number(time)) ?? '' },
      crosshair: { vertLine: { color: '#8ba6c1', width: 1, labelBackgroundColor: '#25364a' }, horzLine: { color: '#8ba6c1', width: 1, labelBackgroundColor: '#25364a' } },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
      localization: { priceFormatter: (entry: number) => percent ? `${entry.toFixed(1)}%` : entry.toLocaleString('ko-KR', { maximumFractionDigits: 2 }) },
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
