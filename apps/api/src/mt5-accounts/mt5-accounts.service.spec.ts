import { ConflictException, NotFoundException } from '@nestjs/common';
import { CredentialCipherService } from './credential-cipher.service';
import { Mt5AccountsService } from './mt5-accounts.service';

const KEY = Buffer.alloc(32, 5).toString('base64');
const now = new Date('2026-08-08T00:00:00Z');
const row = {
  id: 'account-1', ownerId: 'owner-1', nickname: 'Primary', canonicalServer: 'broker demo', accountLogin: 42n,
  credentialCiphertext: Buffer.from('ciphertext'), credentialIv: Buffer.alloc(12), credentialTag: Buffer.alloc(16), credentialVersion: 1,
  active: true, replacedById: null, createdAt: now, updatedAt: now,
};

const createPrisma = () => {
  const prisma = {
    mt5Account: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    trade: { count: jest.fn().mockResolvedValue(0) }, tradeCampaign: { count: jest.fn().mockResolvedValue(0) },
    mt5Deal: { count: jest.fn().mockResolvedValue(0) }, mt5Order: { count: jest.fn().mockResolvedValue(0) },
    mt5SyncStatus: { count: jest.fn().mockResolvedValue(0) }, mt5SyncLease: { count: jest.fn().mockResolvedValue(0) },
    $queryRaw: jest.fn().mockResolvedValue([]), $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(async (callback) => callback(prisma));
  return prisma;
};

describe('Mt5AccountsService', () => {
  it('canonicalizes identity, encrypts credentials, and returns no secret fields', async () => {
    const prisma = createPrisma();
    prisma.mt5Account.create.mockResolvedValue(row);
    const result = await new Mt5AccountsService(prisma as never, new CredentialCipherService(KEY)).create('owner-1', {
      nickname: ' Primary ', server: '  Broker\tDEMO  ', accountLogin: 42, password: 'secret',
    });
    expect(prisma.mt5Account.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ ownerId: 'owner-1', canonicalServer: 'broker demo', accountLogin: 42n, credentialCiphertext: expect.any(Uint8Array) }) }));
    expect(JSON.stringify(result)).not.toContain('credential');
  });

  it('locks before revalidating owner and hides foreign account existence', async () => {
    const prisma = createPrisma();
    prisma.mt5Account.findFirst.mockResolvedValue(null);
    await expect(new Mt5AccountsService(prisma as never, new CredentialCipherService(KEY)).update('other-owner', 'account-1', { nickname: 'x' })).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(prisma.mt5Account.findFirst).toHaveBeenCalledWith({ where: { id: 'account-1', ownerId: 'other-owner' } });
  });

  it('rejects credential mutation while an exact account lease is live', async () => {
    const prisma = createPrisma();
    prisma.mt5Account.findFirst.mockResolvedValue(row);
    prisma.mt5SyncLease.count.mockResolvedValue(1);
    await expect(new Mt5AccountsService(prisma as never, new CredentialCipherService(KEY)).update('owner-1', 'account-1', { password: 'new-secret' })).rejects.toThrow('synchronization is in progress');
    expect(prisma.mt5Account.update).not.toHaveBeenCalled();
  });

  it('atomically replaces linked identities and fences concurrent replacement', async () => {
    const prisma = createPrisma();
    prisma.mt5Account.findFirst.mockResolvedValue(row);
    prisma.mt5Deal.count.mockResolvedValue(1);
    prisma.mt5Account.create.mockResolvedValue({ ...row, id: 'account-2', canonicalServer: 'new-server' });
    prisma.mt5Account.updateMany.mockResolvedValue({ count: 1 });
    const result = await new Mt5AccountsService(prisma as never, new CredentialCipherService(KEY)).update('owner-1', 'account-1', { server: 'new-server', password: 'new-secret' });
    expect(result.id).toBe('account-2');
    expect(prisma.mt5Account.updateMany).toHaveBeenCalledWith({ where: { id: 'account-1', replacedById: null }, data: { active: false, replacedById: 'account-2' } });

    prisma.mt5Account.updateMany.mockResolvedValue({ count: 0 });
    await expect(new Mt5AccountsService(prisma as never, new CredentialCipherService(KEY)).update('owner-1', 'account-1', { server: 'other-server', password: 'new-secret' })).rejects.toBeInstanceOf(ConflictException);
  });
});
