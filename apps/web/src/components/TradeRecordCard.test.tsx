import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TradeRecordCard } from './TradeRecordCard';

afterEach(() => cleanup());

const campaign = {
  id: 'campaign-1',
  symbol: 'XAUUSD',
  side: 'long',
  images: [],
  members: [],
  quantityLots: 1,
  realizedPnl: 125,
  exitReason: '목표가 도달',
  analysisComplete: false,
} as any;

describe('TradeRecordCard regret preview', () => {
  it('uses the required-writing fallback and clamp hook without showing execution TP or SL', () => {
    render(<TradeRecordCard
      campaign={campaign}
      imageUrl={vi.fn()}
      onPatchAnalysis={vi.fn()}
      onUploadImage={vi.fn()}
      onReorderImages={vi.fn()}
      onDeleteImage={vi.fn()}
    />);

    const previews = screen.getAllByText('작성 필요');
    expect(previews.some((preview) => preview.classList.contains('regret-preview'))).toBe(true);
    expect(screen.queryByText('초기 TP')).toBeNull();
    expect(screen.queryByText('초기 SL')).toBeNull();
    expect(screen.queryByText('청산 사유')).toBeNull();
    expect(screen.queryByText('목표가 도달')).toBeNull();
    expect(screen.getAllByText('Long')).toHaveLength(2);
    expect(screen.getAllByText('+125')).toHaveLength(2);
    expect(screen.getByText('평균 진입가 / 평균 청산가')).toBeInTheDocument();
    expect(screen.getByText('총 수량')).toBeInTheDocument();
    expect(screen.getByText('거래 전후 시드 변화 / 비율')).toBeInTheDocument();
    expect(screen.getByText('포인트 (PnL / 수량; 1랏 기준 PnL)')).toBeInTheDocument();
    expect(screen.queryByText('PnL')).toBeNull();
  });

  it('renders regret line breaks in a read-only textarea', () => {
    render(<TradeRecordCard
      campaign={{ ...campaign, regret: '첫 번째 줄\n두 번째 줄' }}
      imageUrl={vi.fn()}
      onPatchAnalysis={vi.fn()}
      onUploadImage={vi.fn()}
      onReorderImages={vi.fn()}
      onDeleteImage={vi.fn()}
    />);

    const regret = screen.getByLabelText('아쉬운 점') as HTMLTextAreaElement;
    expect(regret.readOnly).toBe(true);
    expect(regret.value).toBe('첫 번째 줄\n두 번째 줄');
  });

  it('opens the complete image viewer from the summary cover', () => {
    render(<TradeRecordCard
      campaign={{ ...campaign, images: [{ id: 'second', position: 1 }, { id: 'first', position: 0 }] }}
      imageUrl={(_, imageId) => `/${imageId}.webp`}
      onPatchAnalysis={vi.fn()}
      onUploadImage={vi.fn()}
      onReorderImages={vi.fn()}
      onDeleteImage={vi.fn()}
    />);

    fireEvent.click(screen.getByRole('button', { name: 'XAUUSD 거래 이미지 전체 보기' }));
    expect(screen.getByRole('dialog', { name: 'Trade image preview' })).toBeInTheDocument();
    expect(screen.getByAltText('XAUUSD 거래 차트 1')).toHaveAttribute('src', '/first.webp');

    fireEvent.click(screen.getByRole('button', { name: 'Next image' }));
    expect(screen.getByAltText('XAUUSD 거래 차트 2')).toHaveAttribute('src', '/second.webp');
  });
});
