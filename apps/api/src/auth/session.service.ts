import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

export const SESSION_COOKIE = 'tj_session';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  digest(token: string): Uint8Array<ArrayBuffer> {
    return Uint8Array.from(createHash('sha256').update(token, 'utf8').digest());
  }

  async create(user: { id: string; stateVersion: number; credentialVersion: number }) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await this.prisma.appSession.create({ data: {
      userId: user.id, tokenDigest: this.digest(token), expiresAt,
      userStateVersion: user.stateVersion, credentialVersion: user.credentialVersion,
    }});
    return { token, expiresAt };
  }

  async authenticate(token: string) {
    const session = await this.prisma.appSession.findUnique({
      where: { tokenDigest: this.digest(token) },
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;
    const sessionUser = await this.prisma.appUser.findUnique({ where: { id: session.userId } });
    if (!sessionUser || sessionUser.status !== 'ACTIVE' || sessionUser.stateVersion !== session.userStateVersion ||
        sessionUser.credentialVersion !== session.credentialVersion) return null;
    const { passwordHash: _passwordHash, ...user } = sessionUser;
    return { sessionId: session.id, user };
  }

  async revoke(token: string): Promise<void> {
    await this.prisma.appSession.updateMany({
      where: { tokenDigest: this.digest(token), revokedAt: null }, data: { revokedAt: new Date() },
    });
  }

  async revokeAll(userId: string, tx: PrismaService = this.prisma): Promise<void> {
    await tx.appSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
}

export function readSessionCookie(header: string | undefined): string | undefined {
  return header?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
}
