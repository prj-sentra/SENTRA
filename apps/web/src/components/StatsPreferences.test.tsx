import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { TradeStatsPreferences } from '@trading-journal/shared';
import { afterEach, expect, it, vi } from 'vitest';
import { StatsPreferences } from './StatsPreferences';

const preferences: TradeStatsPreferences = {
  breakevenPercent: 1,
  timeZone: 'America/New_York',
  tradingDayStartMinutes: 120,
  sessions: {
    asia: { startMinutes: 0, endMinutes: 480 },
    london: { startMinutes: 480, endMinutes: 1020 },
    'new-york': { startMinutes: 480, endMinutes: 1020 },
  },
  display: {
    timeZone: 'Asia/Seoul',
    utcOffsetMinutes: 540,
    tradingDayStartLabel: '11:00',
    sessions: {
      asia: { startLabel: '09:00', endLabel: '17:00' },
      london: { startLabel: '17:00', endLabel: '02:00' },
      'new-york': { startLabel: '22:00', endLabel: '07:00' },
    },
  },
};

afterEach(cleanup);

it('explains the analysis timezone and restores the documented defaults', () => {
  render(<StatsPreferences preferences={preferences} request={vi.fn()} />);
  expect(screen.getByText('IANA 분석 시간대')).toHaveAttribute('data-tooltip', expect.stringContaining('IANA 표준 시간대'));
  fireEvent.click(screen.getByRole('button', { name: '환경설정 초기화' }));
  expect(screen.getByLabelText('시드 대비 본절 기준')).toHaveValue(0.1);
  expect(screen.getByLabelText('분석 시간대')).toHaveValue('Asia/Seoul');
  expect(screen.getByLabelText('거래일 시작 시간')).toHaveValue('00:00');
  expect(screen.getByLabelText('asia 시작')).toHaveValue('09:00');
  expect(screen.getByLabelText('asia 종료')).toHaveValue('15:30');
  expect(screen.getByLabelText('london 종료')).toHaveValue('16:30');
  expect(screen.getByLabelText('new-york 시작')).toHaveValue('09:30');
  expect(screen.getByLabelText('new-york 종료')).toHaveValue('16:00');
});
