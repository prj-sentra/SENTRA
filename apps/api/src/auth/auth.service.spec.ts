import { UnauthorizedException } from '@nestjs/common';
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
