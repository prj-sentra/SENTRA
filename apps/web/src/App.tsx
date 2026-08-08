import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  CreateMt5AccountRequest,
  Mt5SyncResponse,
  PatchTradeAnalysisRequest,
  SafeMt5AccountRef,
  TradeAccountScope,
  TradeCampaign,
  TradeCampaignDateResponse,
  TradeStatsResponse,
  UpdateMt5AccountRequest,
  UpdateTradeRequest,
} from '@trading-journal/shared';
import { UserManagement } from './admin/UserManagement';
import { apiBaseUrl, apiRequest, setUnauthorizedHandler } from './api/client';
import { AuthScreen, type CurrentUser } from './auth/AuthScreen';
import { AccountEditor } from './components/AccountEditor';
import { Sidebar, type AppView } from './components/Sidebar';
import { StatsPage } from './components/StatsPage';
import { SyncControl } from './components/SyncControl';
import { TradeJournalPage } from './components/TradeJournalPage';

export function scopeQuery(scope: TradeAccountScope): string {
  const params = new URLSearchParams({ scope: scope.scope });
  if (scope.scope === 'account') params.set('accountId', scope.accountId);
  return params.toString();
}

export function App() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [view, setView] = useState<AppView>('trade-log');
  const [scope, setScope] = useState<TradeAccountScope>({ scope: 'all' });
  const [accounts, setAccounts] = useState<SafeMt5AccountRef[]>([]);
  const [campaigns, setCampaigns] = useState<TradeCampaign[]>([]);
  const [stats, setStats] = useState<TradeStatsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingAccount, setEditingAccount] = useState<SafeMt5AccountRef | undefined>();
  const [accountBusy, setAccountBusy] = useState(false);

  const loadCurrentUser = useCallback(async () => {
    try {
      setUser(await apiRequest<CurrentUser>('/auth/me'));
    } catch {
      setUser(null);
    } finally {
      setCheckingSession(false);
    }
  }, []);

  useEffect(() => setUnauthorizedHandler(() => setUser(null)), []);
  useEffect(() => { void loadCurrentUser(); }, [loadCurrentUser]);

  const loadAccounts = useCallback(async () => {
    if (!user) return;
    setAccounts(await apiRequest<SafeMt5AccountRef[]>('/mt5-accounts'));
  }, [user]);

  const loadScopedData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    const query = scopeQuery(scope);
    try {
      const [campaignResponse, statsResponse] = await Promise.all([
        apiRequest<TradeCampaignDateResponse>(`/trade-log/campaigns?${query}`),
        apiRequest<TradeStatsResponse>(`/trade-log/stats?${query}`),
      ]);
      setCampaigns(campaignResponse.campaigns);
      setStats(statsResponse);
    } catch {
      setError('Trading records are unavailable.');
    } finally {
      setLoading(false);
    }
  }, [scope, user]);

  useEffect(() => { void loadAccounts(); }, [loadAccounts]);
  useEffect(() => { void loadScopedData(); }, [loadScopedData]);

  const selectedAccount = useMemo(() => scope.scope === 'account'
    ? accounts.find((account) => account.id === scope.accountId) ?? null
    : null, [accounts, scope]);

  async function mutate(path: string, init: RequestInit): Promise<void> {
    await apiRequest(path, init);
    await loadScopedData();
  }

  async function logout(): Promise<void> {
    try { await apiRequest('/auth/logout', { method: 'POST' }); }
    finally { setUser(null); setAccounts([]); setCampaigns([]); setStats(null); }
  }

  async function createAccount(request: CreateMt5AccountRequest): Promise<void> {
    setAccountBusy(true);
    try { await apiRequest('/mt5-accounts', { method: 'POST', body: JSON.stringify(request) }); await loadAccounts(); }
    finally { setAccountBusy(false); }
  }

  async function updateAccount(accountId: string, request: UpdateMt5AccountRequest): Promise<void> {
    setAccountBusy(true);
    try {
      await apiRequest(`/mt5-accounts/${encodeURIComponent(accountId)}`, { method: 'PATCH', body: JSON.stringify(request) });
      setEditingAccount(undefined);
      await loadAccounts();
    } finally { setAccountBusy(false); }
  }

  async function syncAccount(accountId: string): Promise<Mt5SyncResponse> {
    return apiRequest(`/mt5-accounts/${encodeURIComponent(accountId)}/sync`, { method: 'POST' });
  }

  if (checkingSession) return <main className="shell"><p className="muted" role="status">Loading session…</p></main>;
  if (!user) return <AuthScreen onAuthenticated={loadCurrentUser} />;

  return <div className="app-layout">
    <Sidebar
      activeView={view}
      accounts={accounts}
      scope={scope}
      onNavigate={setView}
      onScopeChange={setScope}
      isAdmin={user.isAdmin}
      footer={<><span>{user.username}</span><button type="button" className="secondary-button compact" onClick={() => void logout()}>Log out</button></>}
    />
    <main className="app-content">
      <header className="workspace-header">
        <SyncControl account={selectedAccount} onSync={syncAccount} onCompleted={loadScopedData} />
      </header>
      {view === 'trade-log' ? <TradeJournalPage
        campaigns={campaigns}
        loading={loading}
        error={error}
        imageUrl={(campaignId, imageId) => `${apiBaseUrl}/trade-log/campaigns/${encodeURIComponent(campaignId)}/images/${encodeURIComponent(imageId)}`}
        onUpdateTrade={(tradeId: string, patch: UpdateTradeRequest) => mutate(`/trade-log/trades/${encodeURIComponent(tradeId)}`, { method: 'PATCH', body: JSON.stringify(patch) })}
        onPatchAnalysis={(tradeId: string, patch: PatchTradeAnalysisRequest) => mutate(`/trade-log/trades/${encodeURIComponent(tradeId)}/analysis`, { method: 'PATCH', body: JSON.stringify(patch) })}
        onUpdateExecutionNote={(tradeId, kind, note) => mutate(`/trade-log/trades/${encodeURIComponent(tradeId)}/${kind}/note`, { method: 'PATCH', body: JSON.stringify({ note }) })}
        onUploadImage={async (campaignId, file) => { const body = new FormData(); body.set('file', file); await mutate(`/trade-log/campaigns/${encodeURIComponent(campaignId)}/images`, { method: 'POST', body }); }}
        onReorderImages={(campaignId, imageIds) => mutate(`/trade-log/campaigns/${encodeURIComponent(campaignId)}/images/order`, { method: 'PUT', body: JSON.stringify({ imageIds }) })}
        onDeleteImage={(campaignId, imageId) => mutate(`/trade-log/campaigns/${encodeURIComponent(campaignId)}/images/${encodeURIComponent(imageId)}`, { method: 'DELETE' })}
      /> : null}
      {view === 'stats' ? <StatsPage stats={stats} loading={loading} error={error} /> : null}
      {view === 'accounts' ? <section className="accounts-page"><AccountEditor account={editingAccount} busy={accountBusy} onCreate={createAccount} onUpdate={updateAccount} onCancel={editingAccount ? () => setEditingAccount(undefined) : undefined} /><div className="account-list">{accounts.map((account) => <article key={account.id}><div><strong>{account.nickname}</strong><span>{account.server} / {account.accountLogin}{account.active ? '' : ' · inactive'}</span></div><button type="button" className="secondary-button compact" onClick={() => setEditingAccount(account)}>Edit</button></article>)}</div></section> : null}
      {view === 'admin' ? <UserManagement currentUser={user} /> : null}
    </main>
  </div>;
}

export default App;
