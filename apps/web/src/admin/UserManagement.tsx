import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../api/client';
import type { CurrentUser } from '../auth/AuthScreen';

interface ManagedUser extends CurrentUser { createdAt: string; }
interface PendingUsers { items: ManagedUser[]; total: number; }
type UserAction = 'approve' | 'reject';

export function UserApprovalQueue({ currentUser }: { currentUser: CurrentUser }) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentUser.isAdmin) return;
    try { setUsers((await apiRequest<PendingUsers>('/admin/users/pending')).items); }
    catch { setError('승인 대기 사용자를 불러오지 못했습니다.'); }
  }, [currentUser.isAdmin]);

  useEffect(() => { void load(); }, [load]);

  async function transition(userId: string, action: UserAction) {
    setBusyId(userId); setError(null);
    try { await apiRequest(`/admin/users/${encodeURIComponent(userId)}/${action}`, { method: 'POST' }); await load(); }
    catch { setError('사용자 상태를 변경하지 못했습니다.'); }
    finally { setBusyId(null); }
  }

  if (!currentUser.isAdmin) return null;
  return <section className="panel admin-users" aria-labelledby="pending-users-title">
    <div className="panel-header"><div><p className="section-label">Administration</p><h2 id="pending-users-title">가입 승인</h2></div></div>
    {error ? <p className="error" role="alert">{error}</p> : null}
    {users.length === 0 ? <p className="stats-empty">승인 대기 요청이 없습니다.</p> : <div className="list">{users.map((user) => <article className="list-item" key={user.id}><div><strong>{user.username}</strong><small>{new Date(user.createdAt).toLocaleString('ko-KR')}</small></div><div className="form-actions"><button className="secondary-button" disabled={busyId === user.id} onClick={() => void transition(user.id, 'reject')} type="button">거절</button><button className="primary-button" disabled={busyId === user.id} onClick={() => void transition(user.id, 'approve')} type="button">승인</button></div></article>)}</div>}
  </section>;
}

export function UserManagement(props: { currentUser: CurrentUser }) {
  return props.currentUser.isAdmin ? <UserApprovalQueue {...props} /> : null;
}
