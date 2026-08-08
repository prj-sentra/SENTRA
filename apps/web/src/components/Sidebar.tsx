import type { ReactNode } from 'react';
import type { SafeMt5AccountRef, TradeAccountScope } from '@trading-journal/shared';
import { AccountSwitcher } from './AccountSwitcher';

export type AppView = 'stats' | 'trade-log' | 'accounts' | 'admin';

export interface SidebarProps {
  activeView: AppView;
  accounts: SafeMt5AccountRef[];
  scope: TradeAccountScope;
  onNavigate: (view: AppView) => void;
  onScopeChange: (scope: TradeAccountScope) => void;
  isAdmin?: boolean;
  footer?: ReactNode;
}

const primaryItems: Array<{ view: AppView; label: string }> = [
  { view: 'stats', label: 'Statistics' },
  { view: 'trade-log', label: 'Trade journal' },
  { view: 'accounts', label: 'MT5 accounts' },
];

export function Sidebar({ activeView, accounts, scope, onNavigate, onScopeChange, isAdmin = false, footer }: SidebarProps) {
  return (
    <aside className="sidebar" aria-label="Application navigation">
      <div className="sidebar-brand">Trading Journal</div>
      <nav>
        {primaryItems.map((item) => (
          <button
            key={item.view}
            className={activeView === item.view ? 'active' : undefined}
            type="button"
            aria-current={activeView === item.view ? 'page' : undefined}
            onClick={() => onNavigate(item.view)}
          >
            {item.label}
          </button>
        ))}
        {isAdmin ? (
          <button className={activeView === 'admin' ? 'active' : undefined} type="button" onClick={() => onNavigate('admin')}>
            User administration
          </button>
        ) : null}
      </nav>
      <AccountSwitcher accounts={accounts} value={scope} onChange={onScopeChange} />
      {footer ? <div className="sidebar-footer">{footer}</div> : null}
    </aside>
  );
}
