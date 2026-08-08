import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const LIMIT = 10;

type ThrottlePurpose = 'login' | 'signup';
type ThrottleDimension = 'ip' | 'principal';

abstract class DatabaseThrottle {
  protected constructor(protected readonly prisma: PrismaService, private readonly purpose: ThrottlePurpose) {}

  private key(dimension: ThrottleDimension, value: string): Uint8Array<ArrayBuffer> {
    const secret = process.env.AUTH_THROTTLE_KEY;
    if (!secret || secret.length < 32) throw new Error('AUTH_THROTTLE_KEY must contain at least 32 characters');
    return Uint8Array.from(createHmac('sha256', secret).update(`${this.purpose}\0${dimension}\0${value}`).digest());
  }

  private keys(ip: string, principal: string): [Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>] {
    return [this.key('ip', ip), this.key('principal', principal)];
  }

  async assertAllowed(ip: string, principal: string): Promise<void> {
    const keys = this.keys(ip, principal);
    const rows = this.purpose === 'login'
      ? await this.prisma.loginThrottle.findMany({ where: { keyDigest: { in: keys } } })
      : await this.prisma.signupThrottle.findMany({ where: { keyDigest: { in: keys } } });
    if (rows.some((row) => row.blockedUntil && row.blockedUntil > new Date())) {
      throw new HttpException('Request temporarily unavailable', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  async fail(ip: string, principal: string): Promise<void> {
    const keys = this.keys(ip, principal);
    await this.prisma.$transaction(keys.map((keyDigest) => this.increment(keyDigest)));
  }

  private increment(keyDigest: Uint8Array<ArrayBuffer>): Prisma.PrismaPromise<number> {
    if (this.purpose === 'login') {
      return this.prisma.$executeRaw`
        INSERT INTO "login_throttles" ("key_digest", "failures", "blocked_until", "updated_at")
        VALUES (${keyDigest}, 1, NULL, NOW())
        ON CONFLICT ("key_digest") DO UPDATE SET
          "failures" = CASE
            WHEN "login_throttles"."updated_at" < NOW() - INTERVAL '15 minutes' THEN 1
            ELSE "login_throttles"."failures" + 1
          END,
          "blocked_until" = CASE
            WHEN (CASE WHEN "login_throttles"."updated_at" < NOW() - INTERVAL '15 minutes' THEN 1 ELSE "login_throttles"."failures" + 1 END) >= ${LIMIT}
              THEN NOW() + INTERVAL '15 minutes'
            ELSE NULL
          END,
          "updated_at" = NOW()
      `;
    }
    return this.prisma.$executeRaw`
      INSERT INTO "signup_throttles" ("key_digest", "attempts", "blocked_until", "updated_at")
      VALUES (${keyDigest}, 1, NULL, NOW())
      ON CONFLICT ("key_digest") DO UPDATE SET
        "attempts" = CASE
          WHEN "signup_throttles"."updated_at" < NOW() - INTERVAL '15 minutes' THEN 1
          ELSE "signup_throttles"."attempts" + 1
        END,
        "blocked_until" = CASE
          WHEN (CASE WHEN "signup_throttles"."updated_at" < NOW() - INTERVAL '15 minutes' THEN 1 ELSE "signup_throttles"."attempts" + 1 END) >= ${LIMIT}
            THEN NOW() + INTERVAL '15 minutes'
          ELSE NULL
        END,
        "updated_at" = NOW()
    `;
  }

  async clearPrincipal(principal: string): Promise<void> {
    if (this.purpose === 'login') {
      await this.prisma.loginThrottle.deleteMany({ where: { keyDigest: this.key('principal', principal) } });
    }
  }
}

@Injectable()
export class LoginThrottleService extends DatabaseThrottle { constructor(prisma: PrismaService) { super(prisma, 'login'); } }
@Injectable()
export class SignupThrottleService extends DatabaseThrottle { constructor(prisma: PrismaService) { super(prisma, 'signup'); } }
