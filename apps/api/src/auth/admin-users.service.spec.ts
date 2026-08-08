import { AdminUsersService } from './admin-users.service';

const sentinel = {
  id: '00000000-0000-0000-0000-000000000001',
  status: 'DISABLED',
  legacyOwner: true,
};

describe('AdminUsersService bootstrap', () => {
  const previous = { ...process.env };

  beforeEach(() => {
    process.env.INITIAL_ADMIN_USERNAME = ' Owner ';
    process.env.INITIAL_ADMIN_PASSWORD = 'correct horse battery staple';
  });
  afterEach(() => { process.env = { ...previous }; });

  it('atomically activates the disabled legacy owner rather than creating another user', async () => {
    const tx = {
      $executeRaw: jest.fn(),
      appUser: {
        findFirst: jest.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(sentinel)
          .mockResolvedValueOnce(null),
        update: jest.fn().mockResolvedValue({ ...sentinel, username: 'Owner', status: 'ACTIVE' }),
        create: jest.fn(),
      },
      userStateAudit: { create: jest.fn() },
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const passwords = { hash: jest.fn().mockResolvedValue('hash') };

    await new AdminUsersService(prisma as never, passwords as never).onModuleInit();

    expect(tx.appUser.create).not.toHaveBeenCalled();
    expect(tx.appUser.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: sentinel.id },
      data: expect.objectContaining({ normalizedUsername: 'owner', status: 'ACTIVE', isAdmin: true, passwordHash: 'hash' }),
    }));
    expect(tx.userStateAudit.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actorId: sentinel.id, fromStatus: 'DISABLED', toStatus: 'ACTIVE' }) });
  });

  it('fails closed when the legacy sentinel is missing', async () => {
    const tx = { $executeRaw: jest.fn(), appUser: { findFirst: jest.fn().mockResolvedValue(null) } };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    await expect(new AdminUsersService(prisma as never, { hash: jest.fn().mockResolvedValue('hash') } as never).onModuleInit())
      .rejects.toThrow('Legacy owner sentinel is unavailable');
  });
});
