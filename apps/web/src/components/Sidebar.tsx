import { useState, type ReactNode } from 'react';

export type AppView = 'stats' | 'trade-log' | 'accounts' | 'credentials' | 'admin';

export interface SidebarProps {
  activeView: AppView;
  onNavigate: (view: AppView) => void;
  isAdmin?: boolean;
  syncControl?: ReactNode;
  footer?: ReactNode;
}

const primaryItems: Array<{ view: AppView; label: string }> = [
  { view: 'stats', label: '통계' }, { view: 'trade-log', label: '매매 일지' }, { view: 'accounts', label: 'MT5 계정' }, { view: 'credentials', label: '계정 설정' },
];

export function Sidebar({ activeView, onNavigate, isAdmin = false, syncControl, footer }: SidebarProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navigate = (view: AppView) => { setMobileMenuOpen(false); onNavigate(view); };
  return <aside className="sidebar" aria-label="애플리케이션 탐색">
    <div className="sidebar-brand">SENTRA</div>
    <button className="mobile-menu-toggle secondary-button compact" type="button" aria-expanded={mobileMenuOpen} aria-controls="primary-navigation" onClick={() => setMobileMenuOpen((open) => !open)}>메뉴</button>
    <nav id="primary-navigation" className={mobileMenuOpen ? 'mobile-open' : undefined}>{primaryItems.map((item) => <button key={item.view} className={activeView === item.view ? 'active' : undefined} type="button" aria-current={activeView === item.view ? 'page' : undefined} onClick={() => navigate(item.view)}>{item.label}</button>)}{isAdmin ? <button className={activeView === 'admin' ? 'active' : undefined} type="button" onClick={() => navigate('admin')}>사용자 관리</button> : null}</nav>
    {syncControl ? <div className="sidebar-sync">{syncControl}</div> : null}
    {footer ? <div className="sidebar-footer">{footer}</div> : null}
  </aside>;
}
