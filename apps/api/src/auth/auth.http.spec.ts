import { ForbiddenException, INestApplication, UnauthorizedException } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { OriginGuard, SessionAuthGuard } from './guards';

const json = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://journal.test' }, body: JSON.stringify(body) });

describe('authentication HTTP acceptance', () => {
  let app: INestApplication;
  let baseUrl: string;
  const auth = { signup: jest.fn(), login: jest.fn(), updateCredentials: jest.fn() };
  const sessions = { revoke: jest.fn(), authenticate: jest.fn() };

  beforeAll(async () => {
    process.env.WEB_ORIGIN = 'https://journal.test';
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: SessionService, useValue: sessions },
        { provide: APP_GUARD, useClass: OriginGuard },
        { provide: APP_GUARD, useClass: SessionAuthGuard },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address();
    baseUrl = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => app.close());
  beforeEach(() => jest.clearAllMocks());

  it('keeps public signup enumeration-safe over the real HTTP adapter', async () => {
    auth.signup.mockResolvedValue(undefined);
    const first = await fetch(`${baseUrl}/auth/signup`, json({ username: 'new-user', password: 'long-enough-password' }));
    const existing = await fetch(`${baseUrl}/auth/signup`, json({ username: 'existing', password: 'long-enough-password' }));
    expect(first.status).toBe(202);
    expect(existing.status).toBe(202);
    expect(await first.json()).toEqual(await existing.json());
  });

  it('sets an HttpOnly session cookie and current logout revokes and clears it', async () => {
    auth.login.mockResolvedValue({ token: 'opaque-session-token' });
    const login = await fetch(`${baseUrl}/auth/login`, json({ username: 'active', password: 'long-enough-password' }));
    const cookie = login.headers.get('set-cookie')!;
    sessions.authenticate = jest.fn().mockResolvedValue({ user: { id: 'owner-1' }, sessionId: 'session-1' });
    expect(login.status).toBe(200);
    expect(cookie).toContain('tj_session=opaque-session-token');
    expect(cookie.toLowerCase()).toContain('httponly');

    const logout = await fetch(`${baseUrl}/auth/logout`, { method: 'POST', headers: { cookie, origin: 'https://journal.test' } });
    expect(logout.status).toBe(204);
    expect(sessions.revoke).toHaveBeenCalledWith('opaque-session-token');
    expect(logout.headers.get('set-cookie')).toContain('tj_session=;');
  });

  it('clears the session cookie after an authenticated credential update', async () => {
    sessions.authenticate.mockResolvedValue({ user: { id: 'owner-1' }, sessionId: 'session-1' });
    auth.updateCredentials.mockResolvedValue({ status: 'credentials_updated' });

    const response = await fetch(`${baseUrl}/auth/credentials`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: 'tj_session=current-token', origin: 'https://journal.test' },
      body: JSON.stringify({ currentPassword: 'long-enough-password', username: 'new-owner' }),
    });

    expect(response.status).toBe(200);
    expect(auth.updateCredentials).toHaveBeenCalledWith('owner-1', 'long-enough-password', 'new-owner', undefined, expect.any(String));
    expect(response.headers.get('set-cookie')).toContain('tj_session=;');
  });

  it('keeps the cookie and returns 403 when current-password confirmation fails', async () => {
    sessions.authenticate.mockResolvedValue({ user: { id: 'owner-1' }, sessionId: 'session-1' });
    auth.updateCredentials.mockRejectedValue(new ForbiddenException('Current password is incorrect'));

    const response = await fetch(`${baseUrl}/auth/credentials`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: 'tj_session=current-token', origin: 'https://journal.test' },
      body: JSON.stringify({ currentPassword: 'wrong-password-value', username: 'new-owner' }),
    });

    expect(response.status).toBe(403);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it.each(['PENDING', 'DISABLED'])('does not issue a cookie when %s login is rejected', async () => {
    auth.login.mockRejectedValue(new UnauthorizedException('Invalid credentials'));
    const response = await fetch(`${baseUrl}/auth/login`, json({ username: 'blocked', password: 'long-enough-password' }));
    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('enforces exact Origin and authentication through application-global guards', async () => {
    auth.login.mockResolvedValue({ token: 'unused' });
    const wrongOrigin = await fetch(`${baseUrl}/auth/login`, { ...json({ username: 'active', password: 'long-enough-password' }), headers: { 'content-type': 'application/json', origin: 'https://evil.test' } });
    expect(wrongOrigin.status).toBe(403);
    sessions.authenticate = jest.fn().mockResolvedValue(null);
    const unauthenticated = await fetch(`${baseUrl}/auth/logout`, { method: 'POST', headers: { origin: 'https://journal.test' } });
    expect(unauthenticated.status).toBe(401);
  });
});
