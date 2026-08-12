import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  updatedAt: '2026-08-10T12:00:00.000Z',
} as any;

describe('TradeRecordCard memo preview', () => {
  it('uses the required-writing fallback and clamp hook without showing execution TP or SL', () => {
    render(<TradeRecordCard
      campaign={campaign}
      imageUrl={vi.fn()}
      onPatchAnalysis={vi.fn()}
      onPatchMemo={vi.fn()}
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
    expect(screen.getByText('매매 전후 시드 변화 / 비율')).toBeInTheDocument();
    expect(screen.getByText('포인트 (PnL / 수량; 1랏 기준 PnL)')).toBeInTheDocument();
    expect(screen.queryByText('PnL')).toBeNull();
  });

  it('stacks the hyphenated trade period below the split-trade label', () => {
    const { container } = render(<TradeRecordCard
      campaign={{
        ...campaign,
        openedAt: '2026-08-10T01:00:00.000Z',
        closedAt: '2026-08-10T02:00:00.000Z',
        members: [{}, {}],
      }}
      imageUrl={vi.fn()}
      onPatchAnalysis={vi.fn()}
      onPatchMemo={vi.fn()}
      onUploadImage={vi.fn()}
      onReorderImages={vi.fn()}
      onDeleteImage={vi.fn()}
    />);

    const meta = container.querySelector('.trade-header-meta')!;
    expect(meta.firstElementChild).toHaveTextContent('2건 분할 진입');
    expect(meta.lastElementChild).toHaveTextContent(/26\. 8\. 10\..* - 26\. 8\. 10\./);
    expect(meta).not.toHaveTextContent('→');
  });

  it('edits one memo for the whole campaign', () => {
    render(<TradeRecordCard
      campaign={{ ...campaign, memo: '첫 번째 줄\n두 번째 줄' }}
      imageUrl={vi.fn()}
      onPatchAnalysis={vi.fn()}
      onPatchMemo={vi.fn()}
      onUploadImage={vi.fn()}
      onReorderImages={vi.fn()}
      onDeleteImage={vi.fn()}
    />);

    fireEvent.click(screen.getByRole('button', { name: '상세 보기' }));
    const memo = screen.getByLabelText('매매 메모') as HTMLTextAreaElement;
    expect(memo.value).toBe('첫 번째 줄\n두 번째 줄');
  });

  it('confirms save and cancel actions, refreshes content, and keeps details open', async () => {
    const onPatchMemo = vi.fn().mockResolvedValue(undefined);
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<TradeRecordCard
      campaign={{ ...campaign, memo: '기존 메모' }}
      imageUrl={vi.fn()}
      onPatchAnalysis={vi.fn()}
      onPatchMemo={onPatchMemo}
      onRefresh={onRefresh}
      onUploadImage={vi.fn()}
      onReorderImages={vi.fn()}
      onDeleteImage={vi.fn()}
    />);

    fireEvent.click(screen.getByRole('button', { name: '상세 보기' }));
    fireEvent.change(screen.getByLabelText('매매 메모'), { target: { value: '변경 메모' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(onPatchMemo).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: '간단하게 ▲' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('매매 메모'), { target: { value: '취소할 메모' } });
    fireEvent.click(screen.getByRole('button', { name: '변경사항 취소' }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
    expect(screen.getByLabelText('매매 메모')).toHaveValue('기존 메모');
    expect(screen.getByRole('button', { name: '간단하게 ▲' })).toBeInTheDocument();
    expect(confirm).toHaveBeenCalledTimes(2);
    confirm.mockRestore();
  });

  it('asks to save dirty fields before collapsing and saves them when confirmed', async () => {
    const onPatchMemo = vi.fn().mockResolvedValue(undefined);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<TradeRecordCard
      campaign={{ ...campaign, memo: '기존 메모' }}
      imageUrl={vi.fn()}
      onPatchAnalysis={vi.fn()}
      onPatchMemo={onPatchMemo}
      onUploadImage={vi.fn()}
      onReorderImages={vi.fn()}
      onDeleteImage={vi.fn()}
    />);

    fireEvent.click(screen.getByRole('button', { name: '상세 보기' }));
    fireEvent.change(screen.getByLabelText('매매 메모'), { target: { value: '저장할 메모' } });
    fireEvent.click(screen.getByRole('button', { name: '간단하게 ▲' }));
    expect(screen.getByRole('button', { name: '간단하게 ▲' })).toBeInTheDocument();
    expect(onPatchMemo).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '간단하게 ▲' }));
    await waitFor(() => expect(onPatchMemo).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: '상세 보기' })).toBeInTheDocument();
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('저장하고'));
    confirm.mockRestore();
  });

  it('opens the complete image viewer from the summary cover', () => {
    render(<TradeRecordCard
      campaign={{ ...campaign, images: [{ id: 'second', position: 1 }, { id: 'first', position: 0 }] }}
      imageUrl={(_, imageId) => `/${imageId}.webp`}
      onPatchAnalysis={vi.fn()}
      onPatchMemo={vi.fn()}
      onUploadImage={vi.fn()}
      onReorderImages={vi.fn()}
      onDeleteImage={vi.fn()}
    />);

    fireEvent.click(screen.getByRole('button', { name: 'XAUUSD 매매 이미지 전체 보기' }));
    expect(screen.getByRole('dialog', { name: 'Trade image preview' })).toBeInTheDocument();
    expect(screen.getByAltText('XAUUSD 매매 차트 1')).toHaveAttribute('src', '/first.webp');

    fireEvent.click(screen.getByRole('button', { name: 'Next image' }));
    expect(screen.getByAltText('XAUUSD 매매 차트 2')).toHaveAttribute('src', '/second.webp');
  });
});
