import { BadGatewayException } from '@nestjs/common';
import { Mt5BridgeClient } from './mt5-bridge.client';

describe('Mt5BridgeClient', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.MT5_BRIDGE_BASE_URL = 'http://bridge.internal:18812';
    process.env.MT5_BRIDGE_TOKEN = 'bridge-secret';
  });

  afterEach(() => { global.fetch = originalFetch; });

  it('uses bounded authenticated I/O and accepts an exact identity echo', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      server: 'broker-live', accountLogin: 123, cursor: 'cursor-2', deals: [], orders: [],
    }), { status: 200 })) as typeof fetch;
    const client = new Mt5BridgeClient();

    await expect(client.sync({ server: 'broker-live', accountLogin: 123, password: 'write-only', cursor: 'cursor-1' }))
      .resolves.toMatchObject({ server: 'broker-live', accountLogin: 123 });
    expect(global.fetch).toHaveBeenCalledWith(new URL('http://bridge.internal:18812/sync'), expect.objectContaining({
      method: 'POST', headers: expect.objectContaining({ authorization: 'Bearer bridge-secret' }), signal: expect.any(AbortSignal),
      body: JSON.stringify({ server: 'broker-live', accountLogin: 123, password: 'write-only', cursor: 'cursor-1' }),
    }));
  });

  it('rejects a mismatched bridge identity', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      server: 'attacker', accountLogin: 999, cursor: 'cursor-2', deals: [], orders: [],
    }), { status: 200 })) as typeof fetch;

    await expect(new Mt5BridgeClient().sync({ server: 'broker-live', accountLogin: 123, password: 'secret' }))
      .rejects.toBeInstanceOf(BadGatewayException);
  });

  it('accepts lossless decimal identifier strings and rejects numeric identifiers', async () => {
    const deal = {
      ticket: '9007199254740993', order: '9007199254740994', positionId: '9007199254740995',
      time: 1_700_000_000, timeMsc: 1_700_000_000_000, type: 0, entry: 0, magic: '9007199254740996',
      reason: 0, volume: 1, price: 1.2, commission: 0, swap: 0, profit: 0, fee: 0,
      symbol: 'EURUSD', comment: '', externalId: '',
    };
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      server: 'broker-live', accountLogin: 123, cursor: 'opaque:cursor', deals: [deal], orders: [],
    }), { status: 200 })) as typeof fetch;

    await expect(new Mt5BridgeClient().sync({ server: 'broker-live', accountLogin: 123, password: 'secret' }))
      .resolves.toMatchObject({ cursor: 'opaque:cursor', deals: [{ ticket: '9007199254740993' }] });

    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      server: 'broker-live', accountLogin: 123, cursor: 'opaque:cursor', deals: [{ ...deal, ticket: 9007199254740992 }], orders: [],
    }), { status: 200 })) as typeof fetch;
    await expect(new Mt5BridgeClient().sync({ server: 'broker-live', accountLogin: 123, password: 'secret' }))
      .rejects.toThrow('invalid payload');
  });

  it('accepts the PostgreSQL BIGINT maximum and rejects overflow identifiers', async () => {
    const deal = {
      ticket: '9223372036854775807', order: '1', positionId: '1', time: 1, timeMsc: 1000,
      type: 0, entry: 0, magic: '0', reason: 0, volume: 1, price: 1, commission: 0,
      swap: 0, profit: 0, fee: 0, symbol: 'X', comment: '', externalId: '',
    };
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      server: 'broker-live', accountLogin: 123, cursor: 'cursor', deals: [deal], orders: [],
    }), { status: 200 })) as typeof fetch;
    await expect(new Mt5BridgeClient().sync({ server: 'broker-live', accountLogin: 123, password: 'secret' })).resolves.toBeDefined();

    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      server: 'broker-live', accountLogin: 123, cursor: 'cursor',
      deals: [{ ...deal, ticket: '9223372036854775808' }], orders: [],
    }), { status: 200 })) as typeof fetch;
    await expect(new Mt5BridgeClient().sync({ server: 'broker-live', accountLogin: 123, password: 'secret' })).rejects.toThrow('invalid payload');
  });

  it('rejects oversized responses before parsing', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response('', {
      status: 200, headers: { 'content-length': String(1024 * 1024 + 1) },
    })) as typeof fetch;

    await expect(new Mt5BridgeClient().sync({ server: 'broker-live', accountLogin: 123, password: 'secret' }))
      .rejects.toThrow('too large');
  });
});
