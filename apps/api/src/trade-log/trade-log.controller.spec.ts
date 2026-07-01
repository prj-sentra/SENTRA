import type { TradeLogAssistantActionsRequest, TradeLogAssistantActionsResponse } from '@trading-journal/shared';
import { TradeLogController } from './trade-log.controller';

describe('TradeLogController', () => {
  it('exposes assistant actions over HTTP controller contract', async () => {
    const response: TradeLogAssistantActionsResponse = {
      rawText: 'BTC 15분봉 롱 진입했어. 67320에 0.05개.',
      source: 'telegram',
      trades: [
        {
          id: 'trade-1',
          symbol: 'BTCUSDT',
          side: 'long',
          status: 'open',
          timeframe: '15m',
          entry: {
            price: 67320,
            quantity: 0.05,
            occurredAt: '2026-06-29T00:00:00.000Z',
          },
          createdAt: '2026-06-29T00:00:00.000Z',
          updatedAt: '2026-06-29T00:00:00.000Z',
        },
      ],
    };
    const service = {
      applyAssistantActions: jest.fn<Promise<TradeLogAssistantActionsResponse>, [TradeLogAssistantActionsRequest]>(() =>
        Promise.resolve(response),
      ),
    };
    const controller = new TradeLogController(service as never);

    await expect(
      controller.applyAssistantActions({
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
      }),
    ).resolves.toMatchObject({
      rawText: 'BTC 15분봉 롱 진입했어. 67320에 0.05개.',
      source: 'telegram',
      trades: [
        {
          symbol: 'BTCUSDT',
          side: 'long',
          status: 'open',
          timeframe: '15m',
          entry: {
            price: 67320,
            quantity: 0.05,
            occurredAt: '2026-06-29T00:00:00.000Z',
          },
        },
      ],
    });
  });
});
