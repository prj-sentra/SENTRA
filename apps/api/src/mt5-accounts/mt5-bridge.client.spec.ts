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

  it('rejects oversized responses before parsing', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response('', {
      status: 200, headers: { 'content-length': String(1024 * 1024 + 1) },
    })) as typeof fetch;

    await expect(new Mt5BridgeClient().sync({ server: 'broker-live', accountLogin: 123, password: 'secret' }))
      .rejects.toThrow('too large');
  });
});
