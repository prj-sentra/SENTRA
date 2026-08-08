import { INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';

const json = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('authentication HTTP acceptance', () => {
  let app: INestApplication;
  let baseUrl: string;
  const auth = { signup: jest.fn(), login: jest.fn() };
  const sessions = { revoke: jest.fn() };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: SessionService, useValue: sessions },
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
    expect(login.status).toBe(200);
    expect(cookie).toContain('tj_session=opaque-session-token');
    expect(cookie.toLowerCase()).toContain('httponly');

    const logout = await fetch(`${baseUrl}/auth/logout`, { method: 'POST', headers: { cookie } });
    expect(logout.status).toBe(204);
    expect(sessions.revoke).toHaveBeenCalledWith('opaque-session-token');
    expect(logout.headers.get('set-cookie')).toContain('tj_session=;');
  });

  it.each(['PENDING', 'DISABLED'])('does not issue a cookie when %s login is rejected', async () => {
    auth.login.mockRejectedValue(new UnauthorizedException('Invalid credentials'));
    const response = await fetch(`${baseUrl}/auth/login`, json({ username: 'blocked', password: 'long-enough-password' }));
    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});
