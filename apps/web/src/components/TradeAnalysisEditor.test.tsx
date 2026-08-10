import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TradeAnalysisEditor } from './TradeAnalysisEditor';

afterEach(() => cleanup());

const trade = {
  id: 'trade-1',
  analysis: {
    schemaVersion: 1, updatedAt: '2026-08-10T12:00:00.000Z', createdAt: '2026-08-10T11:00:00.000Z',
    baseTimeframe: null, primaryTrend: null, bollingerBandCount: null, bollingerDirection: null, maArrangement: null, cross: null, stopLossLine: null,
    marketZoneEnabled: false, marketZoneHigh: null, marketZoneLow: null, chartPatternObserved: false, chartPatternTimeframe: null, chartPatternType: null,
    retailPositionEnabled: false, retailBuyAveragePrice: null, retailSellAveragePrice: null, retailBuyRatio: null, fibonacciEnabled: false, fibonacciStartPrice: null, fibonacciEndPrice: null,
    economicIndicators: [],
  },
} as any;

describe('TradeAnalysisEditor', () => {
  it('lists analysis rows in order, exposes tooltips, and only reveals enabled conditional fields', () => {
    render(<TradeAnalysisEditor trade={trade} onSave={vi.fn()} />);

    const groups = screen.getAllByRole('group');
    expect(groups.map((group) => group.textContent)).toEqual(expect.arrayContaining([
      expect.stringContaining('기준봉 · 추세'),
      expect.stringContaining('볼린저밴드'),
      expect.stringContaining('이동평균선'),
      expect.stringContaining('차트 패턴'),
      expect.stringContaining('매물대'),
      expect.stringContaining('개미 포지션'),
      expect.stringContaining('정추세 피보나치'),
      expect.stringContaining('경제지표'),
    ]));
    expect(screen.getAllByRole('button').some((button) => button.getAttribute('title')?.includes('시간 프레임'))).toBe(true);
    expect(screen.queryByLabelText('패턴 기준봉')).toBeNull();
    expect(screen.queryByLabelText('기준 매물대 윗 가격')).toBeNull();

    fireEvent.click(screen.getByLabelText('차트 패턴 사용'));
    fireEvent.click(screen.getByLabelText('매물대 사용'));
    expect(screen.getByLabelText('패턴 기준봉')).toBeInTheDocument();
    expect(screen.getByLabelText('기준 매물대 윗 가격')).toBeInTheDocument();
  });

  it('saves a canonical patch with the trade analysis version used for optimistic concurrency', () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<TradeAnalysisEditor trade={trade} onSave={onSave} />);

    fireEvent.change(screen.getByLabelText('기준봉'), { target: { value: '1h' } });
    fireEvent.click(screen.getByRole('button', { name: '분석 저장' }));

    expect(onSave).toHaveBeenCalledWith('trade-1', expect.objectContaining({
      baseTimeframe: '1h',
      expectedUpdatedAt: '2026-08-10T12:00:00.000Z',
      marketZoneHigh: null,
      chartPatternTimeframe: null,
    }));
  });
});
