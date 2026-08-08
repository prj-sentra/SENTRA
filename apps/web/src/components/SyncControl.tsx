import { useEffect, useRef, useState } from 'react';
import type { Mt5SyncResponse, SafeMt5AccountRef } from '@trading-journal/shared';

export interface SyncControlProps {
  account: SafeMt5AccountRef | null;
  onSync: (accountId: string) => Promise<Mt5SyncResponse>;
  onCompleted?: (response: Mt5SyncResponse) => Promise<void> | void;
}

export function formatSyncResult(response: Mt5SyncResponse, account: SafeMt5AccountRef): string {
  const imported = response.importedCount ?? 0;
  const received = response.receivedCount ?? 0;
  const syncedAt = response.syncedAt ? new Date(response.syncedAt).toLocaleString() : 'not reported';
  return `${response.state} · ${imported} imported / ${received} received · ${account.nickname} · ${syncedAt}`;
}

export function SyncControl({ account, onSync, onCompleted }: SyncControlProps) {
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  function showResult(message: string): void {
    window.clearTimeout(timer.current);
    setResult(message);
    timer.current = window.setTimeout(() => setResult(null), 3000);
  }

  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    window.clearTimeout(timer.current);
    setResult(null);
  }, [account?.id]);

  async function sync(): Promise<void> {
    if (!account?.active || syncing) return;
    setSyncing(true);
    try {
      const response = await onSync(account.id);
      showResult(formatSyncResult(response, account));
      if (response.state === 'completed') await onCompleted?.(response);
    } catch {
      showResult('Synchronization failed. Try again.');
    } finally {
      setSyncing(false);
    }
  }

  const unavailable = !account || !account.active;
  return (
    <div className="sync-control">
      <button className="secondary-button" type="button" onClick={sync} disabled={unavailable || syncing}>
        {syncing ? 'Syncing…' : 'Sync selected account'}
      </button>
      {unavailable ? <span className="muted">{account ? 'Inactive accounts cannot be synchronized.' : 'Select an MT5 account to synchronize.'}</span> : null}
      {result ? <span className="muted" role="status">{result}</span> : null}
    </div>
  );
}
