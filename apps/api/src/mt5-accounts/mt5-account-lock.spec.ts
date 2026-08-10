import { NotFoundException } from '@nestjs/common';
import { lockOwnedMt5Account } from './mt5-account-lock';

describe('lockOwnedMt5Account', () => {
  it('locks the owned account row before acquiring its canonical advisory lock', async () => {
    const calls: string[] = [];
    const tx = {
      $queryRaw: jest.fn(async (query: any) => {
        const sql = query.strings?.join('') ?? '';
        calls.push(sql);
        if (sql.includes('FROM mt5_accounts')) {
          return [{ id: 'account-1', canonicalServer: 'broker', accountLogin: 7n }];
        }
        return [];
      }),
    };

    await expect(lockOwnedMt5Account(tx as never, 'owner-1', 'account-1')).resolves.toEqual({
      id: 'account-1', canonicalServer: 'broker', accountLogin: 7n,
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('WHERE id = ');
    expect(calls[0]).toContain('AND owner_id = ');
    expect(calls[0]).toContain('FOR UPDATE');
    expect(calls[1]).toContain('pg_advisory_xact_lock');
    expect(calls[1]).toContain('hashtextextended');
  });

  it('rejects a missing or foreign account without acquiring an advisory lock', async () => {
    const tx = { $queryRaw: jest.fn(async () => []) };

    await expect(lockOwnedMt5Account(tx as never, 'owner-1', 'missing')).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });
});
