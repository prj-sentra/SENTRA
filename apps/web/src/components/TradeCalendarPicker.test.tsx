import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TradeCalendarPicker } from './TradeCalendarPicker';

afterEach(cleanup);

const days = [
  { date: '2026-08-03', tradeCount: 3, campaignCount: 2, realizedPnl: 125.5 },
  { date: '2026-08-05', tradeCount: 1, campaignCount: 1, realizedPnl: -20 },
];

describe('TradeCalendarPicker', () => {
  it('shows summaries and allows selecting only recorded dates', () => {
    const onSelectDate = vi.fn();
    render(<TradeCalendarPicker days={days} selectedDate="2026-08-03" onSelectDate={onSelectDate} />);

    fireEvent.click(screen.getByRole('button', { name: '매매일 달력 열기' }));

    const weekdayLabels = screen.getAllByText(/^[일월화수목금토]$/);
    expect(weekdayLabels.map((label) => label.textContent)).toEqual(['일', '월', '화', '수', '목', '금', '토']);
    expect(weekdayLabels[0]).toHaveClass('is-sunday');
    expect(weekdayLabels[6]).toHaveClass('is-saturday');
    expect(screen.getByText('2')).toHaveClass('trade-calendar-date');
    expect(screen.getByText('2').closest('.trade-calendar-day')).toHaveClass('is-sunday');
    expect(screen.getByText('8').closest('.trade-calendar-day')).toHaveClass('is-saturday');
    expect(screen.getByRole('button', { name: /2026-08-03, 매매 2개, 진입 3개, 손익 \+125.5/ })).toHaveFocus();
    expect(screen.getByText('매매 2, 진입 3')).toBeInTheDocument();
    expect(screen.getByText('+125.5')).toHaveClass('is-positive');
    expect(screen.getByText('-20')).toHaveClass('is-negative');
    expect(screen.queryByRole('button', { name: /2026-08-04/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /2026-08-05/ }));
    expect(onSelectDate).toHaveBeenCalledWith('2026-08-05');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '매매일 달력 열기' })).toHaveFocus();
  });

  it('closes with Escape and supports month navigation', () => {
    render(<TradeCalendarPicker days={days} selectedDate="2026-08-03" onSelectDate={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: '매매일 달력 열기' });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: '다음 달' }));
    expect(screen.getByText('2026년 9월')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
