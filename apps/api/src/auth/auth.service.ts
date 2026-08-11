import { BadRequestException, ConflictException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
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
    await this.loginThrottle.clearPrincipal(normalizedUsername);
    return this.sessions.create(user);
  }

  async updateCredentials(userId: string, currentPassword: unknown, username: unknown, newPassword: unknown, ip: string) {
    if (typeof currentPassword !== 'string' || currentPassword.length < 12 || currentPassword.length > 256) {
      throw new ForbiddenException('Current password is incorrect');
    }
    const changesUsername = username !== undefined;
    const changesPassword = newPassword !== undefined;
    if (!changesUsername && !changesPassword) throw new BadRequestException('No credential changes provided');
    if (changesUsername && (typeof username !== 'string' || username.trim().length < 3 || username.trim().length > 64)) {
      throw new BadRequestException('Invalid username');
    }
    if (changesPassword && (typeof newPassword !== 'string' || newPassword.length < 12 || newPassword.length > 256)) {
      throw new BadRequestException('Invalid password');
    }

    const user = await this.prisma.appUser.findUnique({ where: { id: userId } });
    const throttlePrincipal = user?.normalizedUsername ?? userId;
    await this.loginThrottle.assertAllowed(ip, throttlePrincipal);
    if (!user || !(await this.passwords.verify(currentPassword, user.passwordHash))) {
      await this.loginThrottle.fail(ip, throttlePrincipal);
      throw new ForbiddenException('Current password is incorrect');
    }
    await this.loginThrottle.clearPrincipal(throttlePrincipal);

    const data: Prisma.AppUserUpdateInput = { credentialVersion: { increment: 1 } };
    if (changesUsername) {
      data.username = (username as string).trim();
      data.normalizedUsername = normalizeUsername(username as string);
    }
    if (changesPassword) data.passwordHash = await this.passwords.hash(newPassword as string);

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.appUser.update({ where: { id: userId }, data });
        await tx.appSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Username already in use');
      }
      throw error;
    }
    return { status: 'credentials_updated' as const };
  }
}
