import { useState, type FormEvent } from 'react';
import { ApiError, apiRequest } from '../api/client';

interface CredentialsSettingsProps {
  username: string;
  onCredentialsUpdated: () => void;
}

export function credentialErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return '계정 정보를 변경할 수 없습니다.';
  if (error.status === 409) return '이미 사용 중인 아이디입니다.';
  if (error.status === 403) return '현재 비밀번호가 올바르지 않습니다.';
  return '계정 정보를 변경할 수 없습니다.';
}

export function CredentialsSettings({ username: initialUsername, onCredentialsUpdated }: CredentialsSettingsProps) {
  const [username, setUsername] = useState(initialUsername);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError('새 비밀번호가 일치하지 않습니다.');
      return;
    }
    const body: { currentPassword: string; username?: string; newPassword?: string } = { currentPassword };
    if (username.trim() !== initialUsername) body.username = username;
    if (newPassword) body.newPassword = newPassword;
    if (body.username === undefined && body.newPassword === undefined) {
      setError('변경할 아이디 또는 비밀번호를 입력하세요.');
      return;
    }
    setSubmitting(true);
    try {
      await apiRequest('/auth/credentials', { method: 'PATCH', body: JSON.stringify(body) });
      onCredentialsUpdated();
    } catch (caught) {
      setError(credentialErrorMessage(caught));
    } finally {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSubmitting(false);
    }
  }

  return <section className="panel accounts-page">
    <form className="auth-form" onSubmit={submit}>
      <h2>계정 설정</h2>
      <p className="muted">아이디 또는 비밀번호를 변경하면 모든 기기에서 로그아웃됩니다.</p>
      <label><span>아이디</span><input autoComplete="username" minLength={3} maxLength={64} required value={username} onChange={(event) => setUsername(event.target.value)} /></label>
      <label><span>현재 비밀번호</span><input autoComplete="current-password" minLength={12} maxLength={256} required type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
      <label><span>새 비밀번호</span><input autoComplete="new-password" minLength={12} maxLength={256} type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
      <label><span>새 비밀번호 확인</span><input autoComplete="new-password" minLength={12} maxLength={256} type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
      {error ? <p className="error" role="alert">{error}</p> : null}
      <button className="primary-button" disabled={submitting} type="submit">{submitting ? '변경 중…' : '계정 정보 변경'}</button>
    </form>
  </section>;
}
