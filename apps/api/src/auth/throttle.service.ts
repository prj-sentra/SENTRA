import { Injectable, TooManyRequestsException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

const WINDOW_MS = 15 * 60 * 1000;
const LIMIT = 10;

abstract class DatabaseThrottle {
  protected constructor(protected readonly prisma: PrismaService, private readonly purpose: 'login' | 'signup') {}

  protected key(ip: string, principal: string): Buffer {
    const secret = process.env.AUTH_THROTTLE_KEY;
    if (!secret || secret.length < 32) throw new Error('AUTH_THROTTLE_KEY must contain at least 32 characters');
    return createHmac('sha256', secret).update(`${this.purpose}\0${ip}\0${principal}`).digest();
  }

  async assertAllowed(ip: string, principal: string): Promise<void> {
    const keyDigest = this.key(ip, principal);
    const row = this.purpose === 'login'
      ? await this.prisma.loginThrottle.findUnique({ where: { keyDigest } })
      : await this.prisma.signupThrottle.findUnique({ where: { keyDigest } });
    if (row?.blockedUntil && row.blockedUntil > new Date()) throw new TooManyRequestsException('Request temporarily unavailable');
  }

  async fail(ip: string, principal: string): Promise<void> {
    const keyDigest = this.key(ip, principal);
    const now = new Date();
    if (this.purpose === 'login') {
      const current = await this.prisma.loginThrottle.findUnique({ where: { keyDigest } });
      const failures = (current?.updatedAt && now.getTime() - current.updatedAt.getTime() < WINDOW_MS ? current.failures : 0) + 1;
      await this.prisma.loginThrottle.upsert({ where: { keyDigest }, create: { keyDigest, failures, blockedUntil: failures >= LIMIT ? new Date(now.getTime() + WINDOW_MS) : null }, update: { failures, blockedUntil: failures >= LIMIT ? new Date(now.getTime() + WINDOW_MS) : null } });
    } else {
      const current = await this.prisma.signupThrottle.findUnique({ where: { keyDigest } });
      const attempts = (current?.updatedAt && now.getTime() - current.updatedAt.getTime() < WINDOW_MS ? current.attempts : 0) + 1;
      await this.prisma.signupThrottle.upsert({ where: { keyDigest }, create: { keyDigest, attempts, blockedUntil: attempts >= LIMIT ? new Date(now.getTime() + WINDOW_MS) : null }, update: { attempts, blockedUntil: attempts >= LIMIT ? new Date(now.getTime() + WINDOW_MS) : null } });
    }
  }

  async clear(ip: string, principal: string): Promise<void> {
    if (this.purpose === 'login') await this.prisma.loginThrottle.deleteMany({ where: { keyDigest: this.key(ip, principal) } });
  }
}

@Injectable()
export class LoginThrottleService extends DatabaseThrottle { constructor(prisma: PrismaService) { super(prisma, 'login'); } }
@Injectable()
export class SignupThrottleService extends DatabaseThrottle { constructor(prisma: PrismaService) { super(prisma, 'signup'); } }
