import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CampaignHeadMutationResponse, CreateMt5AccountRequest, Mt5SyncResponse, PatchTradeAnalysisRequest, PatchTradeCampaignAnalysisRequest, PatchTradeCampaignMemoRequest, PatchTradeCampaignReviewRequest, SafeMt5AccountRef, SetTradeCampaignHeadRequest, TradeCalendarDay, TradeCampaign, TradeCampaignDateResponse, TradeCampaignImage, UnsetTradeCampaignHeadRequest, UpdateMt5AccountRequest } from '@trading-journal/shared';
import { UserManagement } from './admin/UserManagement';
import { apiBaseUrl, apiRequest, setUnauthorizedHandler } from './api/client';
import { AuthScreen, type CurrentUser } from './auth/AuthScreen';
import { CredentialsSettings } from './auth/CredentialsSettings';
import { AccountEditor } from './components/AccountEditor';
import { Sidebar, type AppView } from './components/Sidebar';
import { StatsPage } from './components/StatsPage';
import { SyncControl } from './components/SyncControl';
import { TradeJournalPage } from './components/TradeJournalPage';

export const appViewPaths: Record<AppView, string> = {
  stats: '/dashboard',
  'trade-log': '/journal',
  credentials: '/settings',
  admin: '/admin',
};

export function appViewFromPath(pathname: string): AppView {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return (Object.entries(appViewPaths).find(([, path]) => path === normalized)?.[0] as AppView | undefined) ?? 'trade-log';
}

export function campaignHeadMutationRequest(campaign: TradeCampaign, tradeId: string): { path: string; init: RequestInit } {
  if (campaign.rootTradeId === tradeId) {
    const request: UnsetTradeCampaignHeadRequest = { campaignVersion: campaign.campaignVersion };
    return { path: `/trade-log/campaigns/${encodeURIComponent(campaign.id)}/head`, init: { method: 'DELETE', body: JSON.stringify(request) } };
  }
  const request: SetTradeCampaignHeadRequest = { tradeId, campaignVersion: campaign.campaignVersion };
  return { path: `/trade-log/campaigns/${encodeURIComponent(campaign.id)}/head`, init: { method: 'POST', body: JSON.stringify(request) } };
}

