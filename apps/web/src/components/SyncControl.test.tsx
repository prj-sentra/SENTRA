import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncControl } from './SyncControl';

const account = { id: 'a1', nickname: 'Primary', server: 'Broker', accountLogin: 42, active: true, replacedById: null, createdAt: '', updatedAt: '' };

describe('SyncControl', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { cleanup(); vi.useRealTimers(); });
  it('reports the complete account-scoped summary and clears exactly after 3000ms', async () => {
    render(<SyncControl account={account} onSync={async () => ({ state: 'completed', accountId: 'a1', importedCount: 2, receivedCount: 5, syncedAt: '2026-08-08T12:00:00.000Z' })} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /MT5 동기화/i })); });
    expect(screen.getByRole('status')).toHaveTextContent('동기화 완료 계정: Primary 반영 2건 / 수신 5건');
    act(() => vi.advanceTimersByTime(2999));
    expect(screen.getByRole('status')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
  it('surfaces a completed sync whose reconstructed account ledger diverged', async () => {
    render(<SyncControl account={account} onSync={async () => ({
      state: 'completed',
      accountId: 'a1',
      importedCount: 1,
      receivedCount: 4,
      balanceLedger: { status: 'diverged', currency: 'USD', calculatedBalance: 926, currentBalance: 925 },
    })} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /MT5 동기화/i })); });
    expect(screen.getByRole('status')).toHaveTextContent('잔고 원장 불일치 계산 926 / MT5 925 USD');
  });
  it('confirms and polls a full rebuild separately from ordinary sync', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onSync = vi.fn();
    const onFullSync = vi.fn()
      .mockResolvedValueOnce({ state: 'in_progress', accountId: 'a1', progress: { mode: 'bootstrap', snapshotToMsc: 1, pageCursor: 'next' } })
      .mockResolvedValueOnce({ state: 'completed', accountId: 'a1', importedCount: 2, receivedCount: 5, fullRebuild: { removedDeals: 1, removedOrders: 2, sourceMissingTrades: 3 } });
    render(<SyncControl account={account} onSync={onSync} onFullSync={onFullSync} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'MT5 동기화 초기화' })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(750); });
    expect(onSync).not.toHaveBeenCalled();
    expect(onFullSync).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('status')).toHaveTextContent('전체 재구성: Deal 1건 / Order 2건 제거 · MT5 누락 거래 3건 보존');
  });
  it('previews classification before applying it', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const preview = vi.fn().mockResolvedValue({
      accountId: 'a1', classificationFingerprint: 'a'.repeat(64), trades: 4, currentCampaigns: 1, proposedCampaigns: 2, movedTrades: 2,
      createdCampaigns: 1, mergedCampaigns: 0, manualConflicts: 0, authoredConflicts: 0, hasChanges: true,
    });
    const reclassify = vi.fn().mockResolvedValue({ moved: 2, deletedCampaigns: 0, conflicts: 0 });
    render(<SyncControl account={account} onSync={vi.fn()} onClassificationPreview={preview} onReclassify={reclassify} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '매매 자동 분류 다시 적용' })); });
    expect(preview).toHaveBeenCalledWith('a1');
    expect(reclassify).toHaveBeenCalledWith('a1', 'a'.repeat(64));
    expect(screen.getByRole('status')).toHaveTextContent('자동 분류 적용 완료 거래 이동 2건');
  });
  it('shows the safe failed response message without invented counts or time', async () => {
    render(<SyncControl account={account} onSync={async () => ({ state: 'failed', accountId: 'a1', message: 'Synchronization result expired' })} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /MT5 동기화/i })); });
    expect(screen.getByRole('status')).toHaveTextContent('동기화 실패 계정: Primary Synchronization result expired');
    expect(screen.getByRole('status')).not.toHaveTextContent('imported');
    act(() => vi.advanceTimersByTime(2999));
    expect(screen.getByRole('status')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
  it('shows the safe in-progress response and expires both non-complete states at 3000ms', async () => {
    cleanup();
    render(<SyncControl account={account} onSync={async () => ({ state: 'in_progress', accountId: 'a1', message: 'Synchronization is already in progress.' })} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /MT5 동기화/i })); });
    expect(screen.getByRole('status')).toHaveTextContent('동기화 진행 중 계정: Primary Synchronization is already in progress.');
    act(() => vi.advanceTimersByTime(2999));
    expect(screen.getByRole('status')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('polls an in-progress synchronization and stops when it completes', async () => {
    const onSync = vi.fn()
      .mockResolvedValueOnce({ state: 'in_progress', accountId: 'a1', progress: { mode: 'bootstrap', snapshotToMsc: 1, pageCursor: 'page-2' } })
      .mockResolvedValueOnce({ state: 'completed', accountId: 'a1', importedCount: 1, receivedCount: 1 });
    render(<SyncControl account={account} onSync={onSync} />);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /MT5 동기화/i })); });
    expect(screen.getByRole('status')).toHaveTextContent('전체 기록 동기화 다음 페이지를 수신하는 중입니다.');
    await act(async () => { await vi.advanceTimersByTimeAsync(750); });

    expect(onSync).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('status')).toHaveTextContent('동기화 완료');
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(onSync).toHaveBeenCalledTimes(2);
  });

  it('cancels pending progress polling on account change and unmount', async () => {
    const onSync = vi.fn().mockResolvedValue({ state: 'in_progress', accountId: 'a1', progress: { mode: 'incremental', snapshotToMsc: 1 } });
    const view = render(<SyncControl account={account} onSync={onSync} />);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /MT5 동기화/i })); });
    view.rerender(<SyncControl account={{ ...account, id: 'a2', nickname: 'Secondary' }} onSync={onSync} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(onSync).toHaveBeenCalledTimes(1);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /MT5 동기화/i })); });
    view.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(onSync).toHaveBeenCalledTimes(2);
  });

  it('keeps the replacement account usable when the prior request resolves late', async () => {
    let resolveOld: ((value: { state: 'completed'; accountId: string }) => void) | undefined;
    const oldRequest = new Promise<{ state: 'completed'; accountId: string }>((resolve) => { resolveOld = resolve; });
    const onSync = vi.fn()
      .mockReturnValueOnce(oldRequest)
      .mockResolvedValueOnce({ state: 'completed', accountId: 'a2' });
    const onCompleted = vi.fn();
    const view = render(<SyncControl account={account} onSync={onSync} onCompleted={onCompleted} />);

    fireEvent.click(screen.getByRole('button', { name: /MT5 동기화/i }));
    expect(screen.getByRole('button')).toBeDisabled();
    view.rerender(<SyncControl account={{ ...account, id: 'a2', nickname: 'Secondary' }} onSync={onSync} onCompleted={onCompleted} />);
    expect(screen.getByRole('button')).toBeEnabled();

    await act(async () => { fireEvent.click(screen.getByRole('button')); });
    expect(onSync).toHaveBeenLastCalledWith('a2');
    expect(onCompleted).toHaveBeenCalledTimes(1);
    await act(async () => { resolveOld?.({ state: 'completed', accountId: 'a1' }); });
    expect(onCompleted).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('Secondary');
  });
});
