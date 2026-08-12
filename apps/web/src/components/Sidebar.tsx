import { useState, type ReactNode } from 'react';
import type { SafeMt5AccountRef } from '@trading-journal/shared';
import { AccountSwitcher } from './AccountSwitcher';

export type AppView = 'stats' | 'trade-log' | 'credentials' | 'admin';

export interface SidebarProps {
  activeView: AppView;
  onNavigate: (view: AppView) => void;
  accounts: SafeMt5AccountRef[];
  accountId?: string;
  onAccountChange: (accountId: string) => void;
  isAdmin?: boolean;
  syncControl?: ReactNode;
  footer?: ReactNode;
}

const primaryItems: Array<{ view: AppView; label: string }> = [
  { view: 'stats', label: '대시보드' }, { view: 'trade-log', label: '매매 일지' }, { view: 'credentials', label: '계정 설정' },
];

const dashboardItems = [
  ['dashboard-overview', '핵심 성과'],
  ['dashboard-charts', '성과 변화'],
  ['dashboard-advanced', '성과 지표'],
] as const;

export function Sidebar({ activeView, accounts, accountId, onNavigate, onAccountChange, isAdmin = false, syncControl, footer }: SidebarProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navigate = (view: AppView) => { setMobileMenuOpen(false); onNavigate(view); };
  return <aside className="sidebar" aria-label="애플리케이션 탐색">
    <div className="sidebar-brand">SENTRA</div>
    <button className="mobile-menu-toggle secondary-button compact" type="button" aria-expanded={mobileMenuOpen} aria-controls="primary-navigation" onClick={() => setMobileMenuOpen((open) => !open)}>메뉴</button>
    <nav id="primary-navigation" className={mobileMenuOpen ? 'mobile-open' : undefined}>{primaryItems.map((item) => <button key={item.view} className={activeView === item.view ? 'active' : undefined} type="button" aria-current={activeView === item.view ? 'page' : undefined} onClick={() => navigate(item.view)}>{item.label}</button>)}{isAdmin ? <button className={activeView === 'admin' ? 'active' : undefined} type="button" onClick={() => navigate('admin')}>사용자 관리</button> : null}</nav>
    <AccountSwitcher accounts={accounts} value={accountId} onChange={onAccountChange} />
    {syncControl ? <div className="sidebar-sync">{syncControl}</div> : null}
    {activeView === 'stats' ? <nav className="sidebar-toc" aria-label="대시보드 목차">
      <span>목차</span>
      {dashboardItems.map(([id, label]) => <a key={id} href={`#${id}`} onClick={(event) => { event.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>{label}</a>)}
    </nav> : null}
    {footer ? <div className="sidebar-footer">{footer}</div> : null}
  </aside>;
}
