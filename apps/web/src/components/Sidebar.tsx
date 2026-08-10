import { useState, type ReactNode } from 'react';
import type { SafeMt5AccountRef } from '@trading-journal/shared';
import { AccountSwitcher } from './AccountSwitcher';

export type AppView = 'stats' | 'trade-log' | 'accounts' | 'admin';

export interface SidebarProps {
  activeView: AppView;
  accounts: SafeMt5AccountRef[];
  accountId?: string;
  onNavigate: (view: AppView) => void;
  onAccountChange: (accountId: string) => void;
  isAdmin?: boolean;
  footer?: ReactNode;
}

const primaryItems: Array<{ view: AppView; label: string }> = [
  { view: 'stats', label: '통계' }, { view: 'trade-log', label: '매매 일지' }, { view: 'accounts', label: 'MT5 계정' },
];

export function Sidebar({ activeView, accounts, accountId, onNavigate, onAccountChange, isAdmin = false, footer }: SidebarProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navigate = (view: AppView) => { setMobileMenuOpen(false); onNavigate(view); };
  return <aside className="sidebar" aria-label="애플리케이션 탐색">
    <div className="sidebar-brand">매매 일지</div>
    <button className="mobile-menu-toggle secondary-button compact" type="button" aria-expanded={mobileMenuOpen} aria-controls="primary-navigation" onClick={() => setMobileMenuOpen((open) => !open)}>메뉴</button>
    <nav id="primary-navigation" className={mobileMenuOpen ? 'mobile-open' : undefined}>{primaryItems.map((item) => <button key={item.view} className={activeView === item.view ? 'active' : undefined} type="button" aria-current={activeView === item.view ? 'page' : undefined} onClick={() => navigate(item.view)}>{item.label}</button>)}{isAdmin ? <button className={activeView === 'admin' ? 'active' : undefined} type="button" onClick={() => navigate('admin')}>사용자 관리</button> : null}</nav>
    <AccountSwitcher accounts={accounts} value={accountId} onChange={onAccountChange} />
    {footer ? <div className="sidebar-footer">{footer}</div> : null}
  </aside>;
}
