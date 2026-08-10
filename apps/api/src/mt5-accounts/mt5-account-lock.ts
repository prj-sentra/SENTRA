import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export async function lockOwnedMt5Account(
  tx: Prisma.TransactionClient,
  ownerId: string,
  accountId: string,
): Promise<{ id: string; canonicalServer: string; accountLogin: bigint }> {
  const accounts = await tx.$queryRaw<Array<{ id: string; canonicalServer: string; accountLogin: bigint }>>(
    Prisma.sql`SELECT id, canonical_server AS "canonicalServer", account_login AS "accountLogin" FROM mt5_accounts WHERE id = ${accountId} AND owner_id = ${ownerId} FOR UPDATE`,
  );
  const account = accounts[0];
  if (!account) throw new NotFoundException('MT5 account not found');
  await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${account.canonicalServer}:${account.accountLogin}`}, 0))::text AS locked`);
  return account;
}
