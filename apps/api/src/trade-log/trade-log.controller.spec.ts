import { TradeLogController } from './trade-log.controller';
import { TradeLogService } from './trade-log.service';

describe('TradeLogController', () => {
  it('exposes assistant actions over HTTP controller contract', () => {
    const controller = new TradeLogController(new TradeLogService());

    const response = controller.applyAssistantActions({
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

    expect(response).toMatchObject({
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
