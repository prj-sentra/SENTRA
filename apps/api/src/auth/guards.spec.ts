import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OriginGuard, SessionAuthGuard } from './guards';

const contextFor = (request: Record<string, unknown>) => ({ switchToHttp: () => ({ getRequest: () => request }), getHandler: () => function handler() {}, getClass: () => class Controller {} }) as unknown as ExecutionContext;

describe('authentication guards', () => {
  afterEach(() => delete process.env.WEB_ORIGIN);
  it('requires an exact Origin for every mutation', () => {
    process.env.WEB_ORIGIN = 'https://journal.example'; const guard = new OriginGuard();
    expect(() => guard.canActivate(contextFor({ method: 'POST', headers: { origin: 'https://evil.example' } }))).toThrow(ForbiddenException);
    expect(guard.canActivate(contextFor({ method: 'POST', headers: { origin: 'https://journal.example' } }))).toBe(true);
  });
  it('denies an undecorated route without a valid session', async () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(undefined) } as unknown as Reflector;
    const sessions = { authenticate: jest.fn() };
    const guard = new SessionAuthGuard(reflector, sessions as never);
    await expect(guard.canActivate(contextFor({ method: 'GET', path: '/private', headers: {} }))).rejects.toThrow(UnauthorizedException);
  });
});
