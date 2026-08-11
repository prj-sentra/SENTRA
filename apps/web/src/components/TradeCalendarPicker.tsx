import { useEffect, useMemo, useRef, useState } from 'react';
import type { TradeCalendarDay } from '@trading-journal/shared';

interface TradeCalendarPickerProps {
  days: TradeCalendarDay[];
  selectedDate?: string;
  disabled?: boolean;
  onSelectDate: (date: string) => void;
}

const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'];

function parseDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatPnl(value: number): string {
  return new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2, signDisplay: 'exceptZero' }).format(value);
}

export function TradeCalendarPicker({ days, selectedDate, disabled = false, onSelectDate }: TradeCalendarPickerProps) {
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => parseDate(selectedDate ?? days.at(-1)?.date ?? dateKey(new Date())));
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const daysByDate = useMemo(() => new Map(days.map((day) => [day.date, day])), [days]);

  useEffect(() => {
    if (selectedDate) setVisibleMonth(parseDate(selectedDate));
  }, [selectedDate]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const focusTarget = popoverRef.current?.querySelector<HTMLButtonElement>('.trade-calendar-day.is-selected')
      ?? popoverRef.current?.querySelector<HTMLButtonElement>('.trade-calendar-day.is-enabled');
    focusTarget?.focus();
  }, [open]);

  const cells = useMemo(() => {
    const year = visibleMonth.getFullYear();
    const month = visibleMonth.getMonth();
    const first = new Date(year, month, 1);
    const leading = (first.getDay() + 6) % 7;
    const count = new Date(year, month + 1, 0).getDate();
    const populated = [
      ...Array.from({ length: leading }, () => null),
      ...Array.from({ length: count }, (_, index) => new Date(year, month, index + 1)),
    ];
    return [...populated, ...Array.from({ length: 42 - populated.length }, () => null)];
  }, [visibleMonth]);

  function moveMonth(offset: number) {
    setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  }

  return <div className="trade-calendar-picker" ref={containerRef}>
    <button
      ref={triggerRef}
      type="button"
      className="calendar-trigger"
      aria-label="거래일 달력 열기"
      aria-expanded={open}
      aria-haspopup="dialog"
      disabled={disabled || days.length === 0}
      onClick={() => setOpen((current) => !current)}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M7 2v3M17 2v3M3.5 9h17M5 4h14a1.5 1.5 0 0 1 1.5 1.5v14A1.5 1.5 0 0 1 19 21H5a1.5 1.5 0 0 1-1.5-1.5v-14A1.5 1.5 0 0 1 5 4Z"/><path d="M7 12h2M11 12h2M15 12h2M7 16h2M11 16h2M15 16h2"/></svg>
    </button>
    {open ? <div className="trade-calendar-popover" role="dialog" aria-modal="false" aria-label="거래일 선택 달력" ref={popoverRef}>
      <header className="trade-calendar-header">
        <button type="button" aria-label="이전 달" onClick={() => moveMonth(-1)}>‹</button>
        <strong>{visibleMonth.getFullYear()}년 {visibleMonth.getMonth() + 1}월</strong>
        <button type="button" aria-label="다음 달" onClick={() => moveMonth(1)}>›</button>
      </header>
      <div className="trade-calendar-legend"><span>진입: 개별 단위</span><span>매매: 묶음 단위</span></div>
      <div className="trade-calendar-grid">
        {WEEKDAYS.map((weekday) => <span className="trade-calendar-weekday" aria-hidden="true" key={weekday}>{weekday}</span>)}
        {cells.map((date, index) => {
          if (!date) return <span className="trade-calendar-empty" aria-hidden="true" key={`empty-${index}`} />;
          const key = dateKey(date);
          const summary = daysByDate.get(key);
          if (!summary) return <span className="trade-calendar-day is-disabled" aria-disabled="true" key={key}><span>{date.getDate()}</span></span>;
          const pnlClass = summary.realizedPnl > 0 ? 'is-positive' : summary.realizedPnl < 0 ? 'is-negative' : 'is-flat';
          return <button
            type="button"
            className={`trade-calendar-day is-enabled${selectedDate === key ? ' is-selected' : ''}`}
            aria-label={`${key}, 매매 ${summary.campaignCount}개, 진입 ${summary.tradeCount}개, 손익 ${formatPnl(summary.realizedPnl)}`}
            aria-current={selectedDate === key ? 'date' : undefined}
            key={key}
            onClick={() => { onSelectDate(key); setOpen(false); triggerRef.current?.focus(); }}
          >
            <span className="trade-calendar-date">{date.getDate()}</span>
            <span className="trade-calendar-counts"><span>매매 {summary.campaignCount}</span><span>진입 {summary.tradeCount}</span></span>
            <span className={`trade-calendar-pnl ${pnlClass}`}>{formatPnl(summary.realizedPnl)}</span>
          </button>;
        })}
      </div>
    </div> : null}
  </div>;
}
