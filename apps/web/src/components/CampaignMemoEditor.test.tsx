import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CampaignMemoEditor } from './CampaignMemoEditor';

describe('CampaignMemoEditor', () => {
  it('saves one campaign memo with its optimistic concurrency token', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<CampaignMemoEditor campaign={{
      id: 'campaign-1', memo: '기존 메모', updatedAt: '2026-08-10T12:00:00.000Z',
    } as any} onSave={onSave} />);

    fireEvent.change(screen.getByLabelText('거래 메모'), { target: { value: '새 메모' } });
    fireEvent.click(screen.getByRole('button', { name: '메모 저장' }));

    expect(onSave).toHaveBeenCalledWith('campaign-1', {
      memo: '새 메모', expectedUpdatedAt: '2026-08-10T12:00:00.000Z',
    });
  });
});
