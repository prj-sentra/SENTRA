import { TradeLogService } from './trade-log.service';

function decimal(value: number) {
  return { toNumber: () => value };
}

function createTestService(): TradeLogService {
  const trades = new Map<string, any>();
  let sequence = 0;

  const prisma = {
    trade: {
      create: jest.fn(({ data }) => {
        sequence += 1;
        const now = new Date('2026-06-29T00:00:00.000Z');
        const trade = {
          id: `trade-${sequence}`,
          symbol: data.symbol,
          side: data.side,
          status: data.status,
          timeframe: data.timeframe ?? null,
          session: data.session ?? null,
          strategy: data.strategy ?? null,
          thesis: data.thesis ?? null,
          note: data.note ?? null,
          createdAt: now,
          updatedAt: now,
          entry: null,
          exit: null,
        };
        trades.set(trade.id, trade);
        return Promise.resolve(trade);
      }),
      findMany: jest.fn(() => Promise.resolve(Array.from(trades.values()))),
      findUnique: jest.fn(({ where }) => Promise.resolve(trades.get(where.id) ?? null)),
      update: jest.fn(({ where, data }) => {
        const trade = trades.get(where.id);
        if (!trade) {
          return Promise.resolve(null);
        }
        const updated = {
          ...trade,
          status: data.status ?? trade.status,
          updatedAt: new Date('2026-06-29T00:01:00.000Z'),
        };
        if (data.entry?.create) {
          updated.entry = {
            ...data.entry.create,
            price: decimal(data.entry.create.price),
            quantity: data.entry.create.quantity === undefined ? null : decimal(data.entry.create.quantity),
            occurredAt: data.entry.create.occurredAt,
            note: data.entry.create.note ?? null,
          };
        }
        if (data.exit?.create) {
          updated.exit = {
            ...data.exit.create,
            price: decimal(data.exit.create.price),
            quantity: data.exit.create.quantity === undefined ? null : decimal(data.exit.create.quantity),
            occurredAt: data.exit.create.occurredAt,
            reason: data.exit.create.reason ?? null,
            note: data.exit.create.note ?? null,
          };
        }
        trades.set(where.id, updated);
        return Promise.resolve(updated);
      }),
    },
  };

  return new TradeLogService(prisma as never);
}

