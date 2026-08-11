import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CampaignMemoEditor } from './CampaignMemoEditor';

describe('CampaignMemoEditor', () => {
  it('saves one campaign memo with its optimistic concurrency token', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onSaveAnalysis = vi.fn().mockResolvedValue(undefined);
    render(<CampaignMemoEditor campaign={{
      id: 'campaign-1', memo: '기존 메모', updatedAt: '2026-08-10T12:00:00.000Z',
      analysis: { updatedAt: '2026-08-10T11:00:00.000Z' },
    } as any} onSave={onSave} onSaveAnalysis={onSaveAnalysis} />);

    fireEvent.change(screen.getByLabelText('거래 메모'), { target: { value: '새 메모' } });
    fireEvent.change(screen.getByLabelText('진입 근거'), { target: { value: '추세 눌림 진입' } });
    fireEvent.change(screen.getByLabelText('거래 점수'), { target: { value: '8' } });
    fireEvent.submit(screen.getByLabelText('거래 메모').closest('form')!);

    expect(onSave).toHaveBeenCalledWith('campaign-1', {
      memo: '새 메모', expectedUpdatedAt: '2026-08-10T12:00:00.000Z',
    });
    await waitFor(() => expect(onSaveAnalysis).toHaveBeenCalledWith('campaign-1', expect.objectContaining({
      expectedUpdatedAt: '2026-08-10T11:00:00.000Z',
      entryReason: '추세 눌림 진입',
      tradeScore: 8,
    })));
  });
});
