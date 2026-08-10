import type { SafeMt5AccountRef } from '@trading-journal/shared';

export interface AccountSwitcherProps {
  accounts: SafeMt5AccountRef[];
  value?: string;
  onChange: (accountId: string) => void;
  disabled?: boolean;
}

export function AccountSwitcher({ accounts, value, onChange, disabled = false }: AccountSwitcherProps) {
  return <label className="account-switcher">
    <span>선택 계정</span>
    <select value={value ?? ''} onChange={(event) => onChange(event.target.value)} disabled={disabled || accounts.length === 0} aria-label="MT5 계정 선택">
      <option value="" disabled>계정을 선택하세요</option>
      {accounts.map((account) => <option key={account.id} value={account.id}>{account.nickname} · {account.server} / {account.accountLogin}{account.active ? '' : ' (비활성)'}</option>)}
    </select>
  </label>;
}
