import { useEffect, useRef, useState } from 'react';
import type { CampaignClassificationApplyResponse, CampaignClassificationPreview, Mt5SyncResponse, SafeMt5AccountRef } from '@trading-journal/shared';

export interface SyncControlProps {
  account: SafeMt5AccountRef | null;
  onSync: (accountId: string) => Promise<Mt5SyncResponse>;
  onFullSync?: (accountId: string) => Promise<Mt5SyncResponse>;
  onClassificationPreview?: (accountId: string) => Promise<CampaignClassificationPreview>;
  onReclassify?: (accountId: string, classificationFingerprint: string) => Promise<CampaignClassificationApplyResponse>;
  onCompleted?: (response: Mt5SyncResponse) => Promise<void> | void;
}

export function formatSyncResult(response: Mt5SyncResponse, account: SafeMt5AccountRef): string {
  if (response.state === 'failed') return `동기화 실패\n계정: ${account.nickname}\n${response.message ?? '동기화에 실패했습니다.'}`;
  if (response.state === 'in_progress') {
    const progress = response.progress;
    const page = progress?.pageCursor ? '\n다음 페이지를 수신하는 중입니다.' : '';
    return `동기화 진행 중\n계정: ${account.nickname}\n${progress ? `${progress.mode === 'bootstrap' ? '전체 기록' : '증분 기록'} 동기화` : response.message ?? '이미 동기화가 진행 중입니다.'}${page}`;
  }
  const imported = response.importedCount ?? 0;
  const received = response.receivedCount ?? 0;
  const syncedAt = response.syncedAt ? new Date(response.syncedAt).toLocaleString('ko-KR') : '시간 정보 없음';
  const ledger = response.balanceLedger;
  const ledgerSummary = ledger?.status === 'diverged'
    ? `\n잔고 원장 불일치\n계산 ${ledger.calculatedBalance} / MT5 ${ledger.currentBalance} ${ledger.currency}`
    : '';
  const rebuild = response.fullRebuild
    ? `\n전체 재구성: Deal ${response.fullRebuild.removedDeals}건 / Order ${response.fullRebuild.removedOrders}건 제거 · MT5 누락 거래 ${response.fullRebuild.sourceMissingTrades}건 보존`
    : '';
  return `동기화 완료\n계정: ${account.nickname}\n반영 ${imported}건 / 수신 ${received}건\n동기화 시각: ${syncedAt}${ledgerSummary}${rebuild}`;
}

export function SyncControl({ account, onSync, onFullSync, onClassificationPreview, onReclassify, onCompleted }: SyncControlProps) {
  const [syncing, setSyncing] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const pollTimer = useRef<number | undefined>(undefined);
  const generation = useRef(0);

  function showResult(message: string): void {
    window.clearTimeout(timer.current);
    setResult(message);
    timer.current = window.setTimeout(() => setResult(null), 3000);
  }

  useEffect(() => () => {
    generation.current += 1;
    window.clearTimeout(timer.current);
    window.clearTimeout(pollTimer.current);
  }, []);
  useEffect(() => {
    generation.current += 1;
    window.clearTimeout(timer.current);
    window.clearTimeout(pollTimer.current);
    setSyncing(false);
    setResult(null);
  }, [account?.id]);

  async function sync(poll = false, full = false): Promise<void> {
    if (!account?.active || (!poll && syncing)) return;
    const current = generation.current;
    const accountId = account.id;
    setSyncing(true);
    try {
      const response = await (full && onFullSync ? onFullSync(accountId) : onSync(accountId));
      if (current !== generation.current || account.id !== accountId) return;
      showResult(formatSyncResult(response, account));
      if (response.state === 'completed') await onCompleted?.(response);
      if (response.state === 'in_progress') {
        window.clearTimeout(pollTimer.current);
        pollTimer.current = window.setTimeout(() => {
          if (current === generation.current) void sync(true, full);
        }, poll ? 1_500 : 750);
      }
    } catch {
      if (current !== generation.current) return;
      showResult('동기화에 실패했습니다. 다시 시도하세요.');
    } finally {
      if (current === generation.current) setSyncing(false);
    }
  }

  async function fullSync(): Promise<void> {
    if (!account?.active || !onFullSync || syncing) return;
    if (!window.confirm('MT5 원본 Deal/Order를 처음부터 다시 확인합니다.\n\n직접 작성한 거래 분석, 메모, 이미지와 현재 캠페인 분류는 유지됩니다. 계속하시겠습니까?')) return;
    await sync(false, true);
  }

  async function reviewClassification(): Promise<void> {
    if (!account?.active || !onClassificationPreview || !onReclassify || classifying || syncing) return;
    setClassifying(true);
    try {
      const preview = await onClassificationPreview(account.id);
      if (!preview.hasChanges) {
        showResult('현재 자동 분류가 최신 기준과 일치합니다.');
        return;
      }
      const summary = [
        `자동 분류 변경안`,
        `거래 이동 ${preview.movedTrades}건`,
        `캠페인 생성 ${preview.createdCampaigns}건 / 병합 ${preview.mergedCampaigns}건`,
        `수동 충돌 ${preview.manualConflicts}건 / 작성 데이터 충돌 ${preview.authoredConflicts}건`,
        '',
        '거래별 분석은 유지되고, 작성 데이터가 있는 자동 캠페인과 수동 분류는 충돌로 남습니다. 적용하시겠습니까?',
      ].join('\n');
      if (!window.confirm(summary)) return;
      const applied = await onReclassify(account.id, preview.classificationFingerprint);
      showResult(`자동 분류 적용 완료\n거래 이동 ${applied.moved}건 / 캠페인 정리 ${applied.deletedCampaigns}건 / 충돌 ${applied.conflicts}건`);
      await onCompleted?.({ state: 'completed', accountId: account.id });
    } catch {
      showResult('자동 분류 검토 또는 적용에 실패했습니다.');
    } finally {
      setClassifying(false);
    }
  }

  const unavailable = !account || !account.active;
  return (
    <div className="sync-control">
      <div className="sync-actions">
        <button className="secondary-button" type="button" onClick={() => { void sync(); }} disabled={unavailable || syncing}>
          {syncing ? '동기화 중…' : 'MT5 동기화'}
        </button>
        {onFullSync ? <button className="secondary-button" type="button" onClick={() => { void fullSync(); }} disabled={unavailable || syncing || classifying}>
          전체 다시 동기화
        </button> : null}
      </div>
      {onClassificationPreview && onReclassify ? <button className="secondary-button" type="button" onClick={() => { void reviewClassification(); }} disabled={unavailable || syncing || classifying}>
        {classifying ? '분류 확인 중…' : '자동 분류 검토'}
      </button> : null}
      {unavailable ? <span className="muted">{account ? '비활성 계정은 동기화할 수 없습니다.' : '동기화할 MT5 계정을 선택하세요.'}</span> : null}
      {result ? <span className="muted" role="status">{result}</span> : null}
    </div>
  );
}
