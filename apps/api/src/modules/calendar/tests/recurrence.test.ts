import { describe, it, expect } from 'vitest';
import { daysBetween, occurrenceDays, recurrenceRuleFor } from '../calendar-recurrence';

/**
 * The occurrence generator behind a recurring event (#1155).
 *
 * Every occurrence is a row, so this arithmetic *is* the series: a day it
 * misses never reaches the calendar, and a day it invents cannot be deleted
 * because the user never saw it. The monthly/yearly cases are where a naive
 * implementation drifts — `setMonth()` clamps 31 January + 1 month to 3 March,
 * which is not the day anyone chose.
 */
describe('occurrenceDays', () => {
  it('steps a daily series one day at a time, up to and including the end', () => {
    expect(occurrenceDays('2026-03-01', 'DAILY', '2026-03-04')).toEqual([
      '2026-03-02',
      '2026-03-03',
      '2026-03-04',
    ]);
  });

  it('steps a weekly series on the same weekday', () => {
    // 2026-03-02 is a Monday; every occurrence must stay a Monday.
    expect(occurrenceDays('2026-03-02', 'WEEKLY', '2026-03-23')).toEqual([
      '2026-03-09',
      '2026-03-16',
      '2026-03-23',
    ]);
  });

  it('skips a month that has no such day instead of clamping', () => {
    // The 31st: February and April have none, so RFC 5545 skips those months.
    // Clamping would put an occurrence on 28 February and 30 April that the
    // user never asked for.
    expect(occurrenceDays('2026-01-31', 'MONTHLY', '2026-06-30')).toEqual([
      '2026-03-31',
      '2026-05-31',
    ]);
  });

  it('keeps 29 February out of a yearly series in a common year', () => {
    // A common year has no 29 February, so the series has no occurrence there
    // at all — it does not slide to the 28th.
    expect(occurrenceDays('2024-02-29', 'YEARLY', '2028-12-31')).toEqual(['2028-02-29']);
  });

  it('crosses a year boundary', () => {
    expect(occurrenceDays('2026-12-30', 'DAILY', '2027-01-01')).toEqual([
      '2026-12-31',
      '2027-01-01',
    ]);
  });

  it('returns nothing when the end is the start day', () => {
    expect(occurrenceDays('2026-05-01', 'DAILY', '2026-05-01')).toEqual([]);
  });

  it('stops at the end even when it falls between occurrences', () => {
    expect(occurrenceDays('2026-05-04', 'WEEKLY', '2026-05-20')).toEqual([
      '2026-05-11',
      '2026-05-18',
    ]);
  });

  it('never yields more than the cap, so one save cannot write unbounded rows', () => {
    // ~27 years of daily occurrences, asked for 366 days' worth only by the
    // schema; the generator's own ceiling is the second guard.
    expect(occurrenceDays('2026-01-01', 'DAILY', '2050-01-01').length).toBeLessThanOrEqual(400);
  });
});

describe('recurrenceRuleFor', () => {
  it('writes an RFC 5545 rule with a compact UNTIL', () => {
    expect(recurrenceRuleFor('WEEKLY', '2027-06-20')).toBe('FREQ=WEEKLY;UNTIL=20270620');
  });
});

describe('daysBetween', () => {
  it('counts whole calendar days', () => {
    expect(daysBetween('2026-01-01', '2026-01-01')).toBe(0);
    expect(daysBetween('2026-01-01', '2026-01-03')).toBe(2);
    // Across the 29 February of a leap year.
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2);
  });
});
