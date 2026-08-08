import { ConflictException, NotFoundException } from '@nestjs/common';
import { CredentialCipherService } from './credential-cipher.service';
import { Mt5AccountsService } from './mt5-accounts.service';

const KEY = Buffer.alloc(32, 5).toString('base64');
const now = new Date('2026-08-08T00:00:00Z');
const row = {
  id: 'account-1',
  ownerId: 'owner-1',
  nickname: 'Primary',
  canonicalServer: 'broker demo',
  accountLogin: 42n,
  credentialCiphertext: Buffer.from('ciphertext'),
  credentialIv: Buffer.alloc(12),
  credentialTag: Buffer.alloc(16),
  credentialVersion: 1,
  active: true,
  replacedById: null,
  createdAt: now,
  updatedAt: now,
};

const createPrisma = () => ({
  mt5Account: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  trade: { count: jest.fn().mockResolvedValue(0) },
  tradeCampaign: { count: jest.fn().mockResolvedValue(0) },
  mt5Deal: { count: jest.fn().mockResolvedValue(0) },
  mt5Order: { count: jest.fn().mockResolvedValue(0) },
  mt5SyncStatus: { count: jest.fn().mockResolvedValue(0) },
  $transaction: jest.fn(),
});

describe('Mt5AccountsService', () => {
  it('canonicalizes identity, encrypts credentials, and returns no secret fields', async () => {
    const prisma = createPrisma();
    prisma.mt5Account.create.mockResolvedValue(row);
    const service = new Mt5AccountsService(prisma as never, new CredentialCipherService(KEY));

    const result = await service.create('owner-1', {
      nickname: ' Primary ',
      server: '  Broker\tDEMO  ',
      accountLogin: 42,
      password: 'secret',
    });

    expect(prisma.mt5Account.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        ownerId: 'owner-1',
        canonicalServer: 'broker demo',
        accountLogin: 42n,
        credentialCiphertext: expect.any(Buffer),
      }),
    }));
    expect(result).toEqual({
      id: 'account-1', nickname: 'Primary', server: 'broker demo', accountLogin: 42,
      active: true, replacedById: null, createdAt: now, updatedAt: now,
    });
    expect(JSON.stringify(result)).not.toContain('credential');
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('scopes updates by owner and hides foreign account existence', async () => {
    const prisma = createPrisma();
    prisma.mt5Account.findFirst.mockResolvedValue(null);
    const service = new Mt5AccountsService(prisma as never, new CredentialCipherService(KEY));

    await expect(service.update('other-owner', 'account-1', { nickname: 'x' }))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.mt5Account.findFirst).toHaveBeenCalledWith({
      where: { id: 'account-1', ownerId: 'other-owner' },
    });
  });

  it('requires a fresh password to replace a linked identity', async () => {
    const prisma = createPrisma();
    prisma.mt5Account.findFirst.mockResolvedValue(row);
    prisma.trade.count.mockResolvedValue(1);
    const service = new Mt5AccountsService(prisma as never, new CredentialCipherService(KEY));

    await expect(service.update('owner-1', 'account-1', { server: 'new-server' }))
      .rejects.toBeInstanceOf(ConflictException);
    expect(prisma.mt5Account.update).not.toHaveBeenCalled();
  });

  it('atomically replaces linked identities and deactivates the original', async () => {
    const prisma = createPrisma();
    prisma.mt5Account.findFirst.mockResolvedValue(row);
    prisma.mt5Deal.count.mockResolvedValue(1);
    const replacement = { ...row, id: 'account-2', canonicalServer: 'new-server' };
    const tx = {
      mt5Account: {
        create: jest.fn().mockResolvedValue(replacement),
        update: jest.fn().mockResolvedValue(undefined),
      },
    };
    prisma.$transaction.mockImplementation(async (callback) => callback(tx));
    const service = new Mt5AccountsService(prisma as never, new CredentialCipherService(KEY));

    const result = await service.update('owner-1', 'account-1', {
      server: 'new-server', password: 'new-secret',
    });

    expect(result.id).toBe('account-2');
    expect(tx.mt5Account.update).toHaveBeenCalledWith({
      where: { id: 'account-1' },
      data: { active: false, replacedById: 'account-2' },
    });
  });
});
