import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import type { TradeStatsSeriesPoint } from '@trading-journal/shared';

interface StatsLineChartProps {
  points: TradeStatsSeriesPoint[];
  value: (point: TradeStatsSeriesPoint) => number;
  label: string;
  percent?: boolean;
  proportionalTime?: boolean;
}

interface ChartPoint { timestamp: number; label: string; value: number; }
interface Bounds { left: number; right: number; top: number; bottom: number; }
const HEIGHT = 270;
const FALLBACK_WIDTH = 640;

function shortTimeLabel(timestamp: number): string {
  return new Intl.DateTimeFormat('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(timestamp));
}
function dateLabel(timestamp: number, proportionalTime: boolean): string {
  return proportionalTime ? shortTimeLabel(timestamp) : new Intl.DateTimeFormat('ko-KR', { month: '2-digit', day: '2-digit' }).format(new Date(timestamp));
}
function formatValue(value: number, percent: boolean): string {
  return percent ? `${value.toFixed(2)}%` : value.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
}
function valueDomain(points: ChartPoint[], percent: boolean): [number, number] {
  if (percent) return [0, 100];
  const low = Math.min(...points.map((point) => point.value));
  const high = Math.max(...points.map((point) => point.value));
  const padding = high === low ? Math.max(Math.abs(high) * .1, 1) : (high - low) * .1;
  return [low - padding, high + padding];
}
function xCoordinate(timestamp: number, domain: [number, number], bounds: Bounds): number {
  return domain[0] === domain[1] ? (bounds.left + bounds.right) / 2 : bounds.left + (timestamp - domain[0]) / (domain[1] - domain[0]) * (bounds.right - bounds.left);
}
function yCoordinate(value: number, domain: [number, number], bounds: Bounds): number {
  return bounds.bottom - (value - domain[0]) / (domain[1] - domain[0]) * (bounds.bottom - bounds.top);
}
function stepPath(points: ChartPoint[], xDomain: [number, number], yDomain: [number, number], bounds: Bounds): string {
  return points.reduce((path, point, index) => {
    const x = xCoordinate(point.timestamp, xDomain, bounds);
    const y = yCoordinate(point.value, yDomain, bounds);
    return index ? `${path} H ${x} V ${y}` : `M ${x} ${y}`;
  }, '');
}
function nearestPoint(points: ChartPoint[], timestamp: number): number {
  let low = 0; let high = points.length - 1;
  while (low <= high) { const middle = Math.floor((low + high) / 2); if (points[middle].timestamp < timestamp) low = middle + 1; else high = middle - 1; }
  if (!low) return 0;
  if (low === points.length) return points.length - 1;
  return timestamp - points[low - 1].timestamp <= points[low].timestamp - timestamp ? low - 1 : low;
}

export function StatsLineChart({ points, value, label, percent = false, proportionalTime = false }: StatsLineChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(FALLBACK_WIDTH);
  const [hoveredIndex, setHoveredIndex] = useState<number>();
  const chartPoints = useMemo(() => points.map((point) => ({ timestamp: point.timestamp, label: point.label, value: value(point) })).filter((point) => Number.isFinite(point.timestamp) && Number.isFinite(point.value)).sort((left, right) => left.timestamp - right.timestamp), [points, value]);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const update = () => setWidth(container.clientWidth || FALLBACK_WIDTH);
    update();
    if (typeof ResizeObserver !== 'undefined') { const observer = new ResizeObserver(update); observer.observe(container); return () => observer.disconnect(); }
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  const bounds: Bounds = { left: 48, right: Math.max(64, width - 16), top: 12, bottom: HEIGHT - 32 };
  const xDomain: [number, number] = chartPoints.length ? [chartPoints[0].timestamp, chartPoints.at(-1)!.timestamp] : [0, 1];
  const yDomain = chartPoints.length ? valueDomain(chartPoints, percent) : [0, 1] as [number, number];
  const hovered = hoveredIndex === undefined ? undefined : chartPoints[hoveredIndex];
  const setHoveredFromX = (x: number) => {
    if (!chartPoints.length) return;
    const ratio = Math.max(0, Math.min(1, (x - bounds.left) / (bounds.right - bounds.left)));
    setHoveredIndex(nearestPoint(chartPoints, xDomain[0] + ratio * (xDomain[1] - xDomain[0])));
  };
  const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => { const rect = event.currentTarget.getBoundingClientRect(); setHoveredFromX(rect.width ? (event.clientX - rect.left) * width / rect.width : event.clientX); };
  const handleKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (!chartPoints.length || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home') return setHoveredIndex(0);
    if (event.key === 'End') return setHoveredIndex(chartPoints.length - 1);
    setHoveredIndex((current) => Math.max(0, Math.min(chartPoints.length - 1, (current ?? 0) + (event.key === 'ArrowLeft' ? -1 : 1))));
  };
  return <div className="stats-line-chart-shell" ref={containerRef}>
    <div className="stats-line-chart-legend" aria-live="polite">{hovered ? <><span>{hovered.label}</span><strong>{formatValue(hovered.value, percent)}</strong></> : <span>그래프 위에 마우스를 올려 값을 확인하세요.</span>}</div>
    {chartPoints.length ? <svg className="stats-line-chart" viewBox={`0 0 ${width} ${HEIGHT}`} role="img" aria-label={label} tabIndex={0} onPointerMove={handlePointerMove} onPointerLeave={() => setHoveredIndex(undefined)} onFocus={() => setHoveredIndex((current) => current ?? chartPoints.length - 1)} onKeyDown={handleKeyDown}>
      <g className="stats-line-chart-grid" aria-hidden="true">
        {Array.from({ length: 5 }, (_, index) => { const ratio = index / 4; const y = bounds.top + ratio * (bounds.bottom - bounds.top); const entry = yDomain[1] - ratio * (yDomain[1] - yDomain[0]); return <g key={`y-${index}`}><line x1={bounds.left} x2={bounds.right} y1={y} y2={y} /><text x={bounds.left - 6} y={y} textAnchor="end" dominantBaseline="middle">{formatValue(entry, percent)}</text></g>; })}
        {Array.from({ length: 5 }, (_, index) => { const ratio = index / 4; const x = bounds.left + ratio * (bounds.right - bounds.left); const timestamp = xDomain[0] + ratio * (xDomain[1] - xDomain[0]); return <g key={`x-${index}`}><line x1={x} x2={x} y1={bounds.top} y2={bounds.bottom} /><text x={x} y={HEIGHT - 10} textAnchor="middle">{dateLabel(timestamp, proportionalTime)}</text></g>; })}
        {yDomain[0] <= 0 && yDomain[1] >= 0 ? <line className="stats-line-chart-baseline" x1={bounds.left} x2={bounds.right} y1={yCoordinate(0, yDomain, bounds)} y2={yCoordinate(0, yDomain, bounds)} /> : null}
      </g>
      <path className="stats-line-chart-path" d={stepPath(chartPoints, xDomain, yDomain, bounds)} />
      {chartPoints.length === 1 ? <circle className="stats-line-chart-point" cx={xCoordinate(chartPoints[0].timestamp, xDomain, bounds)} cy={yCoordinate(chartPoints[0].value, yDomain, bounds)} r="3" /> : null}
      {hovered ? <g className="stats-line-chart-hover" aria-hidden="true"><line x1={xCoordinate(hovered.timestamp, xDomain, bounds)} x2={xCoordinate(hovered.timestamp, xDomain, bounds)} y1={bounds.top} y2={bounds.bottom} /><circle cx={xCoordinate(hovered.timestamp, xDomain, bounds)} cy={yCoordinate(hovered.value, yDomain, bounds)} r="4" /></g> : null}
    </svg> : <div className="stats-line-chart-empty" role="img" aria-label={label}>표시할 데이터가 없습니다.</div>}
  </div>;
}
