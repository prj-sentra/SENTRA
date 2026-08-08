import { seoulTradingDate } from './mt5-sync.service';

describe('MT5 campaign projection date', () => {
  it.each([
    ['2026-08-08T14:59:59.999Z', '2026-08-08T00:00:00.000Z'],
    ['2026-08-08T15:00:00.000Z', '2026-08-09T00:00:00.000Z'],
    ['2026-12-31T15:00:00.000Z', '2027-01-01T00:00:00.000Z'],
  ])('projects %s at the Asia/Seoul midnight boundary', (instant, expected) => {
    expect(seoulTradingDate(new Date(instant)).toISOString()).toBe(expected);
  });
});
