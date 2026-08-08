import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { TradeLogService } from './trade-log.service';

const rawTrade = {
  id: 'trade-1', ownerId: 'owner-1', symbol: 'XAUUSD', side: 'LONG', status: 'PLANNED',
  strategy: null, thesis: null, entryRationale: null, exitRationale: null,
  takeProfitCriteria: null, stopLossCriteria: null, note: null, accountCurrency: null,
  quantityLots: null, entryPrice: null, exitPrice: null, exitReason: null, realizedPnl: null,
  takeProfitPrice: null, stopLossPrice: null, openedAt: null, closedAt: null,
  seedBalance: null, riskAmount: null, riskPercent: null, createdAt: new Date(), updatedAt: new Date(),
  entry: null, exit: null,
  analysis: { schemaVersion: 1, baseTimeframe: null, primaryTrend: null, bollingerBandCount: null,
    bollingerDirection: null, maArrangement: null, cross: null, stopLossLine: null,
    marketZoneEnabled: false, marketZoneHigh: null, marketZoneLow: null,
    chartPatternObserved: false, chartPatternTimeframe: null, chartPatternType: null,
    retailPositionEnabled: false, retailBuyAveragePrice: null, retailSellAveragePrice: null,
    retailBuyRatio: null, fibonacciEnabled: false, fibonacciStartPrice: null,
    fibonacciEndPrice: null, regret: null, economicIndicators: [], createdAt: new Date(), updatedAt: new Date() },
};

const prisma = () => ({
  trade: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
  mt5Account: { findFirst: jest.fn() },
});

describe('TradeLogService owner boundary', () => {
  it('always includes ownerId when loading a trade', async () => {
    const db = prisma(); db.trade.findFirst.mockResolvedValue(rawTrade);
    await expect(new TradeLogService(db as never).getTrade('owner-1', 'trade-1')).resolves.toMatchObject({ id: 'trade-1' });
    expect(db.trade.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'trade-1', ownerId: 'owner-1' } }));
  });

  it('hides a foreign trade as not found', async () => {
    const db = prisma(); db.trade.findFirst.mockResolvedValue(null);
    await expect(new TradeLogService(db as never).getTrade('owner-1', 'foreign')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('applies manual and all scopes without accepting an account id', async () => {
    const db = prisma(); const service = new TradeLogService(db as never);
    await service.getStats('owner-1', { scope: 'manual' });
    expect(db.trade.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ ownerId: 'owner-1', mt5AccountId: null }) }));
    await service.getStats('owner-1', { scope: 'all' });
    expect(db.trade.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ ownerId: 'owner-1' }) }));
  });

  it('rejects missing and foreign account scopes', async () => {
    const db = prisma(); const service = new TradeLogService(db as never);
    await expect(service.getStats('owner-1', { scope: 'account' })).rejects.toBeInstanceOf(BadRequestException);
    db.mt5Account.findFirst.mockResolvedValue(null);
    await expect(service.getStats('owner-1', { scope: 'account', accountId: 'foreign' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.mt5Account.findFirst).toHaveBeenCalledWith({ where: { id: 'foreign', ownerId: 'owner-1' }, select: { id: true } });
  });
});
