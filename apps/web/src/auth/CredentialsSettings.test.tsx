import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError, apiRequest } from '../api/client';
import { credentialErrorMessage, CredentialsSettings } from './CredentialsSettings';

vi.mock('../api/client', async (importOriginal) => ({
  ...await importOriginal<typeof import('../api/client')>(),
  apiRequest: vi.fn(),
}));
const request = vi.mocked(apiRequest);

beforeEach(() => request.mockReset());
afterEach(cleanup);

it('submits changed credentials and reports success to the app', async () => {
  request.mockResolvedValue({ status: 'credentials_updated' });
  const onCredentialsUpdated = vi.fn();
  render(<CredentialsSettings username="person" onCredentialsUpdated={onCredentialsUpdated} />);

  fireEvent.change(screen.getByLabelText('아이디'), { target: { value: 'new-person' } });
  fireEvent.change(screen.getByLabelText('현재 비밀번호'), { target: { value: 'long-enough-password' } });
  fireEvent.change(screen.getByLabelText('새 비밀번호'), { target: { value: 'new-long-enough-password' } });
  fireEvent.change(screen.getByLabelText('새 비밀번호 확인'), { target: { value: 'new-long-enough-password' } });
  fireEvent.click(screen.getByRole('button', { name: '계정 정보 변경' }));

  await waitFor(() => expect(request).toHaveBeenCalledWith('/auth/credentials', {
    method: 'PATCH',
    body: JSON.stringify({ currentPassword: 'long-enough-password', username: 'new-person', newPassword: 'new-long-enough-password' }),
  }));
  expect(onCredentialsUpdated).toHaveBeenCalledOnce();
});

it('blocks mismatched new passwords without sending a request', () => {
  render(<CredentialsSettings username="person" onCredentialsUpdated={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('현재 비밀번호'), { target: { value: 'long-enough-password' } });
  fireEvent.change(screen.getByLabelText('새 비밀번호'), { target: { value: 'new-long-enough-password' } });
  fireEvent.change(screen.getByLabelText('새 비밀번호 확인'), { target: { value: 'different-long-password' } });
  fireEvent.click(screen.getByRole('button', { name: '계정 정보 변경' }));

  expect(screen.getByRole('alert')).toHaveTextContent('새 비밀번호가 일치하지 않습니다.');
  expect(request.mock.calls.some(([path]) => path === '/auth/credentials')).toBe(false);
});

it('maps an incorrect current password without treating it as an expired session', () => {
  expect(credentialErrorMessage(new ApiError(403))).toBe('현재 비밀번호가 올바르지 않습니다.');
});
