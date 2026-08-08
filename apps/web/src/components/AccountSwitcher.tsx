import type { SafeMt5AccountRef, TradeAccountScope } from '@trading-journal/shared';

export interface AccountSwitcherProps {
  accounts: SafeMt5AccountRef[];
  value: TradeAccountScope;
  onChange: (scope: TradeAccountScope) => void;
  disabled?: boolean;
}

function scopeValue(scope: TradeAccountScope): string {
  return scope.scope === 'account' ? `account:${scope.accountId}` : scope.scope;
}

export function AccountSwitcher({ accounts, value, onChange, disabled = false }: AccountSwitcherProps) {
  function handleChange(next: string): void {
    if (next === 'all' || next === 'manual') {
      onChange({ scope: next });
      return;
    }
    onChange({ scope: 'account', accountId: next.slice('account:'.length) });
  }

  return (
    <label className="account-switcher">
      <span>Account scope</span>
      <select value={scopeValue(value)} onChange={(event) => handleChange(event.target.value)} disabled={disabled}>
        <option value="all">All trades</option>
        <option value="manual">Manual trades</option>
        {accounts.map((account) => (
          <option key={account.id} value={`account:${account.id}`}>
            {account.nickname} · {account.server} / {account.accountLogin}{account.active ? '' : ' (inactive)'}
          </option>
        ))}
      </select>
    </label>
  );
}
