import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CredentialCipherService,
  CredentialEnvelope,
} from './credential-cipher.service';
import {
  CreateMt5AccountInput,
  PatchMt5AccountInput,
  canonicalizeServer,
  validateCreateAccount,
  validatePatchAccount,
} from './mt5-accounts.validation';

const safeAccountSelect = {
  id: true,
  nickname: true,
  canonicalServer: true,
  accountLogin: true,
  active: true,
  replacedById: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.Mt5AccountSelect;

type SafeAccountRow = Prisma.Mt5AccountGetPayload<{ select: typeof safeAccountSelect }>;

export interface SafeMt5Account {
  id: string;
  nickname: string;
  server: string;
  accountLogin: number;
  active: boolean;
  replacedById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const serializeAccount = (account: SafeAccountRow): SafeMt5Account => ({
  id: account.id,
  nickname: account.nickname,
  server: account.canonicalServer,
  accountLogin: Number(account.accountLogin),
  active: account.active,
  replacedById: account.replacedById,
  createdAt: account.createdAt,
  updatedAt: account.updatedAt,
});

@Injectable()
export class Mt5AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: CredentialCipherService,
  ) {}

  async create(ownerId: string, request: unknown): Promise<SafeMt5Account> {
    const input = validateCreateAccount(request);
    const envelope = this.cipher.encrypt(input.password);
    try {
      const account = await this.prisma.mt5Account.create({
        data: {
          ownerId,
          nickname: input.nickname,
          canonicalServer: input.server,
          accountLogin: BigInt(input.accountLogin),
          ...this.envelopeData(envelope),
        },
        select: safeAccountSelect,
      });
      return serializeAccount(account);
    } catch (error) {
      this.rethrowConflict(error);
    }
  }

  async list(ownerId: string): Promise<SafeMt5Account[]> {
    const accounts = await this.prisma.mt5Account.findMany({
      where: { ownerId },
      orderBy: [{ active: 'desc' }, { createdAt: 'asc' }],
      select: safeAccountSelect,
    });
    return accounts.map(serializeAccount);
  }

  async update(ownerId: string, id: string, request: unknown): Promise<SafeMt5Account> {
    const patch = validatePatchAccount(request);
    const current = await this.prisma.mt5Account.findFirst({
      where: { id, ownerId },
    });
    if (!current) throw new NotFoundException('MT5 account not found');
    if (patch.active === true && current.replacedById) {
      throw new ConflictException('A replaced MT5 account cannot be reactivated');
    }

    const server = patch.server ?? current.canonicalServer;
    const login = patch.accountLogin ?? Number(current.accountLogin);
    const identityChanged =
      server !== current.canonicalServer || BigInt(login) !== current.accountLogin;

    try {
      if (identityChanged && (await this.isLinked(id))) {
        if (!patch.password) {
          throw new ConflictException('A new password is required to replace a linked MT5 identity');
        }
        return await this.replaceLinked(ownerId, current, patch, server, login);
      }

      const envelope = patch.password ? this.cipher.encrypt(patch.password) : undefined;
      const account = await this.prisma.mt5Account.update({
        where: { id },
        data: {
          ...(patch.nickname !== undefined && { nickname: patch.nickname }),
          ...(identityChanged && {
            canonicalServer: canonicalizeServer(server),
            accountLogin: BigInt(login),
          }),
          ...(patch.active !== undefined && { active: patch.active }),
          ...(envelope && this.envelopeData(envelope)),
        },
        select: safeAccountSelect,
      });
      return serializeAccount(account);
    } catch (error) {
      this.rethrowConflict(error);
    }
  }

  async deactivate(ownerId: string, id: string): Promise<SafeMt5Account> {
    return this.update(ownerId, id, { active: false });
  }

  private async isLinked(accountId: string): Promise<boolean> {
    const [trades, campaigns, deals, orders, syncStatuses, leases] = await Promise.all([
      this.prisma.trade.count({ where: { mt5AccountId: accountId } }),
      this.prisma.tradeCampaign.count({ where: { mt5AccountId: accountId } }),
      this.prisma.mt5Deal.count({ where: { accountId } }),
      this.prisma.mt5Order.count({ where: { accountId } }),
      this.prisma.mt5SyncStatus.count({ where: { accountId } }),
      this.prisma.mt5SyncLease.count({ where: { accountId } }),
    ]);
    return trades + campaigns + deals + orders + syncStatuses + leases > 0;
  }

  private async replaceLinked(
    ownerId: string,
    current: { id: string; nickname: string },
    patch: PatchMt5AccountInput,
    server: string,
    login: number,
  ): Promise<SafeMt5Account> {
    const envelope = this.cipher.encrypt(patch.password as string);
    return this.prisma.$transaction(async (tx) => {
      const replacement = await tx.mt5Account.create({
        data: {
          ownerId,
          nickname: patch.nickname ?? current.nickname,
          canonicalServer: server,
          accountLogin: BigInt(login),
          active: patch.active ?? true,
          ...this.envelopeData(envelope),
        },
        select: safeAccountSelect,
      });
      await tx.mt5Account.update({
        where: { id: current.id },
        data: { active: false, replacedById: replacement.id },
      });
      return serializeAccount(replacement);
    });
  }

  private envelopeData(envelope: CredentialEnvelope) {
    return {
      credentialCiphertext: Uint8Array.from(envelope.ciphertext),
      credentialIv: Uint8Array.from(envelope.iv),
      credentialTag: Uint8Array.from(envelope.tag),
      credentialVersion: envelope.version,
    };
  }

  private rethrowConflict(error: unknown): never {
    if (error instanceof ConflictException) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ConflictException('MT5 account identity is already registered');
    }
    throw error;
  }
}
