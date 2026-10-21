import { describe, it, expect } from 'vitest';
import { dayOf, shiftWibDay, todayWib, wibTimeOnDay } from './wib';

/**
 * `shiftWibDay` is the day arithmetic the dashboard bounds its "hari ini",
 * "kemarin" and "minggu ini" windows with (ticket #857). It must never consult
 * the host clock: `setDate()` on a local `Date` does, and on a UTC container
 * that silently returns the previous day between 00:00 and 06:59 WIB.
 */
describe('shiftWibDay', () => {
  it('moves whole days forward and back across a month boundary', () => {
    expect(shiftWibDay('2026-11-01', -1)).toBe('2026-10-31');
    expect(shiftWibDay('2026-10-31', 1)).toBe('2026-11-01');
    expect(shiftWibDay('2026-11-01', -6)).toBe('2026-10-26');
  });

  it('is unaffected by the host clock, even at 00:30 WIB', () => {
    // The pure function has no clock to read; this pins the intent.
    expect(shiftWibDay('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('wibTimeOnDay', () => {
  it('places WIB midnight seven hours before UTC midnight', () => {
    expect(wibTimeOnDay('2026-11-01', '00:00').toISOString()).toBe('2026-10-31T17:00:00.000Z');
  });
});

describe('todayWib / dayOf round trip', () => {
  it('stores a WIB day at UTC midnight', () => {
    expect(dayOf('2026-11-01').toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(todayWib(new Date('2026-10-31T17:30:00.000Z'))).toBe('2026-11-01');
  });
});
