import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncControl } from './SyncControl';

const account = { id: 'a1', nickname: 'Primary', server: 'Broker', accountLogin: 42, active: true, replacedById: null, createdAt: '', updatedAt: '' };

describe('SyncControl', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it('reports the complete account-scoped summary and clears exactly after 3000ms', async () => {
    render(<SyncControl account={account} onSync={async () => ({ state: 'completed', accountId: 'a1', importedCount: 2, receivedCount: 5, syncedAt: '2026-08-08T12:00:00.000Z' })} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /sync selected/i })); });
    expect(screen.getByRole('status')).toHaveTextContent('completed · 2 imported / 5 received · Primary');
    act(() => vi.advanceTimersByTime(2999));
    expect(screen.getByRole('status')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
