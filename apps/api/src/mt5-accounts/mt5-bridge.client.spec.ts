import { BadGatewayException } from '@nestjs/common';
import { Mt5AccountAuthorizationRejected, Mt5BridgeClient, Mt5BridgeTickError, Mt5BridgeUnauthorized } from './mt5-bridge.client';

const request = { contractVersion: 5 as const, server: 'broker-live', accountLogin: 123, password: 'secret', mode: 'bootstrap' as const, snapshotToMsc: 1_700_000_001_000 };
const v5 = (patch: Record<string, unknown> = {}) => ({
  contractVersion: 5, server: request.server, accountLogin: request.accountLogin, mode: request.mode, snapshotToMsc: request.snapshotToMsc,
  page: { hasMore: false, bytes: 0 },
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
  const response = (body: unknown, status = 200) => {
    const value = structuredClone(body);
    if (value && typeof value === 'object' && 'page' in value && value.page && typeof value.page === 'object' && 'bytes' in value.page) {
      let bytes: number;
      do {
        bytes = Buffer.byteLength(JSON.stringify(value));
        if (value.page.bytes === bytes) break;
        value.page.bytes = bytes;
      } while (true);
    }
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify(value), { status })) as typeof fetch;
  };

  it('uses authenticated bounded I/O and accepts the exact v5 identity, mode, and snapshot echo', async () => {
    response(v5());
    await expect(new Mt5BridgeClient().sync(request)).resolves.toMatchObject({ account: { currentBalance: '100.12' } });
    expect(global.fetch).toHaveBeenCalledWith(new URL('http://bridge.internal:18812/sync'), expect.objectContaining({
      method: 'POST', headers: expect.objectContaining({ authorization: 'Bearer bridge-secret' }), signal: expect.any(AbortSignal), body: JSON.stringify(request),
    }));
  });

  it('rejects identity, history range, account snapshot, and old contract mismatches', async () => {
    for (const body of [
      v5({ server: 'attacker' }),
      v5({ snapshotToMsc: 1 }),
      v5({ page: { hasMore: true, bytes: 100 } }),
      v5({ account: { currency: 'USD', currencyDigits: 2, currentBalance: '1e2' } }),
      v5({ account: { currency: 'USD', currencyDigits: 2.5, currentBalance: '100.12' } }),
      v5({ contractVersion: 4 }),
    ]) {
      response(body);
      await expect(new Mt5BridgeClient().sync(request)).rejects.toBeInstanceOf(BadGatewayException);
    }
  });

  it('rejects bridge request failures instead of applying v4 cursor recovery', async () => {
    response({ error: 'invalid or expired cursor' }, 400);
    await expect(new Mt5BridgeClient().sync({ ...request, pageCursor: 'opaque' })).rejects.toBeInstanceOf(BadGatewayException);
  });
  it('classifies bridge bearer-token rejection without exposing the token', async () => {
    response({ error: 'unauthorized' }, 401);
    await expect(new Mt5BridgeClient().sync(request)).rejects.toBeInstanceOf(Mt5BridgeUnauthorized);
  });
  it('classifies rejected MT5 account credentials without treating the bridge as down', async () => {
    response({ error: 'sync_account_authorization_failed' }, 422);
    await expect(new Mt5BridgeClient().sync(request)).rejects.toBeInstanceOf(Mt5AccountAuthorizationRejected);
  });

  it('accepts lossless IDs and rejects numeric or PostgreSQL-overflow identifiers', async () => {
    const deal = opening({ ticket: '9223372036854775807', order: '1', positionId: '1' });
    response(v5({ deals: [deal] }));
    await expect(new Mt5BridgeClient().sync(request)).resolves.toMatchObject({ deals: [{ ticket: deal.ticket }] });
    for (const ticket of [9007199254740992, '9223372036854775808']) {
      response(v5({ deals: [{ ...deal, ticket }] }));
      await expect(new Mt5BridgeClient().sync(request)).rejects.toThrow('invalid payload');
    }
  });

  it('rejects oversized responses before parsing', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response('', { status: 200, headers: { 'content-length': String(1024 * 1024 + 1) } })) as typeof fetch;
    await expect(new Mt5BridgeClient().sync(request)).rejects.toThrow('too large');
  });

  it('rejects incompatible capabilities and authenticates capability requests', async () => {
    const capabilities = {
      contractVersion: 5, sync: { bootstrap: true, incremental: true, fixedSnapshot: true },
      ticks: {
        available: true, cursorNamespace: 'ticks-v1', maxRequestBytes: 8192, maxCursorChars: 2048,
        pageSize: { min: 1, max: 1000 }, maxResponseBytes: 900000, maxChunkSpanMsc: 300000,
        maxChunkTicks: 20000, maxSnapshotBytes: 750000, snapshotTtlSeconds: 60, cacheMaxEntries: 8,
        cacheMaxBytes: 6000000, valuationVersion: 1, supportedCalculationModes: ['FOREX'],
      },
    };
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify(capabilities), { status: 200 })) as typeof fetch;
    await expect(new Mt5BridgeClient().getCapabilities()).resolves.toMatchObject({ ticks: { cursorNamespace: 'ticks-v1' } });
    expect(global.fetch).toHaveBeenCalledWith(new URL('http://bridge.internal:18812/capabilities'), expect.objectContaining({
      method: 'GET', headers: { authorization: 'Bearer bridge-secret' },
    }));
    capabilities.ticks.cursorNamespace = 'sync-v5' as never;
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify(capabilities), { status: 200 })) as typeof fetch;
    await expect(new Mt5BridgeClient().getCapabilities()).rejects.toMatchObject({ category: 'BRIDGE_INCOMPATIBLE' });
  });

  it('rejects cross-namespace cursors before network I/O and categorizes expired tick cursors', async () => {
    const ticks = { contractVersion: 5 as const, server: request.server, accountLogin: request.accountLogin, password: request.password, symbol: 'EURUSD', rawRange: { fromMsc: 0, toMsc: 1 }, snapshotToMsc: 1, pageCursor: 'sync-v5-cursor' };
    global.fetch = jest.fn() as typeof fetch;
    await expect(new Mt5BridgeClient().ticks({ ...ticks, pageCursor: 'x'.repeat(2049) })).rejects.toBeInstanceOf(Mt5BridgeTickError);
    expect(global.fetch).not.toHaveBeenCalled();
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'invalid_or_expired_tick_cursor' }), { status: 400 })) as typeof fetch;
    await expect(new Mt5BridgeClient().ticks(ticks)).rejects.toMatchObject({ category: 'TICK_CURSOR_EXPIRED' });
  });
});
