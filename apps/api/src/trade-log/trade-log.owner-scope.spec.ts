import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TradeLogService } from './trade-log.service';

function prismaMock() {
  return {
    trade: { findMany: jest.fn().mockResolvedValue([]) },
    mt5Account: { findFirst: jest.fn() },
  } as any;
}

describe('TradeLogService owner scopes', () => {
  it('defaults all reads to the authenticated owner', async () => {
    const prisma = prismaMock();
    await new TradeLogService(prisma).getStats('owner-a');
    expect(prisma.trade.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ ownerId: 'owner-a' }) }));
  });

  it('keeps manual scope on null-account owner data', async () => {
    const prisma = prismaMock();
    await new TradeLogService(prisma).getStats('owner-a', { scope: 'manual' });
    expect(prisma.trade.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ ownerId: 'owner-a', mt5AccountId: null }) }));
  });

  it('rejects foreign account scope and malformed combinations', async () => {
    const prisma = prismaMock();
    prisma.mt5Account.findFirst.mockResolvedValue(null);
    await expect(new TradeLogService(prisma).getStats('owner-a', { scope: 'account', accountId: 'foreign' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(new TradeLogService(prisma).getStats('owner-a', { scope: 'manual', accountId: 'account-1' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.trade.findMany).not.toHaveBeenCalled();
  });
});