export function App() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [view, setView] = useState<AppView>(() => appViewFromPath(window.location.pathname));
  const [accounts, setAccounts] = useState<SafeMt5AccountRef[]>([]);
  const [accountId, setAccountId] = useState<string>();
  const [campaigns, setCampaigns] = useState<TradeCampaign[]>([]);
  const [campaignDate, setCampaignDate] = useState<Pick<TradeCampaignDateResponse, 'date' | 'previousDate' | 'nextDate'>>({});
  const [calendarDays, setCalendarDays] = useState<TradeCalendarDay[]>([]);
  const [loading, setLoading] = useState(false); const [error, setError] = useState<string | null>(null);
  const [editingAccount, setEditingAccount] = useState<SafeMt5AccountRef>(); const [accountBusy, setAccountBusy] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string>(); const generation = useRef(0);
  const [journalTargetId, setJournalTargetId] = useState<string>();
  const [campaignHeadBusy, setCampaignHeadBusy] = useState(false);
  const pendingCampaignHeadTarget = useRef<{ tradeId: string; date: string } | undefined>(undefined);
  const activeAccountLoad = useRef<Promise<boolean> | undefined>(undefined);

  const navigateView = useCallback((next: AppView, replace = false) => {
    const path = appViewPaths[next];
    if (window.location.pathname !== path) window.history[replace ? 'replaceState' : 'pushState']({}, '', path);
    setView(next);
  }, []);
  useEffect(() => {
    const initialView = appViewFromPath(window.location.pathname);
    if (window.location.pathname.replace(/\/+$/, '') !== appViewPaths[initialView]) navigateView(initialView, true);
    const handlePopState = () => setView(appViewFromPath(window.location.pathname));
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [navigateView]);
  useEffect(() => {
    if (user && view === 'admin' && !user.isAdmin) navigateView('stats', true);
  }, [navigateView, user, view]);

  const loadCurrentUser = useCallback(async () => { try { setUser(await apiRequest<CurrentUser>('/auth/me')); } catch { setUser(null); } finally { setCheckingSession(false); } }, []);
  useEffect(() => setUnauthorizedHandler(() => setUser(null)), []); useEffect(() => { void loadCurrentUser(); }, [loadCurrentUser]);
  const loadAccounts = useCallback(async () => { if (!user) return; const next = await apiRequest<SafeMt5AccountRef[]>('/mt5-accounts'); setAccounts(next); setAccountId((current) => current && next.some((account) => account.id === current) ? current : next.find((account) => account.active)?.id ?? next[0]?.id); }, [user]);
  const loadAccountData = useCallback(async (dateOverride?: string): Promise<boolean> => {
    if (!user || !accountId) { setCampaigns([]); setCalendarDays([]); return false; }
    const current = ++generation.current; setLoading(true); setError(null);
    const requestedDate = dateOverride ?? selectedDate;
    const query = new URLSearchParams({ accountId }); if (requestedDate) query.set('date', requestedDate);
    try {
      const campaignResponse = await apiRequest<TradeCampaignDateResponse>(`/trade-log/campaigns?${query}`);
      if (current !== generation.current) return false;
      setCampaigns(campaignResponse.campaigns); setCalendarDays(campaignResponse.calendarDays); setCampaignDate({ date: campaignResponse.date, previousDate: campaignResponse.previousDate, nextDate: campaignResponse.nextDate });
      const target = pendingCampaignHeadTarget.current;
      if (target && target.date === requestedDate && campaignResponse.campaigns.some((entry) => entry.members.some((trade) => trade.id === target.tradeId))) {
        pendingCampaignHeadTarget.current = undefined;
        setJournalTargetId(target.tradeId);
      }
      return true;
    }
    catch { if (current === generation.current) setError('거래 기록을 불러올 수 없습니다.'); }
    finally { if (current === generation.current) setLoading(false); }
    return false;
  }, [accountId, selectedDate, user]);
  const refreshAccountData = useCallback((dateOverride?: string) => {
    const refresh = loadAccountData(dateOverride);
    activeAccountLoad.current = refresh;
    return refresh;
  }, [loadAccountData]);
  useEffect(() => { void loadAccounts(); }, [loadAccounts]); useEffect(() => { void refreshAccountData(); }, [refreshAccountData]);
  const selectedAccount = useMemo(() => accounts.find((account) => account.id === accountId) ?? null, [accounts, accountId]);
  async function mutate(path: string, init: RequestInit): Promise<void> { await apiRequest(path, init); await loadAccountData(); }
  async function changeCampaignHead(campaign: TradeCampaign, tradeId: string): Promise<void> {
    setCampaignHeadBusy(true);
    try {
      const request = campaignHeadMutationRequest(campaign, tradeId);
      const response = await apiRequest<CampaignHeadMutationResponse>(request.path, request.init);
      pendingCampaignHeadTarget.current = { tradeId, date: response.campaign.tradingDate };
      setSelectedDate(response.campaign.tradingDate);
      let latestRefresh = refreshAccountData(response.campaign.tradingDate);
      let committed = await latestRefresh;
      while (!committed && activeAccountLoad.current && activeAccountLoad.current !== latestRefresh) {
        latestRefresh = activeAccountLoad.current;
        committed = await latestRefresh;
      }
    } finally { setCampaignHeadBusy(false); }
  }
  function clearAuthenticatedState() { generation.current += 1; setUser(null); setAccounts([]); setCampaigns([]); setCalendarDays([]); setAccountId(undefined); }
  async function logout() { try { await apiRequest('/auth/logout', { method: 'POST' }); } finally { clearAuthenticatedState(); } }
  async function createAccount(request: CreateMt5AccountRequest) { setAccountBusy(true); try { await apiRequest('/mt5-accounts', { method: 'POST', body: JSON.stringify(request) }); await loadAccounts(); } finally { setAccountBusy(false); } }
  async function updateAccount(id: string, request: UpdateMt5AccountRequest) { setAccountBusy(true); try { await apiRequest(`/mt5-accounts/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(request) }); setEditingAccount(undefined); await loadAccounts(); } finally { setAccountBusy(false); } }
  async function syncAccount(id: string): Promise<Mt5SyncResponse> { return apiRequest(`/mt5-accounts/${encodeURIComponent(id)}/sync`, { method: 'POST' }); }
  async function toggleAccount(account: SafeMt5AccountRef) { const action = account.active ? '비활성화' : '활성화'; if (!window.confirm(`${account.nickname} 계정을 ${action}하시겠습니까?`)) return; await updateAccount(account.id, { active: !account.active }); }
  async function calibrateTime() {
    if (!selectedAccount) { window.alert('먼저 MT5 계정을 선택하세요.'); return; }
    const latest = campaigns.flatMap((campaign) => campaign.members).filter((trade) => trade.openedAt)
      .sort((left, right) => Date.parse(right.openedAt!) - Date.parse(left.openedAt!))[0];
    if (!latest?.openedAt) { window.alert('시간을 비교할 MT5 포지션이 없습니다. 먼저 동기화하세요.'); return; }
    const shown = new Date(latest.openedAt).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 16);
    const known = window.prompt(`마지막 포지션(${latest.symbol})의 실제 한국 시간을 입력하세요.\n현재 표시: ${shown}\n형식: YYYY-MM-DD HH:mm`, shown);
    if (!known) return;
    const normalized = known.trim().replace(' ', 'T');
    const knownInstant = Date.parse(`${normalized}:00+09:00`);
    if (!Number.isFinite(knownInstant)) { window.alert('시간 형식이 올바르지 않습니다.'); return; }
    const differenceHours = Math.round((knownInstant - Date.parse(latest.openedAt)) / 3_600_000);
    const correction = selectedAccount.timeCorrectionHours + differenceHours;
    if (Math.abs(correction) > 23) { window.alert('보정값은 -23시간부터 +23시간까지 입력할 수 있습니다.'); return; }
    await updateAccount(selectedAccount.id, { timeCorrectionHours: correction });
    const result = await syncAccount(selectedAccount.id);
    if (result.state !== 'completed') throw new Error(result.message ?? '시간 보정 동기화에 실패했습니다.');
    await loadAccountData();
    window.alert(`시간 보정 ${correction >= 0 ? '+' : ''}${correction}시간을 저장하고 전체 기록에 적용했습니다.`);
  }
  async function uploadImage(campaignId: string, file: File, uploadId: string): Promise<TradeCampaignImage> {
    if (!accountId) throw new Error('MT5 계정을 선택하세요.');
    const body = new FormData();
    body.set('file', file);
    body.set('uploadId', uploadId);
    const image = await apiRequest<TradeCampaignImage>(`/trade-log/campaigns/${encodeURIComponent(campaignId)}/images?accountId=${encodeURIComponent(accountId)}`, { method: 'POST', body });
    setCampaigns((current) => current.map((campaign) => campaign.id !== campaignId || campaign.images.some((entry) => entry.id === image.id)
      ? campaign
      : { ...campaign, images: [...campaign.images, image] }));
    return image;
  }
  async function reorderImages(campaignId: string, imageIds: string[]): Promise<void> {
    if (!accountId) throw new Error('MT5 계정을 선택하세요.');
    const images = await apiRequest<TradeCampaignImage[]>(`/trade-log/campaigns/${encodeURIComponent(campaignId)}/images/order?accountId=${encodeURIComponent(accountId)}`, { method: 'PUT', body: JSON.stringify({ imageIds }) });
    setCampaigns((current) => current.map((campaign) => campaign.id === campaignId ? { ...campaign, images } : campaign));
  }
  async function deleteImage(campaignId: string, imageId: string): Promise<void> {
    if (!accountId) throw new Error('MT5 계정을 선택하세요.');
    await apiRequest(`/trade-log/campaigns/${encodeURIComponent(campaignId)}/images/${encodeURIComponent(imageId)}?accountId=${encodeURIComponent(accountId)}`, { method: 'DELETE' });
    setCampaigns((current) => current.map((campaign) => campaign.id === campaignId
      ? { ...campaign, images: campaign.images.filter((image) => image.id !== imageId).map((image, position) => ({ ...image, position })) }
      : campaign));
  }
  if (checkingSession) return <main className="shell"><p className="muted" role="status">세션을 불러오는 중입니다…</p></main>;
  if (!user) return <AuthScreen onAuthenticated={loadCurrentUser} />;
  const noAccount = !accountId;
  return <div className="app-layout"><Sidebar activeView={view} accounts={accounts} accountId={accountId} onNavigate={navigateView} onAccountChange={(id) => { setSelectedDate(undefined); setAccountId(id); }} isAdmin={user.isAdmin} syncControl={<SyncControl account={selectedAccount} onSync={syncAccount} onCompleted={() => { void loadAccountData(); }} />} footer={<><span>{user.username}</span><button type="button" className="secondary-button compact" disabled={!selectedAccount || accountBusy} onClick={() => void calibrateTime()}>시간대 보정</button><button type="button" className="secondary-button compact" onClick={() => void logout()}>로그아웃</button></>} /><main className="app-content">
    {view === 'trade-log' && (noAccount
      ? <p className="journal-state">사이드바에서 MT5 계정을 선택하세요.</p>
      : <TradeJournalPage
          campaigns={campaigns}
          calendarDays={calendarDays}
          date={campaignDate.date}
          targetId={journalTargetId}
          onTargetFocused={() => setJournalTargetId(undefined)}
          previousDate={campaignDate.previousDate}
          nextDate={campaignDate.nextDate}
          onSelectDate={setSelectedDate}
          loading={loading}
          error={error}
          imageUrl={(campaignId, imageId) => `${apiBaseUrl}/trade-log/campaigns/${encodeURIComponent(campaignId)}/images/${encodeURIComponent(imageId)}?accountId=${encodeURIComponent(accountId!)}`}
          onPatchAnalysis={(tradeId: string, patch: PatchTradeAnalysisRequest) => mutate(`/trade-log/trades/${encodeURIComponent(tradeId)}/analysis?accountId=${encodeURIComponent(accountId!)}`, { method: 'PATCH', body: JSON.stringify(patch) })}
          onPatchCampaignAnalysis={(campaignId: string, patch: PatchTradeCampaignAnalysisRequest) => mutate(`/trade-log/campaigns/${encodeURIComponent(campaignId)}/analysis?accountId=${encodeURIComponent(accountId!)}`, { method: 'PATCH', body: JSON.stringify(patch) })}
          onPatchCampaignReview={(campaignId: string, patch: PatchTradeCampaignReviewRequest) => mutate(`/trade-log/campaigns/${encodeURIComponent(campaignId)}/review?accountId=${encodeURIComponent(accountId!)}`, { method: 'PATCH', body: JSON.stringify(patch) })}
          onPatchMemo={(campaignId: string, patch: PatchTradeCampaignMemoRequest) => mutate(`/trade-log/campaigns/${encodeURIComponent(campaignId)}/memo?accountId=${encodeURIComponent(accountId!)}`, { method: 'PATCH', body: JSON.stringify(patch) })}
          onChangeCampaignHead={changeCampaignHead}
          campaignHeadBusy={campaignHeadBusy}
          onRefresh={async () => { await refreshAccountData(); }}
          onUploadImage={uploadImage}
          onReorderImages={reorderImages}
          onDeleteImage={deleteImage}
        />)}
    {view === 'stats' && (noAccount ? <p className="journal-state">통계를 보려면 MT5 계정을 선택하세요.</p> : <StatsPage accountId={accountId!} request={apiRequest} onOpenRecord={(record) => { setJournalTargetId(record.targetId); setSelectedDate(record.journalDate); navigateView('trade-log'); }} />)}
    {view === 'credentials' ? <CredentialsSettings username={user.username} onCredentialsUpdated={clearAuthenticatedState} mt5AccountSettings={<section className="settings-mt5-section"><div className="settings-section-heading"><h2>MT5 계정 관리</h2></div><div className="accounts-page settings-mt5-content"><AccountEditor account={editingAccount} busy={accountBusy} onCreate={createAccount} onUpdate={updateAccount} onCancel={editingAccount ? () => setEditingAccount(undefined) : undefined} /><div className="account-list">{accounts.map((account) => <article key={account.id}><div><strong>{account.nickname}</strong><span>{account.server} / {account.accountLogin} · 시간 {account.timeCorrectionHours >= 0 ? '+' : ''}{account.timeCorrectionHours}h{account.active ? '' : ' · 비활성'}</span></div><div className="account-actions"><button type="button" className="secondary-button compact" onClick={() => setEditingAccount(account)}>수정</button><button type="button" className="secondary-button compact" disabled={accountBusy} onClick={() => void toggleAccount(account)}>{account.active ? '비활성화' : '활성화'}</button></div></article>)}</div></div></section>} /> : null}
    {view === 'admin' ? <UserManagement currentUser={user} /> : null}</main></div>;
}
export default App;
