import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthService } from './auth.service';

const password = 'long-enough-password';
const user = { id: 'user-1', normalizedUsername: 'person', passwordHash: 'hash', status: 'ACTIVE' };

const makeService = (status: string) => {
  const prisma = { appUser: { findUnique: jest.fn().mockResolvedValue({ ...user, status }) } };
  const passwords = { verify: jest.fn().mockResolvedValue(true) };
  const sessions = { create: jest.fn().mockResolvedValue({ token: 'session' }) };
  const loginThrottle = { assertAllowed: jest.fn(), fail: jest.fn(), clearPrincipal: jest.fn() };
  const signupThrottle = {};
  return { service: new AuthService(prisma as never, passwords as never, sessions as never, loginThrottle as never, signupThrottle as never), sessions, loginThrottle };
};

describe('AuthService account-state acceptance', () => {
  it('creates sessions only for active users', async () => {
    const { service, sessions, loginThrottle } = makeService('ACTIVE');
    await expect(service.login(' Person ', password, '127.0.0.1')).resolves.toEqual({ token: 'session' });
    expect(sessions.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'ACTIVE' }));
    expect(loginThrottle.clearPrincipal).toHaveBeenCalledWith('person');
  });

  it.each(['PENDING', 'DISABLED'])('rejects %s with the same generic response', async (status) => {
    const { service, sessions, loginThrottle } = makeService(status);
    await expect(service.login('person', password, '127.0.0.1')).rejects.toEqual(new UnauthorizedException('Invalid credentials'));
    expect(sessions.create).not.toHaveBeenCalled();
    expect(loginThrottle.fail).toHaveBeenCalledWith('127.0.0.1', 'person');
  });
});

describe('AuthService credential updates', () => {
  function setup(verified = true) {
    const update = jest.fn().mockResolvedValue(user);
    const updateMany = jest.fn().mockResolvedValue({ count: 2 });
    const tx = { appUser: { update }, appSession: { updateMany } };
    const prisma = {
      appUser: { findUnique: jest.fn().mockResolvedValue(user) },
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const passwords = {
      verify: jest.fn().mockResolvedValue(verified),
      hash: jest.fn().mockResolvedValue('new-hash'),
    };
    const loginThrottle = { assertAllowed: jest.fn(), fail: jest.fn(), clearPrincipal: jest.fn() };
    const service = new AuthService(prisma as never, passwords as never, {} as never, loginThrottle as never, {} as never);
    return { service, prisma, passwords, loginThrottle, update, updateMany };
  }

  it('updates normalized username and password atomically, then revokes every session', async () => {
    const { service, passwords, update, updateMany } = setup();

    await expect(service.updateCredentials(user.id, password, ' New Person ', 'new-long-enough-password', '127.0.0.1'))
      .resolves.toEqual({ status: 'credentials_updated' });

    expect(passwords.verify).toHaveBeenCalledWith(password, 'hash');
    expect(passwords.hash).toHaveBeenCalledWith('new-long-enough-password');
    expect(update).toHaveBeenCalledWith({
      where: { id: user.id },
      data: {
        username: 'New Person',
        normalizedUsername: 'new person',
        passwordHash: 'new-hash',
        credentialVersion: { increment: 1 },
      },
    });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: user.id, revokedAt: null } }));
  });

  it('rejects an incorrect current password without changing credentials', async () => {
    const { service, loginThrottle, update } = setup(false);

    await expect(service.updateCredentials(user.id, password, 'new-person', undefined, '127.0.0.1'))
      .rejects.toEqual(new ForbiddenException('Current password is incorrect'));
    expect(loginThrottle.assertAllowed).toHaveBeenCalledWith('127.0.0.1', 'person');
    expect(loginThrottle.fail).toHaveBeenCalledWith('127.0.0.1', 'person');
    expect(update).not.toHaveBeenCalled();
  });

  it('reports username collisions without revoking sessions', async () => {
    const { service, update, updateMany } = setup();
    update.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('duplicate', {
      code: 'P2002',
      clientVersion: 'test',
    }));

    await expect(service.updateCredentials(user.id, password, 'existing-user', undefined, '127.0.0.1'))
      .rejects.toEqual(new ConflictException('Username already in use'));
    expect(updateMany).not.toHaveBeenCalled();
  });
});
