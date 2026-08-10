import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TradeAnalysisEditor } from './TradeAnalysisEditor';

afterEach(() => cleanup());

const trade = {
  id: 'trade-1',
  analysis: {
    schemaVersion: 1, updatedAt: '2026-08-10T12:00:00.000Z', createdAt: '2026-08-10T11:00:00.000Z', note: null, regret: null,
    baseTimeframe: null, primaryTrend: null, bollingerBandCount: null, bollingerDirection: null, maArrangement: null, cross: null, stopLossLine: null,
    marketZoneEnabled: false, marketZoneHigh: null, marketZoneLow: null, chartPatternObserved: false, chartPatternTimeframe: null, chartPatternType: null,
    retailPositionEnabled: false, retailBuyAveragePrice: null, retailSellAveragePrice: null, retailBuyRatio: null, fibonacciEnabled: false, fibonacciStartPrice: null, fibonacciEndPrice: null,
    economicIndicators: [],
  },
} as any;

describe('TradeAnalysisEditor', () => {
  it('groups analysis controls into their labeled regions and only reveals enabled conditional fields', () => {
    render(<TradeAnalysisEditor trade={trade} onSave={vi.fn()} />);

    const technical = screen.getByRole('group', { name: '기술적 분석' });
    const market = screen.getByRole('group', { name: '시장' });
    expect(within(technical).getByLabelText('차트 패턴 사용')).toBeInTheDocument();
    expect(within(market).getByLabelText('매물대 사용')).toBeInTheDocument();
    expect(screen.queryByLabelText('패턴 기준봉')).toBeNull();
    expect(screen.queryByLabelText('매물대 윗 가격')).toBeNull();

    fireEvent.click(within(technical).getByLabelText('차트 패턴 사용'));
    fireEvent.click(within(market).getByLabelText('매물대 사용'));
    expect(within(technical).getByLabelText('패턴 기준봉')).toBeInTheDocument();
    expect(within(market).getByLabelText('매물대 윗 가격')).toBeInTheDocument();
  });

  it('saves a canonical patch with the trade analysis version used for optimistic concurrency', () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<TradeAnalysisEditor trade={trade} onSave={onSave} />);

    fireEvent.change(screen.getByLabelText('통합 매매 노트'), { target: { value: 'note' } });
    fireEvent.click(screen.getByRole('button', { name: '분석 저장' }));

    expect(onSave).toHaveBeenCalledWith('trade-1', expect.objectContaining({
      note: 'note',
      expectedUpdatedAt: '2026-08-10T12:00:00.000Z',
      marketZoneHigh: null,
      chartPatternTimeframe: null,
    }));
  });
});
