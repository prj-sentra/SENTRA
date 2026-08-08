import { describe, expect, it } from 'vitest';
import { scopeQuery } from './App';

describe('account scope query', () => {
  it('serializes all and manual scopes without account identifiers', () => {
    expect(scopeQuery({ scope: 'all' })).toBe('scope=all');
    expect(scopeQuery({ scope: 'manual' })).toBe('scope=manual');
  });

  it('serializes the selected owned account', () => {
    expect(scopeQuery({ scope: 'account', accountId: 'account-1' })).toBe('scope=account&accountId=account-1');
  });
});
