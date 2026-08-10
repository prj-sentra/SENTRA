import { BadGatewayException } from '@nestjs/common';
import { Mt5BridgeClient, Mt5BridgeCursorRejected, Mt5BridgeUnauthorized } from './mt5-bridge.client';

const request = { server: 'broker-live', accountLogin: 123, password: 'secret', historyFromMsc: 0, historyToMsc: 1_700_000_001_000 };
const v4 = (patch: Record<string, unknown> = {}) => ({
  contractVersion: 4, server: request.server, accountLogin: request.accountLogin, cursor: 'cursor-2',
  historyRange: { fromMsc: request.historyFromMsc, toMsc: request.historyToMsc },
  account: { currency: 'USD', currencyDigits: 2, currentBalance: '100.12' }, deals: [], orders: [], ...patch,
});
const opening = (patch: Record<string, unknown> = {}) => ({
  ticket: '9007199254740993', order: '9007199254740994', positionId: '9007199254740995', time: 1_700_000_000, timeMsc: 1_700_000_000_000,
  type: 0, entry: 0, magic: '9007199254740996', reason: 0, volume: 1, price: 1.2, commission: 0, swap: 0, profit: 0, fee: 0, symbol: 'EURUSD', comment: '', externalId: '', ...patch,
});

describe('Mt5BridgeClient', () => {
  const originalFetch = global.fetch;
  beforeEach(() => { process.env.MT5_BRIDGE_BASE_URL = 'http://bridge.internal:18812'; process.env.MT5_BRIDGE_TOKEN = 'bridge-secret'; });
  afterEach(() => { global.fetch = originalFetch; });
  const response = (body: unknown, status = 200) => { global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })) as typeof fetch; };

  it('uses authenticated bounded I/O and accepts the exact v4 account and history echo', async () => {
    response(v4());
    await expect(new Mt5BridgeClient().sync(request)).resolves.toMatchObject({ account: { currentBalance: '100.12' } });
    expect(global.fetch).toHaveBeenCalledWith(new URL('http://bridge.internal:18812/sync'), expect.objectContaining({
      method: 'POST', headers: expect.objectContaining({ authorization: 'Bearer bridge-secret' }), signal: expect.any(AbortSignal), body: JSON.stringify(request),
    }));
  });

  it('rejects identity, history range, account snapshot, and old contract mismatches', async () => {
    for (const body of [
      v4({ server: 'attacker' }),
      v4({ historyRange: { fromMsc: 1, toMsc: request.historyToMsc } }),
      v4({ account: { currency: 'USD', currencyDigits: 2, currentBalance: '1e2' } }),
      v4({ account: { currency: 'USD', currencyDigits: 2.5, currentBalance: '100.12' } }),
      v4({ contractVersion: 3 }),
    ]) {
      response(body);
      await expect(new Mt5BridgeClient().sync(request)).rejects.toBeInstanceOf(BadGatewayException);
    }
  });

  it('classifies only the explicit bridge cursor rejection for a safe cursorless retry', async () => {
    response({ error: 'invalid or expired cursor' }, 400);
    await expect(new Mt5BridgeClient().sync({ ...request, cursor: 'stale' })).rejects.toBeInstanceOf(Mt5BridgeCursorRejected);
    response({ error: 'other bad request' }, 400);
    await expect(new Mt5BridgeClient().sync({ ...request, cursor: 'stale' })).rejects.toBeInstanceOf(BadGatewayException);
  });
  it('classifies bridge bearer-token rejection without exposing the token', async () => {
    response({ error: 'unauthorized' }, 401);
    await expect(new Mt5BridgeClient().sync(request)).rejects.toBeInstanceOf(Mt5BridgeUnauthorized);
  });

  it('accepts lossless IDs and rejects numeric or PostgreSQL-overflow identifiers', async () => {
    const deal = opening({ ticket: '9223372036854775807', order: '1', positionId: '1' });
    response(v4({ deals: [deal] }));
    await expect(new Mt5BridgeClient().sync(request)).resolves.toMatchObject({ deals: [{ ticket: deal.ticket }] });
    for (const ticket of [9007199254740992, '9223372036854775808']) {
      response(v4({ deals: [{ ...deal, ticket }] }));
      await expect(new Mt5BridgeClient().sync(request)).rejects.toThrow('invalid payload');
    }
  });

  it('rejects oversized responses before parsing', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response('', { status: 200, headers: { 'content-length': String(1024 * 1024 + 1) } })) as typeof fetch;
    await expect(new Mt5BridgeClient().sync(request)).rejects.toThrow('too large');
  });
});
