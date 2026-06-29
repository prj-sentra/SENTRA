import { TradeLogService } from './trade-log.service';

describe('TradeLogService', () => {
  it('reports trade-log health', () => {
    const service = new TradeLogService();

    expect(service.health()).toMatchObject({
      status: 'ok',
      service: 'sentra-trade-log',
    });
    expect(typeof service.health().timestamp).toBe('string');
  });

  it('starts with no trades', () => {
    const service = new TradeLogService();

    expect(service.listTrades()).toEqual([]);
  });

  it('creates planned independent trades for the same symbol and side', () => {
    const service = new TradeLogService();

    const first = service.createTrade({
      symbol: 'BTCUSDT',
      side: 'long',
      timeframe: '15m',
      thesis: 'London sweep reclaim',
    });
    const second = service.createTrade({
      symbol: 'BTCUSDT',
      side: 'long',
      timeframe: '5m',
      thesis: 'Separate CFD position',
    });

    expect(first).toMatchObject({
      symbol: 'BTCUSDT',
      side: 'long',
      status: 'planned',
      timeframe: '15m',
      thesis: 'London sweep reclaim',
    });
    expect(second).toMatchObject({
      symbol: 'BTCUSDT',
      side: 'long',
      status: 'planned',
      timeframe: '5m',
      thesis: 'Separate CFD position',
    });
    expect(first.id).not.toBe(second.id);
    expect(service.listTrades()).toHaveLength(2);
  });

  it('records entry separately from trade creation and opens the trade', () => {
    const service = new TradeLogService();
    const trade = service.createTrade({ symbol: 'ETHUSDT', side: 'short' });

    const updated = service.recordEntry(trade.id, {
      price: 3500,
      quantity: 2,
      occurredAt: '2026-06-26T10:00:00.000Z',
      note: 'Initial short entry',
    });

    expect(updated).toMatchObject({
      id: trade.id,
      status: 'open',
      entry: {
        price: 3500,
        quantity: 2,
        occurredAt: '2026-06-26T10:00:00.000Z',
        note: 'Initial short entry',
      },
    });
  });

  it('records exit separately from entry and closes the trade', () => {
    const service = new TradeLogService();
    const trade = service.createTrade({ symbol: 'ETHUSDT', side: 'short' });
    service.recordEntry(trade.id, {
      price: 3500,
      quantity: 2,
      occurredAt: '2026-06-26T10:00:00.000Z',
    });

    const updated = service.recordExit(trade.id, {
      price: 3400,
      quantity: 2,
      occurredAt: '2026-06-26T11:00:00.000Z',
      reason: 'target_hit',
      note: 'Target reached',
    });

    expect(updated).toMatchObject({
      id: trade.id,
      status: 'closed',
      exit: {
        price: 3400,
        quantity: 2,
        occurredAt: '2026-06-26T11:00:00.000Z',
        reason: 'target_hit',
        note: 'Target reached',
      },
    });
  });

  it('rejects exit before entry and keeps trade planned', () => {
    const service = new TradeLogService();
    const trade = service.createTrade({ symbol: 'BTCUSDT', side: 'long' });

    expect(() =>
      service.recordExit(trade.id, {
        price: 67400,
        quantity: 0.05,
        occurredAt: '2026-06-29T00:00:00.000Z',
        reason: 'manual',
      }),
    ).toThrow('Cannot exit before entry');

    expect(service.getTrade(trade.id).status).toBe('planned');
  });

  it('rejects a second entry on the same trade', () => {
    const service = new TradeLogService();
    const trade = service.createTrade({ symbol: 'BTCUSDT', side: 'long' });
    service.recordEntry(trade.id, {
      price: 67320,
      quantity: 0.05,
      occurredAt: '2026-06-29T00:00:00.000Z',
    });

    expect(() =>
      service.recordEntry(trade.id, {
        price: 67400,
        quantity: 0.05,
        occurredAt: '2026-06-29T00:10:00.000Z',
      }),
    ).toThrow('Trade already has an entry');
  });

  it('rejects a second exit on a closed trade', () => {
    const service = new TradeLogService();
    const trade = service.createTrade({ symbol: 'BTCUSDT', side: 'long' });
    service.recordEntry(trade.id, {
      price: 67320,
      quantity: 0.05,
      occurredAt: '2026-06-29T00:00:00.000Z',
    });
    service.recordExit(trade.id, {
      price: 67400,
      quantity: 0.05,
      occurredAt: '2026-06-29T00:10:00.000Z',
      reason: 'manual',
    });

    expect(() =>
      service.recordExit(trade.id, {
        price: 67500,
        quantity: 0.05,
        occurredAt: '2026-06-29T00:20:00.000Z',
        reason: 'manual',
      }),
    ).toThrow('Trade already has an exit');
  });
});
