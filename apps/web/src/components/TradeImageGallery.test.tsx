import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TradeImageGallery } from './TradeImageGallery';

afterEach(() => cleanup());
const image = (id: string, position: number) => ({ id, position, fileName: `${id}.webp`, mimeType: 'image/webp', byteSize: 1, width: 1, height: 1, originalName: null, createdAt: '', updatedAt: '' });

describe('TradeImageGallery upload recovery', () => {
  it('reuses one upload ID for the automatic retry, then preserves preview, reason, and manual retry without another automatic attempt', async () => {
    const onUpload = vi.fn()
      .mockRejectedValueOnce(new Error('temporary network failure'))
      .mockRejectedValueOnce(new Error('publication failed'))
      .mockRejectedValueOnce(new Error('manual retry failed'));
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValueOnce('blob:failed-chart').mockReturnValueOnce('blob:replacement-chart');
    const revoke = vi.spyOn(URL, 'revokeObjectURL');

    const { unmount } = render(<TradeImageGallery campaignId="campaign-1" symbol="EURUSD" images={[]} imageUrl={() => '/image'} onUpload={onUpload} onReorder={async () => undefined} onDelete={async () => undefined} />);
    const file = new File(['chart'], 'chart.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('이미지 추가'), { target: { files: [file] } });

    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(2));
    const automaticUploadId = onUpload.mock.calls[0][2];
    expect(onUpload.mock.calls[1][2]).toBe(automaticUploadId);
    expect(screen.getByRole('alert')).toHaveTextContent('publication failed');
    expect(screen.getByAltText('업로드에 실패한 이미지 미리보기')).toHaveAttribute('src', 'blob:failed-chart');

    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(3));
    expect(onUpload.mock.calls[2][2]).toBe(automaticUploadId);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('manual retry failed'));
    expect(revoke).toHaveBeenCalledWith('blob:failed-chart');
    expect(screen.getByAltText('업로드에 실패한 이미지 미리보기')).toHaveAttribute('src', 'blob:replacement-chart');
    expect(onUpload).toHaveBeenCalledTimes(3);
    unmount();
    expect(revoke).toHaveBeenCalledWith('blob:replacement-chart');
    createObjectURL.mockRestore();
  });

  it('renders populated ordinals, honors move boundaries, and sends reordered IDs', async () => {
    const onReorder = vi.fn().mockResolvedValue(undefined);
    render(<TradeImageGallery campaignId="campaign-1" symbol="EURUSD" images={[image('two', 1), image('one', 0)] as any} imageUrl={(_, id) => `/${id}`} onUpload={async () => undefined} onReorder={onReorder} onDelete={async () => undefined} />);

    expect(screen.getByAltText('EURUSD 거래 차트 1')).toHaveAttribute('src', '/one');
    expect(screen.getByRole('button', { name: '이미지 1 왼쪽으로 이동' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '이미지 2 오른쪽으로 이동' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '이미지 1 오른쪽으로 이동' }));
    await waitFor(() => expect(onReorder).toHaveBeenCalledWith('campaign-1', ['two', 'one']));
  });

  it('uploads multiple selected images in order', async () => {
    const onUpload = vi.fn().mockResolvedValue(undefined);
    render(<TradeImageGallery campaignId="campaign-1" symbol="EURUSD" images={[]} imageUrl={() => '/image'} onUpload={onUpload} onReorder={async () => undefined} onDelete={async () => undefined} />);
    const first = new File(['first'], 'first.png', { type: 'image/png' });
    const second = new File(['second'], 'second.jpg', { type: 'image/jpeg' });

    fireEvent.change(screen.getByLabelText('이미지 추가'), { target: { files: [first, second] } });

    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(2));
    expect(onUpload.mock.calls[0]?.slice(0, 2)).toEqual(['campaign-1', first]);
    expect(onUpload.mock.calls[1]?.slice(0, 2)).toEqual(['campaign-1', second]);
  });
  it('uploads pasted images and enforces the ten-image cap', async () => {
    const onUpload = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<TradeImageGallery campaignId="campaign-1" symbol="EURUSD" images={[]} imageUrl={() => '/image'} onUpload={onUpload} onReorder={async () => undefined} onDelete={async () => undefined} />);
    const file = new File(['chart'], 'pasted.png', { type: 'image/png' });
    fireEvent.paste(screen.getByLabelText('EURUSD 거래 이미지'), { clipboardData: { files: [file] } });
    await waitFor(() => expect(onUpload).toHaveBeenCalledWith('campaign-1', file, expect.any(String)));

    rerender(<TradeImageGallery campaignId="campaign-1" symbol="EURUSD" images={Array.from({ length: 10 }, (_, index) => image(String(index), index)) as any} imageUrl={() => '/image'} onUpload={onUpload} onReorder={async () => undefined} onDelete={async () => undefined} />);
    expect(screen.getByText('최대 10장').parentElement?.querySelector('input')).toBeDisabled();
    fireEvent.paste(screen.getByLabelText('EURUSD 거래 이미지'), { clipboardData: { files: [file] } });
    expect(onUpload).toHaveBeenCalledTimes(1);
  });

  it('clears failed preview state and revokes its blob URL after a successful retry', async () => {
    const onUpload = vi.fn().mockRejectedValueOnce(new Error('failed')).mockRejectedValueOnce(new Error('failed')).mockResolvedValueOnce(undefined);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:recovered');
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    render(<TradeImageGallery campaignId="campaign-1" symbol="EURUSD" images={[]} imageUrl={() => '/image'} onUpload={onUpload} onReorder={async () => undefined} onDelete={async () => undefined} />);
    fireEvent.change(screen.getByLabelText('이미지 추가'), { target: { files: [new File(['chart'], 'chart.png', { type: 'image/png' })] } });
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(revoke).toHaveBeenCalledWith('blob:recovered');
  });
});
