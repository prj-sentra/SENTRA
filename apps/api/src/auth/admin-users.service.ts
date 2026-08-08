import { ConflictException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { AppUserStatus, UserStateAuditAction } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeUsername } from './auth.service';
import { PasswordService } from './password.service';

const safeUser = ({ passwordHash: _hash, ...user }: { passwordHash: string; [key: string]: unknown }) => user;

@Injectable()
export class AdminUsersService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService, private readonly passwords: PasswordService) {}

  async onModuleInit(): Promise<void> {
    const username = process.env.INITIAL_ADMIN_USERNAME, password = process.env.INITIAL_ADMIN_PASSWORD;
    if (!username && !password) return;
    if (!username || !password || password.length < 12) throw new Error('Initial administrator credentials are incomplete');
    const normalizedUsername = normalizeUsername(username);
    const passwordHash = await this.passwords.hash(password);
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(7465726164696)`;
      if (await tx.appUser.findFirst({ where: { isAdmin: true } })) return;
      const sentinel = await tx.appUser.findFirst({ where: { legacyOwner: true } });
      if (!sentinel || sentinel.status !== 'DISABLED') throw new Error('Legacy owner sentinel is unavailable for administrator bootstrap');
      const collision = await tx.appUser.findFirst({ where: { normalizedUsername, id: { not: sentinel.id } } });
      if (collision) throw new Error('Initial administrator username collides with an existing user');
      const now = new Date();
      const user = await tx.appUser.update({
        where: { id: sentinel.id },
        data: {
          username: username.trim(), normalizedUsername, passwordHash, status: 'ACTIVE', isAdmin: true,
          bootstrapCompletedAt: now, approvedAt: now, disabledAt: null, disabledById: null,
          stateVersion: { increment: 1 }, credentialVersion: { increment: 1 },
        },
      });
      await tx.userStateAudit.create({ data: { actorId: user.id, subjectId: user.id, action: 'BOOTSTRAP', fromStatus: 'DISABLED', toStatus: 'ACTIVE' } });
    });
  }

  async pending(actor: { isAdmin: boolean }, page = 1, pageSize = 50) {
    this.assertAdmin(actor); const take = Math.min(Math.max(pageSize, 1), 100); const skip = (Math.max(page, 1) - 1) * take;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.appUser.findMany({ where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' }, skip, take }),
      this.prisma.appUser.count({ where: { status: 'PENDING' } }),
    ]);
    return { items: items.map(safeUser), total, page: Math.max(page, 1), pageSize: take };
  }

  async transition(actor: { id: string; isAdmin: boolean }, subjectId: string, action: UserStateAuditAction) {
    this.assertAdmin(actor);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(7465726164696)`;
      const subject = await tx.appUser.findUnique({ where: { id: subjectId } });
      if (!subject) throw new NotFoundException();
      const rules: Partial<Record<UserStateAuditAction, [AppUserStatus[], AppUserStatus]>> = {
        APPROVE: [['PENDING'], 'ACTIVE'], REJECT: [['PENDING'], 'DISABLED'],
        DISABLE: [['ACTIVE', 'PENDING'], 'DISABLED'], ENABLE: [['DISABLED'], 'ACTIVE'],
      };
      const rule = rules[action]; if (!rule || !rule[0].includes(subject.status)) throw new ConflictException('Invalid user state transition');
      if (action === 'DISABLE' && subject.isAdmin && await tx.appUser.count({ where: { isAdmin: true, status: 'ACTIVE' } }) <= 1) throw new ConflictException('Cannot disable the final active administrator');
      const now = new Date();
      const updated = await tx.appUser.update({ where: { id: subject.id, stateVersion: subject.stateVersion }, data: {
        status: rule[1], stateVersion: { increment: 1 },
        approvedAt: action === 'APPROVE' || action === 'ENABLE' ? now : subject.approvedAt,
        approvedById: action === 'APPROVE' || action === 'ENABLE' ? actor.id : subject.approvedById,
        disabledAt: action === 'DISABLE' || action === 'REJECT' ? now : null,
        disabledById: action === 'DISABLE' || action === 'REJECT' ? actor.id : null,
      }});
      if (rule[1] !== 'ACTIVE') await tx.appSession.updateMany({ where: { userId: subject.id, revokedAt: null }, data: { revokedAt: now } });
      await tx.userStateAudit.create({ data: { actorId: actor.id, subjectId, action, fromStatus: subject.status, toStatus: rule[1] } });
      return safeUser(updated);
    });
  }

  async resetPassword(actor: { id: string; isAdmin: boolean }, subjectId: string, password: unknown) {
    this.assertAdmin(actor); if (typeof password !== 'string' || password.length < 12 || password.length > 256) throw new ConflictException('Invalid password');
    const passwordHash = await this.passwords.hash(password);
    return this.prisma.$transaction(async (tx) => {
      const subject = await tx.appUser.findUnique({ where: { id: subjectId } }); if (!subject) throw new NotFoundException();
      const now = new Date();
      const updated = await tx.appUser.update({ where: { id: subjectId }, data: { passwordHash, credentialVersion: { increment: 1 } } });
      await tx.appSession.updateMany({ where: { userId: subjectId, revokedAt: null }, data: { revokedAt: now } });
      await tx.userStateAudit.create({ data: { actorId: actor.id, subjectId, action: 'RESET_PASSWORD', fromStatus: subject.status, toStatus: subject.status } });
      return safeUser(updated);
    });
  }

  private assertAdmin(actor: { isAdmin: boolean }): void { if (!actor.isAdmin) throw new ForbiddenException(); }
}
