import { BadGatewayException } from '@nestjs/common';
import { Mt5BridgeClient } from './mt5-bridge.client';

const v3 = (patch: Record<string, unknown> = {}) => ({
  contractVersion: 3, server: 'broker-live', accountLogin: 123, cursor: 'cursor-2', ledgerSemanticsVersion: 1,
  deals: [], orders: [], positionEntryBalances: [], unsupportedPositionEntryBalances: [], positionEntryPlans: [], ...patch,
});
const opening = (patch: Record<string, unknown> = {}) => ({
  ticket: '9007199254740993', order: '9007199254740994', positionId: '9007199254740995', time: 1_700_000_000, timeMsc: 1_700_000_000_000,
  type: 0, entry: 0, magic: '9007199254740996', reason: 0, volume: 1, price: 1.2, commission: 0, swap: 0, profit: 0, fee: 0, symbol: 'EURUSD', comment: '', externalId: '', ...patch,
});
const proven = (deal = opening(), patch: Record<string, unknown> = {}) => ({ positionId: deal.positionId, entryDealTicket: deal.ticket, entryOrderTicket: deal.order, entryTimeMsc: deal.timeMsc, preEntryBalance: '100.12', ledgerSemanticsVersion: 1, ...patch });

describe('Mt5BridgeClient', () => {
  const originalFetch = global.fetch;
  beforeEach(() => { process.env.MT5_BRIDGE_BASE_URL = 'http://bridge.internal:18812'; process.env.MT5_BRIDGE_TOKEN = 'bridge-secret'; });
  afterEach(() => { global.fetch = originalFetch; });
  const response = (body: unknown) => { global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 })) as typeof fetch; };

  it('uses bounded authenticated I/O and accepts an exact v3 identity echo', async () => {
    response(v3());
    await expect(new Mt5BridgeClient().sync({ server: 'broker-live', accountLogin: 123, password: 'write-only', cursor: 'cursor-1' })).resolves.toMatchObject({ server: 'broker-live', accountLogin: 123 });
    expect(global.fetch).toHaveBeenCalledWith(new URL('http://bridge.internal:18812/sync'), expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ authorization: 'Bearer bridge-secret' }), signal: expect.any(AbortSignal), body: JSON.stringify({ server: 'broker-live', accountLogin: 123, password: 'write-only', cursor: 'cursor-1' }) }));
  });
  it('treats an omitted optional entry-plan feed as empty', async () => { const body = v3(); delete (body as any).positionEntryPlans; response(body); await expect(new Mt5BridgeClient().sync({ server: 'broker-live', accountLogin: 123, password: 'secret' })).resolves.toMatchObject({ positionEntryPlans: [] }); });
  it('rejects a malformed entry-plan feed', async () => { response(v3({ positionEntryPlans: null })); await expect(new Mt5BridgeClient().sync({ server: 'broker-live', accountLogin: 123, password: 'secret' })).rejects.toThrow('invalid payload'); });
  it('rejects a mismatched bridge identity', async () => { response(v3({ server: 'attacker', accountLogin: 999 })); await expect(new Mt5BridgeClient().sync({ server: 'broker-live', accountLogin: 123, password: 'secret' })).rejects.toBeInstanceOf(BadGatewayException); });
  it('accepts lossless IDs and signed canonical proven decimals, rejecting numeric identifiers', async () => {
    const deal = opening(); response(v3({ deals: [deal], positionEntryBalances: [proven(deal, { preEntryBalance: '-0.01' })] }));
    await expect(new Mt5BridgeClient().sync({ server: 'broker-live', accountLogin: 123, password: 'secret' })).resolves.toMatchObject({ deals: [{ ticket: deal.ticket }] });
    response(v3({ deals: [{ ...deal, ticket: 9007199254740992 }], positionEntryBalances: [] }));
    await expect(new Mt5BridgeClient().sync({ server: 'broker-live', accountLogin: 123, password: 'secret' })).rejects.toThrow('invalid payload');
  });
  it('accepts PostgreSQL BIGINT maximum and rejects overflow identifiers', async () => {
    const deal = opening({ ticket: '9223372036854775807', order: '1', positionId: '1' }); response(v3({ deals: [deal], positionEntryBalances: [proven(deal)] }));
    await expect(new Mt5BridgeClient().sync({ server: 'broker-live', accountLogin: 123, password: 'secret' })).resolves.toBeDefined();
    response(v3({ deals: [{ ...deal, ticket: '9223372036854775808' }] })); await expect(new Mt5BridgeClient().sync({ server: 'broker-live', accountLogin: 123, password: 'secret' })).rejects.toThrow('invalid payload');
  });
  it('rejects duplicate or malformed v3 assertions', async () => {
    const deal = opening({ positionId: '1', ticket: '2', order: '3' }); response(v3({ deals: [deal], positionEntryBalances: [proven(deal), proven(deal)] }));
    await expect(new Mt5BridgeClient().sync({ server: 'broker-live', accountLogin: 123, password: 'secret' })).rejects.toThrow('invalid payload');
  });
  it('accepts unanchored unsupported assertions without fabricated fields', async () => {
    response(v3({ unsupportedPositionEntryBalances: [{ kind: 'UNANCHORED', positionId: '1', reason: 'OPENING_DEAL_OUTSIDE_HISTORY', ledgerSemanticsVersion: 1 }] }));
    await expect(new Mt5BridgeClient().sync({ server: 'broker-live', accountLogin: 123, password: 'secret' })).resolves.toBeDefined();
  });
  it('rejects oversized responses before parsing', async () => { global.fetch = jest.fn().mockResolvedValue(new Response('', { status: 200, headers: { 'content-length': String(1024 * 1024 + 1) } })) as typeof fetch; await expect(new Mt5BridgeClient().sync({ server: 'broker-live', accountLogin: 123, password: 'secret' })).rejects.toThrow('too large'); });
});