describe('TradeLogService', () => {
  it('reports trade-log health', () => {
    const service = createTestService();

    expect(service.health()).toMatchObject({
      status: 'ok',
      service: 'sentra-trade-log',
    });
    expect(typeof service.health().timestamp).toBe('string');
  });

  it('starts with no trades', async () => {
    const service = createTestService();

    await expect(service.listTrades()).resolves.toEqual([]);
  });

  it('creates planned independent trades for the same symbol and side', async () => {
    const service = createTestService();

    const first = await service.createTrade({
      symbol: 'BTCUSDT',
      side: 'long',
      timeframe: '15m',
      thesis: 'London sweep reclaim',
    });
    const second = await service.createTrade({
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
    await expect(service.listTrades()).resolves.toHaveLength(2);
  });

  it('records entry separately from trade creation and opens the trade', async () => {
    const service = createTestService();
    const trade = await service.createTrade({ symbol: 'ETHUSDT', side: 'short' });

    const updated = await service.recordEntry(trade.id, {
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

  it('records exit separately from entry and closes the trade', async () => {
    const service = createTestService();
    const trade = await service.createTrade({ symbol: 'ETHUSDT', side: 'short' });
    await service.recordEntry(trade.id, {
      price: 3500,
      quantity: 2,
      occurredAt: '2026-06-26T10:00:00.000Z',
    });

    const updated = await service.recordExit(trade.id, {
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

  it('rejects exit before entry and keeps trade planned', async () => {
    const service = createTestService();
    const trade = await service.createTrade({ symbol: 'BTCUSDT', side: 'long' });

    await expect(
      service.recordExit(trade.id, {
        price: 67400,
        quantity: 0.05,
        occurredAt: '2026-06-29T00:00:00.000Z',
        reason: 'manual',
      }),
    ).rejects.toThrow('Cannot exit before entry');

    await expect(service.getTrade(trade.id)).resolves.toMatchObject({ status: 'planned' });
  });

  it('rejects a second entry on the same trade', async () => {
    const service = createTestService();
    const trade = await service.createTrade({ symbol: 'BTCUSDT', side: 'long' });
    await service.recordEntry(trade.id, {
      price: 67320,
      quantity: 0.05,
      occurredAt: '2026-06-29T00:00:00.000Z',
    });

    await expect(
      service.recordEntry(trade.id, {
        price: 67400,
        quantity: 0.05,
        occurredAt: '2026-06-29T00:10:00.000Z',
      }),
    ).rejects.toThrow('Trade already has an entry');
  });

  it('rejects a second exit on a closed trade', async () => {
    const service = createTestService();
    const trade = await service.createTrade({ symbol: 'BTCUSDT', side: 'long' });
    await service.recordEntry(trade.id, {
      price: 67320,
      quantity: 0.05,
      occurredAt: '2026-06-29T00:00:00.000Z',
    });
    await service.recordExit(trade.id, {
      price: 67400,
      quantity: 0.05,
      occurredAt: '2026-06-29T00:10:00.000Z',
      reason: 'manual',
    });

    await expect(
      service.recordExit(trade.id, {
        price: 67500,
        quantity: 0.05,
        occurredAt: '2026-06-29T00:20:00.000Z',
        reason: 'manual',
      }),
    ).rejects.toThrow('Trade already has an exit');
  });

  it('applies assistant actions to create and open a new trade', async () => {
    const service = createTestService();

    const response = await service.applyAssistantActions({
      rawText: 'BTC 15분봉 롱 진입했어. 67320에 0.05개.',
      source: 'telegram',
      actions: [
        {
          type: 'create_trade',
          payload: { symbol: 'BTCUSDT', side: 'long', timeframe: '15m' },
        },
        {
          type: 'record_entry',
          tradeRef: 'last_created',
          payload: {
            price: 67320,
            quantity: 0.05,
            occurredAt: '2026-06-29T00:00:00.000Z',
          },
        },
      ],
    });

    expect(response.rawText).toBe('BTC 15분봉 롱 진입했어. 67320에 0.05개.');
    expect(response.source).toBe('telegram');
    expect(response.trades).toHaveLength(1);
    expect(response.trades[0]).toMatchObject({
      symbol: 'BTCUSDT',
      side: 'long',
      status: 'open',
      timeframe: '15m',
      entry: {
        price: 67320,
        quantity: 0.05,
        occurredAt: '2026-06-29T00:00:00.000Z',
      },
    });
  });

  it('creates separate trades for same symbol same side assistant actions', async () => {
    const service = createTestService();

    const first = await service.applyAssistantActions({
      rawText: 'BTC long first position',
      source: 'manual',
      actions: [
        { type: 'create_trade', payload: { symbol: 'BTCUSDT', side: 'long' } },
        {
          type: 'record_entry',
          tradeRef: 'last_created',
          payload: { price: 67320, quantity: 0.05, occurredAt: '2026-06-29T00:00:00.000Z' },
        },
      ],
    });
    const second = await service.applyAssistantActions({
      rawText: 'BTC long second independent position',
      source: 'manual',
      actions: [
        { type: 'create_trade', payload: { symbol: 'BTCUSDT', side: 'long' } },
        {
          type: 'record_entry',
          tradeRef: 'last_created',
          payload: { price: 67400, quantity: 0.03, occurredAt: '2026-06-29T00:10:00.000Z' },
        },
      ],
    });

    expect(first.trades[0].id).not.toBe(second.trades[0].id);
    await expect(service.listTrades()).resolves.toHaveLength(2);
    await expect(service.listTrades()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entry: expect.objectContaining({ price: 67320 }) }),
        expect.objectContaining({ entry: expect.objectContaining({ price: 67400 }) }),
      ]),
    );
  });

  it('preserves rawText in the created trade note when note is otherwise absent', async () => {
    const service = createTestService();

    const response = await service.applyAssistantActions({
      rawText: 'ETH 숏 아이디어. 구조 깨짐.',
      source: 'telegram',
      actions: [{ type: 'create_trade', payload: { symbol: 'ETHUSDT', side: 'short' } }],
    });

    expect(response.trades[0]).toMatchObject({
      symbol: 'ETHUSDT',
      side: 'short',
      status: 'planned',
      note: 'ETH 숏 아이디어. 구조 깨짐.',
    });
  });

  it('rejects trade creation without a non-empty symbol', async () => {
    const service = createTestService();

    await expect(service.createTrade({ symbol: ' ', side: 'long' })).rejects.toThrow('symbol is required');
  });

  it('rejects trade creation with an invalid side', async () => {
    const service = createTestService();

    await expect(service.createTrade({ symbol: 'BTCUSDT', side: 'buy' as never })).rejects.toThrow(
      'side must be long or short',
    );
  });

  it('rejects non-positive entry price', async () => {
    const service = createTestService();
    const trade = await service.createTrade({ symbol: 'BTCUSDT', side: 'long' });

    await expect(
      service.recordEntry(trade.id, {
        price: 0,
        quantity: 0.05,
        occurredAt: '2026-06-29T00:00:00.000Z',
      }),
    ).rejects.toThrow('entry price must be positive');
  });

  it('rejects non-positive exit quantity', async () => {
    const service = createTestService();
    const trade = await service.createTrade({ symbol: 'BTCUSDT', side: 'long' });
    await service.recordEntry(trade.id, {
      price: 67320,
      quantity: 0.05,
      occurredAt: '2026-06-29T00:00:00.000Z',
    });

    await expect(
      service.recordExit(trade.id, {
        price: 67400,
        quantity: 0,
        occurredAt: '2026-06-29T00:10:00.000Z',
      }),
    ).rejects.toThrow('exit quantity must be positive');
  });

  it('rejects invalid entry occurrence timestamps', async () => {
    const service = createTestService();
    const trade = await service.createTrade({ symbol: 'BTCUSDT', side: 'long' });

    await expect(
      service.recordEntry(trade.id, {
        price: 67320,
        occurredAt: 'not-a-date',
      }),
    ).rejects.toThrow('entry occurredAt must be a valid date');
  });
});
