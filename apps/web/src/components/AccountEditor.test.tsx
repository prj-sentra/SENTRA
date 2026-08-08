import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { AccountEditor } from './AccountEditor';

it('clears the write-only password after a failed save attempt', async () => {
  const onCreate = vi.fn().mockRejectedValue(new Error('failed'));
  render(<AccountEditor onCreate={onCreate} onUpdate={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Nickname'), { target: { value: 'Primary' } });
  fireEvent.change(screen.getByLabelText('Server'), { target: { value: 'Broker' } });
  fireEvent.change(screen.getByLabelText('Account login'), { target: { value: '42' } });
  const password = screen.getByLabelText('Read-only password');
  fireEvent.change(password, { target: { value: 'secret' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save account' }));
  await waitFor(() => expect(onCreate).toHaveBeenCalledOnce());
  await waitFor(() => expect(password).toHaveValue(''));
});
