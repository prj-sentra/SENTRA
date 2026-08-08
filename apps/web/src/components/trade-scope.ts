import type { TradeAccountScope } from '@trading-journal/shared';

export function tradeScopeSearch(scope: TradeAccountScope): string {
  const query = new URLSearchParams({ scope: scope.scope });
  if (scope.scope === 'account') query.set('accountId', scope.accountId);
  return query.toString();
}

export function selectedAccountId(scope: TradeAccountScope): string | null {
  return scope.scope === 'account' ? scope.accountId : null;
}
