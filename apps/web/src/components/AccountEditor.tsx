import { useEffect, useState, type FormEvent } from 'react';
import type { CreateMt5AccountRequest, SafeMt5AccountRef, UpdateMt5AccountRequest } from '@trading-journal/shared';

export interface AccountEditorProps {
  account?: SafeMt5AccountRef;
  busy?: boolean;
  onCreate: (request: CreateMt5AccountRequest) => Promise<void>;
  onUpdate: (accountId: string, request: UpdateMt5AccountRequest) => Promise<void>;
  onCancel?: () => void;
}

interface FormState { nickname: string; server: string; accountLogin: string; password: string }

const blankForm = (): FormState => ({ nickname: '', server: '', accountLogin: '', password: '' });

export function AccountEditor({ account, busy = false, onCreate, onUpdate, onCancel }: AccountEditorProps) {
  const [form, setForm] = useState<FormState>(blankForm);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    setForm(account ? { nickname: account.nickname, server: account.server, accountLogin: String(account.accountLogin), password: '' } : blankForm());
    setStatus(null);
  }, [account]);

  function patch(next: Partial<FormState>): void {
    setForm((current) => ({ ...current, ...next }));
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setStatus(null);
    const accountLogin = Number(form.accountLogin);
    try {
      if (!Number.isSafeInteger(accountLogin) || accountLogin <= 0) throw new Error('Enter a valid account login.');
      if (account) {
        const request: UpdateMt5AccountRequest = {
          nickname: form.nickname.trim(),
          server: form.server.trim(),
          accountLogin,
          ...(form.password ? { password: form.password } : {}),
        };
        await onUpdate(account.id, request);
      } else {
        if (!form.password) throw new Error('Enter the read-only account password.');
        await onCreate({ nickname: form.nickname.trim(), server: form.server.trim(), accountLogin, password: form.password });
        setForm(blankForm());
      }
      setStatus('Account saved.');
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : 'The account could not be saved.');
    } finally {
      // Credentials are write-only and must never remain in component state after an attempt.
      setForm((current) => ({ ...current, password: '' }));
    }
  }

  return (
    <form className="account-editor" onSubmit={submit}>
      <h2>{account ? 'Edit MT5 account' : 'Add MT5 account'}</h2>
      <label><span>Nickname</span><input required value={form.nickname} onChange={(event) => patch({ nickname: event.target.value })} /></label>
      <label><span>Server</span><input required value={form.server} onChange={(event) => patch({ server: event.target.value })} /></label>
      <label><span>Account login</span><input required inputMode="numeric" value={form.accountLogin} onChange={(event) => patch({ accountLogin: event.target.value })} /></label>
      <label>
        <span>{account ? 'Replacement password (optional)' : 'Read-only password'}</span>
        <input required={!account} type="password" autoComplete="new-password" value={form.password} onChange={(event) => patch({ password: event.target.value })} />
      </label>
      {status ? <p className="muted" role="status">{status}</p> : null}
      <div className="form-actions">
        {onCancel ? <button type="button" className="secondary-button" onClick={onCancel} disabled={busy}>Cancel</button> : null}
        <button type="submit" className="primary-button" disabled={busy}>{busy ? 'Saving…' : 'Save account'}</button>
      </div>
    </form>
  );
}
