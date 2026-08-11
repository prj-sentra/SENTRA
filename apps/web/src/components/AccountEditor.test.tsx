import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { AccountEditor } from './AccountEditor';

it('clears the write-only password after a failed save attempt', async () => {
  const onCreate = vi.fn().mockRejectedValue(new Error('failed'));
  render(<AccountEditor onCreate={onCreate} onUpdate={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('닉네임'), { target: { value: 'Primary' } });
  fireEvent.change(screen.getByLabelText('서버'), { target: { value: 'Broker' } });
  fireEvent.change(screen.getByLabelText('계좌번호'), { target: { value: '42' } });
  const password = screen.getByLabelText('조회 전용 비밀번호');
  fireEvent.change(password, { target: { value: 'secret' } });
  fireEvent.click(screen.getByRole('button', { name: '계정 저장' }));
  await waitFor(() => expect(onCreate).toHaveBeenCalledOnce());
  await waitFor(() => expect(password).toHaveValue(''));
});
