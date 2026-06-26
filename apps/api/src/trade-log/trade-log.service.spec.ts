import { TradeLogService } from './trade-log.service';

describe('TradeLogService skeleton', () => {
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
});
