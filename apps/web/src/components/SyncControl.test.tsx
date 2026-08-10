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
    expect(screen.getByRole('status')).toHaveTextContent('동기화 완료 · 2건 반영 / 5건 수신 · Primary');
    act(() => vi.advanceTimersByTime(2999));
    expect(screen.getByRole('status')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
  it('shows the safe failed response message without invented counts or time', async () => {
    render(<SyncControl account={account} onSync={async () => ({ state: 'failed', accountId: 'a1', message: 'Synchronization result expired' })} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /MT5 동기화/i })); });
    expect(screen.getByRole('status')).toHaveTextContent('동기화 실패 · Primary · Synchronization result expired');
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
    expect(screen.getByRole('status')).toHaveTextContent('동기화 진행 중 · Primary · Synchronization is already in progress.');
    act(() => vi.advanceTimersByTime(2999));
    expect(screen.getByRole('status')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
