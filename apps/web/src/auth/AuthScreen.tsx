import { useState, type FormEvent } from 'react';
import { apiRequest } from '../api/client';

export interface CurrentUser {
  id: string;
  username: string;
  status: 'ACTIVE' | 'PENDING' | 'DISABLED';
  isAdmin: boolean;
}

interface CredentialsFormProps { onAuthenticated: () => Promise<void>; }

export function LoginScreen({ onAuthenticated }: CredentialsFormProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSubmitting(true); setError(null);
    try {
      await apiRequest('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
      await onAuthenticated();
    } catch { setError('로그인할 수 없습니다. 입력 정보를 확인해 주세요.'); }
    finally { setPassword(''); setSubmitting(false); }
  }

  return <form className="auth-form" onSubmit={submit}>
    <h2>로그인</h2>
    <label><span>사용자 이름</span><input autoComplete="username" required value={username} onChange={(event) => setUsername(event.target.value)} /></label>
    <label><span>비밀번호</span><input autoComplete="current-password" minLength={12} required type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
    {error ? <p className="error" role="alert">{error}</p> : null}
    <button className="primary-button" disabled={submitting} type="submit">{submitting ? '확인 중…' : '로그인'}</button>
  </form>;
}

export function SignupPendingNotice() {
  return <div className="empty-state compact" role="status"><h3>가입 요청이 접수되었습니다.</h3><p>관리자 승인 후 로그인할 수 있습니다.</p></div>;
}

export function SignupScreen() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSubmitting(true);
    try { await apiRequest('/auth/signup', { method: 'POST', body: JSON.stringify({ username, password }) }); }
    catch { /* Deliberately indistinguishable to prevent account enumeration. */ }
    finally { setUsername(''); setPassword(''); setSubmitting(false); setAcknowledged(true); }
  }

  if (acknowledged) return <SignupPendingNotice />;
  return <form className="auth-form" onSubmit={submit}>
    <h2>가입 요청</h2>
    <label><span>사용자 이름</span><input autoComplete="username" minLength={3} required value={username} onChange={(event) => setUsername(event.target.value)} /></label>
    <label><span>비밀번호</span><input autoComplete="new-password" minLength={12} required type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
    <button className="primary-button" disabled={submitting} type="submit">{submitting ? '접수 중…' : '가입 요청'}</button>
  </form>;
}

export function AuthScreen({ onAuthenticated }: CredentialsFormProps) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  return <main className="shell auth-shell"><section className="panel auth-panel">
    <p className="eyebrow">S.E.N.T.R.A.</p><h1>Trading Journal</h1>
    <div className="tabs" role="tablist"><button className={mode === 'login' ? 'tab active' : 'tab'} onClick={() => setMode('login')} type="button">로그인</button><button className={mode === 'signup' ? 'tab active' : 'tab'} onClick={() => setMode('signup')} type="button">가입 요청</button></div>
    {mode === 'login' ? <LoginScreen onAuthenticated={onAuthenticated} /> : <SignupScreen />}
  </section></main>;
}
