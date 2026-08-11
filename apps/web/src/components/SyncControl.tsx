import { useEffect, useRef, useState } from 'react';
import type { Mt5SyncResponse, SafeMt5AccountRef } from '@trading-journal/shared';

export interface SyncControlProps {
  account: SafeMt5AccountRef | null;
  onSync: (accountId: string) => Promise<Mt5SyncResponse>;
  onCompleted?: (response: Mt5SyncResponse) => Promise<void> | void;
}

export function formatSyncResult(response: Mt5SyncResponse, account: SafeMt5AccountRef): string {
  if (response.state === 'failed') return `동기화 실패\n계정: ${account.nickname}\n${response.message ?? '동기화에 실패했습니다.'}`;
  if (response.state === 'in_progress') return `동기화 진행 중\n계정: ${account.nickname}\n${response.message ?? '이미 동기화가 진행 중입니다.'}`;
  const imported = response.importedCount ?? 0;
  const received = response.receivedCount ?? 0;
  const syncedAt = response.syncedAt ? new Date(response.syncedAt).toLocaleString('ko-KR') : '시간 정보 없음';
  const ledger = response.balanceLedger;
  const ledgerSummary = ledger?.status === 'diverged'
    ? `\n잔고 원장 불일치\n계산 ${ledger.calculatedBalance} / MT5 ${ledger.currentBalance} ${ledger.currency}`
    : '';
  return `동기화 완료\n계정: ${account.nickname}\n반영 ${imported}건 / 수신 ${received}건\n동기화 시각: ${syncedAt}${ledgerSummary}`;
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
      showResult('동기화에 실패했습니다. 다시 시도하세요.');
    } finally {
      setSyncing(false);
    }
  }

  const unavailable = !account || !account.active;
  return (
    <div className="sync-control">
      <button className="secondary-button" type="button" onClick={sync} disabled={unavailable || syncing}>
        {syncing ? '동기화 중…' : 'MT5 동기화'}
      </button>
      {unavailable ? <span className="muted">{account ? '비활성 계정은 동기화할 수 없습니다.' : '동기화할 MT5 계정을 선택하세요.'}</span> : null}
      {result ? <span className="muted" role="status">{result}</span> : null}
    </div>
  );
}
