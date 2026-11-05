import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { wibWeekRange, todayWib, wibWeekday } from './wib';

// The WIB week helper must derive the calendar from the given day alone, never
// from the host clock: production runs the API container in UTC, where the
// server-local week rolled a whole week back for the 00:00–07:00 WIB stretch.
const prevTz = process.env.TZ;

describe('wibWeekRange', () => {
  beforeAll(() => {
    process.env.TZ = 'UTC';
  });
  afterAll(() => {
    if (prevTz === undefined) delete process.env.TZ;
    else process.env.TZ = prevTz;
  });

  it('bounds the week Monday 00:00 WIB → next Monday 00:00 WIB', () => {
    const { start, end, prevStart } = wibWeekRange('2026-03-02'); // Monday
    expect(start.toISOString()).toBe('2026-03-01T17:00:00.000Z');
    expect(end.toISOString()).toBe('2026-03-08T17:00:00.000Z');
    expect(prevStart.toISOString()).toBe('2026-02-22T17:00:00.000Z');
  });

  it('gives every day of the week the same Monday..Sunday window', () => {
    const expected = '2026-03-01T17:00:00.000Z';
    for (const day of ['2026-03-02', '2026-03-04', '2026-03-08']) {
      expect(wibWeekRange(day).start.toISOString()).toBe(expected);
    }
  });

  it('rolls to the next week on the following Monday', () => {
    expect(wibWeekRange('2026-03-09').start.toISOString()).toBe('2026-03-08T17:00:00.000Z');
  });

  it('rolls a month and a year boundary without drifting', () => {
    expect(wibWeekRange('2026-01-01').start.toISOString()).toBe('2025-12-28T17:00:00.000Z');
    expect(wibWeekRange('2027-01-01').start.toISOString()).toBe('2026-12-27T17:00:00.000Z');
  });

  it('stays the same instant on any server timezone', () => {
    const utc = wibWeekRange('2026-03-02');
    process.env.TZ = 'Asia/Makassar'; // UTC+8, east of WIB
    const makassar = wibWeekRange('2026-03-02');
    process.env.TZ = 'America/New_York';
    const newYork = wibWeekRange('2026-03-02');
    process.env.TZ = 'UTC';

    expect(makassar.start.getTime()).toBe(utc.start.getTime());
    expect(newYork.start.getTime()).toBe(utc.start.getTime());
    expect(newYork.end.getTime()).toBe(utc.end.getTime());
  });
});

describe('todayWib / wibWeekday', () => {
  it('reads the WIB day a Monday-dawn instant falls on', () => {
    // 2026-03-01 22:00Z is Monday 2026-03-02 05:00 WIB.
    expect(todayWib(new Date('2026-03-01T22:00:00Z'))).toBe('2026-03-02');
    expect(wibWeekday('2026-03-02')).toBe(1); // Monday
    expect(wibWeekday('2026-03-08')).toBe(0); // Sunday
  });
});
