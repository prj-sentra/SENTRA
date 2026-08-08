import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import { LoginThrottleService, SignupThrottleService } from './throttle.service';
const DUMMY_PASSWORD_HASH = 'scrypt$WlpaWlpaWlpaWlpaWlpaWg==$MFl3+o4b4jw1S3dqsGZtoiZbzwdUEVqKbVa64bkUDUx3W9KmDuD7QIWaNBsqtmLdJlF/alao6NGV7B8PVEXAeA==';

export function normalizeUsername(value: string): string { return value.trim().normalize('NFKC').toLocaleLowerCase('en-US'); }
export function validateCredentials(username: unknown, password: unknown): asserts username is string {
  if (typeof username !== 'string' || username.trim().length < 3 || username.trim().length > 64 ||
      typeof password !== 'string' || password.length < 12 || password.length > 256) throw new UnauthorizedException('Invalid credentials');
}

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService, private readonly passwords: PasswordService,
    private readonly sessions: SessionService, private readonly loginThrottle: LoginThrottleService,
    private readonly signupThrottle: SignupThrottleService) {}

  async signup(username: unknown, password: unknown, ip: string): Promise<void> {
    validateCredentials(username, password);
    const normalizedUsername = normalizeUsername(username);
    await this.signupThrottle.assertAllowed(ip, normalizedUsername);
    await this.signupThrottle.fail(ip, normalizedUsername);
    const existing = await this.prisma.appUser.findUnique({ where: { normalizedUsername } });
    if (existing) { await this.passwords.verify(password as string, existing.passwordHash); return; }
    const passwordHash = await this.passwords.hash(password as string);
    try { await this.prisma.appUser.create({ data: { username: username.trim(), normalizedUsername, passwordHash } }); }
    catch (error) { if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error; }
  }

  async login(username: unknown, password: unknown, ip: string) {
    let normalizedUsername = 'invalid';
    try { validateCredentials(username, password); normalizedUsername = normalizeUsername(username); }
    catch { /* perform dummy password work below */ }
    await this.loginThrottle.assertAllowed(ip, normalizedUsername);
    const user = await this.prisma.appUser.findUnique({ where: { normalizedUsername } });
    const candidateHash = user?.passwordHash ?? DUMMY_PASSWORD_HASH;
    const verified = typeof password === 'string' && await this.passwords.verify(password, candidateHash);
    if (!user || !verified || user.status !== 'ACTIVE') {
      await this.loginThrottle.fail(ip, normalizedUsername);
      throw new UnauthorizedException('Invalid credentials');
    }
    await this.loginThrottle.clear(ip, normalizedUsername);
    return this.sessions.create(user);
  }
}
