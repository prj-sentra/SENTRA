import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TradeAnalysisEditor } from './TradeAnalysisEditor';

afterEach(() => cleanup());

const trade = {
  id: 'trade-1',
  analysis: {
    schemaVersion: 3, updatedAt: '2026-08-10T12:00:00.000Z', createdAt: '2026-08-10T11:00:00.000Z',
    baseTimeframe: null, bollingerBandCount: null, bollingerDirection: null,
  },
} as any;
const campaign = {
  id: 'campaign-1',
  analysis: {
    schemaVersion: 1, updatedAt: '2026-08-10T12:30:00.000Z', createdAt: '2026-08-10T11:00:00.000Z',
    primaryTrend: null, maTimeframes: {},
    marketZoneEnabled: false, marketZoneHigh: null, marketZoneLow: null, chartPatternObserved: false, chartPatternTimeframe: null, chartPatternType: null,
    retailPositionEnabled: false, retailBuyAveragePrice: null, retailSellAveragePrice: null, retailBuyRatio: null, fibonacciEnabled: false, fibonacciStartPrice: null, fibonacciEndPrice: null,
    economicIndicators: [],
  },
} as any;

describe('TradeAnalysisEditor', () => {
  it('keeps conditional fields visible and toggles their disabled state', () => {
    render(<TradeAnalysisEditor trade={trade} campaign={campaign} scope="campaign" onSave={vi.fn()} onSaveCampaign={vi.fn()} />);

    const groups = screen.getAllByRole('group');
    expect(groups.map((group) => group.textContent)).toEqual(expect.arrayContaining([
      expect.stringContaining('이동평균선 & 차트 패턴'),
      expect.stringContaining('매물대'),
      expect.stringContaining('개미 포지션'),
      expect.stringContaining('정추세 피보나치'),
      expect.stringContaining('경제지표'),
    ]));
    expect(screen.getAllByRole('button').some((button) => button.getAttribute('title')?.includes('시간 프레임'))).toBe(true);
    expect(screen.getByLabelText('15m 이동평균선 배열')).toHaveValue('congested');
    expect(screen.getByLabelText('1MN 20-60 이동평균선 크로스')).toBeInTheDocument();
    expect(screen.getByLabelText('1MN 20-120 이동평균선 크로스')).toBeInTheDocument();
    expect(screen.getByLabelText('추세')).toBeInTheDocument();
    expect(screen.getByLabelText('15m 차트 패턴')).toHaveTextContent('없음더블탑더블바텀헤드앤숄더역헤드앤숄더');
    expect(screen.getByLabelText('기준 매물대 윗 가격')).toBeDisabled();

    fireEvent.click(screen.getByLabelText('매물대 사용'));
    expect(screen.getByLabelText('기준 매물대 윗 가격')).toBeEnabled();
    const group = (title: string) => screen.getAllByRole('group').find((item) => item.querySelector('legend')?.textContent?.startsWith(title));
    expect(group('이동평균선 & 차트 패턴')).toBeInTheDocument();
    expect(group('매물대')).toHaveClass('analysis-row-3-columns');
    fireEvent.click(screen.getByLabelText('개미 포지션 사용'));
    fireEvent.click(screen.getByLabelText('정추세 피보나치 사용'));
    expect(group('개미 포지션')).toHaveClass('analysis-row-4-columns');
    expect(group('정추세 피보나치')).toHaveClass('analysis-row-3-columns');
  });

  it('adds and removes compact economic indicator rows', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<TradeAnalysisEditor trade={trade} campaign={campaign} scope="campaign" onSave={vi.fn()} onSaveCampaign={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /\+\s*경제지표 추가/ }));
    expect(screen.getByLabelText('경제지표 1 이름')).toHaveAttribute('placeholder', '예: CPI, FOMC');
    expect(screen.getByLabelText('경제지표 1 발표 시간')).toHaveAttribute('type', 'datetime-local');
    expect(screen.getByLabelText('경제지표 1 결과')).toHaveClass('indicator-impact', 'positive');
    fireEvent.click(screen.getByRole('button', { name: '경제지표 1 삭제' }));
    expect(screen.queryByLabelText('경제지표 1 이름')).toBeNull();
    expect(confirm).toHaveBeenCalledOnce();
    confirm.mockRestore();
  });

  it('shows target prices, return and risk, and a prominent RR in three columns', () => {
    const { container } = render(<TradeAnalysisEditor trade={{ ...trade, returnPercent: 6.25, riskPercent: 2.5, rr: 2.5 }} onSave={vi.fn()} />);

    const row = container.querySelector('.target-price-row')!;
    expect(row.querySelector('.target-price-inputs')).toContainElement(screen.getByLabelText('TP 가격'));
    expect(screen.getByText('Return 비율').nextElementSibling).toHaveTextContent('6.25%');
    expect(screen.getByText('Risk 비율').nextElementSibling).toHaveTextContent('2.50%');
    expect(screen.getByText('RR').nextElementSibling).toHaveTextContent('1:2.50');
    expect(screen.getByLabelText('Return 비율').tagName).toBe('OUTPUT');
    expect(row.querySelector('input[aria-label="Return 비율"]')).toBeNull();
  });

  it('shows violation details only when a plan violation is selected', () => {
    render(<TradeAnalysisEditor trade={trade} onSave={vi.fn()} />);

    expect(screen.queryByLabelText('계획 외 추가 진입')).toBeNull();
    fireEvent.change(screen.getByLabelText('평가'), { target: { value: 'plan_violated' } });
    expect(screen.getByLabelText('계획 외 추가 진입')).toBeInTheDocument();
    expect(screen.getByLabelText('손절 계획 위반')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('그 밖의 계획 위반 내용을 입력하세요.')).toBeInTheDocument();
  });
  it('saves a canonical patch with the trade analysis version used for optimistic concurrency', () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<TradeAnalysisEditor trade={trade} onSave={onSave} />);

    fireEvent.change(screen.getByLabelText('기준봉'), { target: { value: '1h' } });
    fireEvent.submit(screen.getByLabelText('기준봉').closest('form')!);

    expect(onSave).toHaveBeenCalledWith('trade-1', {
      baseTimeframe: '1h',
      bollingerBandCount: null,
      bollingerDirection: null,
      executionEvaluation: null,
      unplannedAdditionalEntry: false,
      excessiveSize: false,
      stopLossViolation: false,
      earlyExit: false,
      lateExit: false,
      otherViolation: null,
      expectedUpdatedAt: '2026-08-10T12:00:00.000Z',
      plannedStopLossPrice: null,
      plannedTakeProfitPrice: null,
    });
  });
});
