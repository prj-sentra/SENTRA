import { mt5DealReason, seoulTradingDate } from './mt5-sync.service';

describe('MT5 campaign projection date', () => {
  it.each([
    ['2026-08-08T14:59:59.999Z', '2026-08-08T00:00:00.000Z'],
    ['2026-08-08T15:00:00.000Z', '2026-08-09T00:00:00.000Z'],
    ['2026-12-31T15:00:00.000Z', '2027-01-01T00:00:00.000Z'],
  ])('projects %s at the Asia/Seoul midnight boundary', (instant, expected) => {
    expect(seoulTradingDate(new Date(instant)).toISOString()).toBe(expected);
  });
});

describe('MT5 deal reason mapping', () => {
  it.each([
    [0, 'manual'], [1, 'manual'], [2, 'manual'],
    [3, 'automated'], [4, 'stop_loss'], [5, 'target_hit'],
    [6, 'forced_liquidation'], [7, 'rollover'], [8, 'variation_margin'],
    [9, 'split'], [10, 'corporate_action'], [999, 'other'],
  ] as const)('maps MT5 reason %i to %s', (reason, expected) => {
    expect(mt5DealReason(reason)).toBe(expected);
  });
});
