import { advanceMfeMaeCalculator, calculateMfeMae, createMfeMaeCalculator, finalizeMfeMaeCalculator, type ExcursionInput } from './mfe-mae.service';

const page = (symbol: string, ticks: Array<[number, string, string]>) => ({
  symbol,
  response: {
    rawRange: { fromMsc: 0, toMsc: 6_100_000 }, snapshotToMsc: 9, snapshot: { id: symbol, sha256: 'a'.repeat(64), tickCount: ticks.length, expiresAtMsc: 10 },
    valuation: { version: 1 as const, calculationMode: 'FOREX', accountCurrency: 'USD', profitCurrency: 'USD', tickSize: '0.0001', tickValueProfit: '10', tickValueLoss: '10', sha256: 'b'.repeat(64) },
    ticks: ticks.map(([timeMsc, bid, ask], sequence) => ({ sequence, timeMsc, bid, ask })),
  },
});
const input = (deals: ExcursionInput['deals'], tickPages: ExcursionInput['tickPages']): ExcursionInput => ({ deals, tickPages, rawFromMsc: 0, rawToMsc: 6_100_000, tickSnapshotToMsc: 9, calculationVersion: 1, realizedPnl: '10', riskAmount: '10' });
const deal = (ticket: string, timeMsc: number, entry: number, type: number, price = '1.1000', symbol = 'EURUSD') => ({ ticket, positionId: '1', symbol, timeMsc, entry, type, volume: '1', price });

describe('calculateMfeMae', () => {
  it('uses bid for long marks and includes entry/final-exit ticks while excluding the flat gap', () => {
    const result = calculateMfeMae(input([
      deal('1', 1, 0, 0), deal('2', 3, 1, 1), deal('3', 5, 0, 0), deal('4', 6_000_001, 1, 1),
    ], [page('EURUSD', [[1, '1.1000', '1.1002'], [2, '1.1010', '1.1012'], [3, '1.1020', '1.1022'], [4, '9.0000', '9.0002'], [5, '1.1000', '1.1002'], [6_000_001, '1.1030', '1.1032']])]));
    expect(result).toMatchObject({ ok: true, price: { mfe: { value: '0.00300000', occurredAtMsc: 6000001 } } });
  });

  it('uses ask for short marks and applies IN, tick, OUT ordering within one millisecond', () => {
    const result = calculateMfeMae(input([deal('1', 1, 0, 1, '1.1000'), deal('2', 1, 1, 0, '1.1000')], [page('EURUSD', [[1, '1.0998', '1.0990']])]));
    expect(result).toMatchObject({ ok: true, price: { mfe: { value: '0.00100000', occurredAtMsc: 1 } } });
  });

  it('expresses capture rate as realized PnL divided by MFE PnL times 100', () => {
    const result = calculateMfeMae({
      ...input([deal('1', 1, 0, 0), deal('2', 2, 1, 1)], [page('EURUSD', [[1, '1.1000', '1.1002'], [2, '1.1002', '1.1004']])]),
      realizedPnl: '10',
    });
    expect(result).toMatchObject({ ok: true, unrealizedPnl: { mfe: { value: '20.00000000' } }, captureRate: '50.00000000' });
  });

  it('withholds capture rate unless MFE PnL is strictly positive', () => {
    const result = calculateMfeMae({
      ...input([deal('1', 1, 0, 0), deal('2', 2, 1, 1)], [page('EURUSD', [[1, '1.1000', '1.1002'], [2, '1.0998', '1.1000']])]),
      realizedPnl: '10',
    });
    expect(result).toMatchObject({ ok: true, unrealizedPnl: { mfe: { value: '0.00000000' } } });
    expect(result).not.toHaveProperty('captureRate');
  });

  it('rejects reversal and unsupported valuation, and withholds campaign price for heterogeneous holdings', () => {
    expect(calculateMfeMae(input([deal('1', 1, 0, 0), deal('2', 2, 0, 1), deal('3', 3, 1, 1), deal('4', 4, 1, 0)], [page('EURUSD', [[1, '1', '1.1'], [2, '1', '1.1'], [3, '1', '1.1'], [4, '1', '1.1']])]))).toEqual({ ok: false, code: 'UNSUPPORTED_REVERSAL' });
    const heterogeneous = calculateMfeMae(input([deal('1', 1, 0, 0), deal('2', 2, 1, 1), { ...deal('3', 1, 0, 0, '2', 'GBPUSD'), ticket: '3' }, { ...deal('4', 2, 1, 1, '2', 'GBPUSD'), ticket: '4' }], [page('EURUSD', [[1, '1', '1.1'], [2, '1.1', '1.2']]), page('GBPUSD', [[1, '2', '2.1'], [2, '2.1', '2.2']])]));
    expect(heterogeneous).toMatchObject({ ok: true, unrealizedPnl: expect.anything() });
    expect(heterogeneous).not.toHaveProperty('price');
  });

  it('resumes an interrupted, multipage heterogeneous campaign exactly as the one-shot calculator', () => {
    const deals = [
      deal('1', 1, 0, 0, '1.1', 'EURUSD'), deal('2', 6_100_000, 1, 1, '1.1', 'EURUSD'),
      deal('3', 1, 0, 0, '2.0', 'GBPUSD'), deal('4', 6_100_000, 1, 1, '2.0', 'GBPUSD'),
    ];
    const pages = [page('EURUSD', [[1, '1.1', '1.2'], [300_000, '1.15', '1.25'], [6_100_000, '1.2', '1.3']]), page('GBPUSD', [[1, '2.0', '2.1'], [300_000, '2.1', '2.2'], [6_100_000, '2.2', '2.3']])];
    const whole = input(deals, pages);
    const expected = calculateMfeMae(whole);
    const created = createMfeMaeCalculator(whole);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    let state = created.state;
    for (const [fromMsc, toMsc] of [[0, 300_000], [300_001, 600_001], [600_002, 6_100_000]]) {
      const chunkPages = pages.map((entry) => ({
        ...entry,
        response: {
          ...entry.response,
          rawRange: { fromMsc, toMsc },
          ticks: entry.response.ticks.filter((tick) => tick.timeMsc >= fromMsc && tick.timeMsc <= toMsc).map((tick, sequence) => ({ ...tick, sequence })),
        },
      }));
      const advanced = advanceMfeMaeCalculator(state, { ...whole, tickPages: chunkPages, rawFromMsc: fromMsc, rawToMsc: toMsc });
      expect(advanced.ok).toBe(true);
      if (!advanced.ok) return;
      const serialized = JSON.stringify(advanced.state);
      expect(serialized).not.toContain('\\u0000');
      state = JSON.parse(serialized); // literal PostgreSQL JSON persisted interruption/resume boundary
    }
    const resumed = finalizeMfeMaeCalculator(state, whole);
    expect(resumed).toMatchObject({
      ...expected,
      provenance: {
        calculationVersion: 1,
        rawFromMsc: whole.rawFromMsc,
        rawToMsc: whole.rawToMsc,
        tickSnapshotToMsc: whole.tickSnapshotToMsc,
        valuationVersion: 1,
      },
    });
  });
});
