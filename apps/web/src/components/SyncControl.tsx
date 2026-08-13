import { useEffect, useRef, useState } from 'react';
import type { CampaignClassificationApplyResponse, CampaignClassificationPreview, Mt5ExcursionProgress, Mt5SyncResponse, SafeMt5AccountRef } from '@trading-journal/shared';

export interface SyncControlProps {
  account: SafeMt5AccountRef | null;
  onSync: (accountId: string) => Promise<Mt5SyncResponse>;
  onFullSync?: (accountId: string) => Promise<Mt5SyncResponse>;
  onClassificationPreview?: (accountId: string) => Promise<CampaignClassificationPreview>;
  onReclassify?: (accountId: string, classificationFingerprint: string) => Promise<CampaignClassificationApplyResponse>;
  onExcursionProgress?: (accountId: string) => Promise<Mt5ExcursionProgress>;
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

export function SyncControl({ account, onSync, onFullSync, onClassificationPreview, onReclassify, onExcursionProgress, onCompleted }: SyncControlProps) {
  const [syncing, setSyncing] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [excursionProgress, setExcursionProgress] = useState<Mt5ExcursionProgress | null>(null);
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
    setExcursionProgress(null);
  }, [account?.id]);
  useEffect(() => {
    if (!account?.active || !onExcursionProgress) return;
    let active = true;
    let nextTimer: number | undefined;
    const load = async () => {
      try {
        const next = await onExcursionProgress(account.id);
        if (active) setExcursionProgress(next);
      } catch {
        // Keep the last known status during transient polling failures.
      } finally {
        if (active) nextTimer = window.setTimeout(() => { void load(); }, 5_000);
      }
    };
    void load();
    return () => { active = false; window.clearTimeout(nextTimer); };
  }, [account?.active, account?.id, onExcursionProgress]);

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
        <p className="sync-action-help">최근 MT5 체결과 포지션 변경사항을 가져옵니다.</p>
        {onFullSync ? <button className="sync-reset-button" type="button" onClick={() => { void fullSync(); }} disabled={unavailable || syncing || classifying}>
          MT5 동기화 초기화
        </button> : null}
        {onFullSync ? <p className="sync-action-help">MT5 기록을 처음부터 다시 확인합니다. 작성한 분석과 메모는 유지됩니다.</p> : null}
      </div>
      {onClassificationPreview && onReclassify ? <button className="classification-review-button" type="button" onClick={() => { void reviewClassification(); }} disabled={unavailable || syncing || classifying}>
        {classifying ? '분류 기준 확인 중…' : '매매 자동 분류 다시 적용'}
      </button> : null}
      {onClassificationPreview && onReclassify ? <p className="sync-action-help">현재 기준으로 매매 묶음을 다시 계산하고, 적용 전에 변경 내용을 보여줍니다.</p> : null}
      {excursionProgress ? <section className="excursion-progress" aria-label="시장 진행 분석 계산 상태">
        <header><strong>시장 진행 분석</strong><span>{excursionProgress.completed} / {excursionProgress.total}</span></header>
        <progress max={Math.max(excursionProgress.total, 1)} value={excursionProgress.completed} />
        <p>{excursionProgress.syncHasPriority || syncing ? 'MT5 동기화를 우선 처리하고 있습니다. 분석은 이후 자동으로 계속됩니다.' : excursionProgress.calculating ? '백그라운드에서 계산 중입니다.' : excursionProgress.pending > 0 ? '계산 대기 중입니다.' : '현재 계산 작업이 완료되었습니다.'}</p>
        {(excursionProgress.recalculationNeeded > 0 || excursionProgress.unsupported > 0 || excursionProgress.failed > 0) ? <details><summary>데이터 상태</summary><p>재계산 필요 {excursionProgress.recalculationNeeded} · 계산 불가 {excursionProgress.unsupported} · 확인 필요 {excursionProgress.failed}</p></details> : null}
      </section> : null}
      {unavailable ? <span className="muted">{account ? '비활성 계정은 동기화할 수 없습니다.' : '동기화할 MT5 계정을 선택하세요.'}</span> : null}
      {result ? <span className="muted" role="status">{result}</span> : null}
    </div>
  );
}
