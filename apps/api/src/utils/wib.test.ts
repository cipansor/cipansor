import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  calendarDate,
  dayDate,
  dayOf,
  shiftWibDay,
  todayWib,
  utcMonthRange,
  wibDate,
  wibDayBound,
  wibMonthRange,
  wibMonthYear,
  wibOverdueCutoff,
  wibTimeOnDay,
  wibWeekRange,
  wibWeekday,
  wibYearBounds,
} from './wib';

// The WIB helpers must derive the calendar from the given day or instant alone,
// never from the host clock: production runs the API container in UTC, where
// the server-local day and week roll back for the 00:00–07:00 WIB stretch. Each
// case is checked against the confirmed UTC+7 arithmetic, and the timezone cases
// are pinned so a server-local construction cannot creep back in.
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

describe('wibMonthYear', () => {
  beforeAll(() => {
    process.env.TZ = 'UTC';
  });
  afterAll(() => {
    if (prevTz === undefined) delete process.env.TZ;
    else process.env.TZ = prevTz;
  });

  it('reads the month WIB is in, not the month UTC is in', () => {
    // 2026-07-31 21:00Z is 2026-08-01 04:00 WIB (the auto-billing cron instant).
    expect(wibMonthYear(new Date('2026-07-31T21:00:00Z'))).toEqual({ year: 2026, month: 7 });
    // 2025-12-31 19:00Z is 2026-01-01 02:00 WIB — the year rolls too.
    expect(wibMonthYear(new Date('2025-12-31T19:00:00Z'))).toEqual({ year: 2026, month: 0 });
  });
});

describe('wibDate', () => {
  beforeAll(() => {
    process.env.TZ = 'UTC';
  });
  afterAll(() => {
    if (prevTz === undefined) delete process.env.TZ;
    else process.env.TZ = prevTz;
  });

  it('returns the date-only value a dueDate column holds: midnight UTC', () => {
    // The value readers stringify without a timezone, so a later local-midnight
    // instant (which is 17:00Z the day before) would render one day early.
    expect(wibDate(2026, 7, 10).toISOString()).toBe('2026-08-10T00:00:00.000Z');
    expect(wibDate(2026, 7, 1).toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  it('is the same instant on any server timezone', () => {
    const utc = wibDate(2026, 7, 1);
    process.env.TZ = 'Asia/Makassar'; // UTC+8, east of WIB
    const makassar = wibDate(2026, 7, 1);
    process.env.TZ = 'America/New_York';
    const newYork = wibDate(2026, 7, 1);
    process.env.TZ = 'UTC';

    expect(utc.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(makassar.getTime()).toBe(utc.getTime());
    expect(newYork.getTime()).toBe(utc.getTime());
  });

  it('rolls an over-large day into the next month, as the local constructor did', () => {
    expect(wibDate(2026, 7, 32).toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });
});

describe('utcMonthRange', () => {
  beforeAll(() => {
    process.env.TZ = 'UTC';
  });
  afterAll(() => {
    if (prevTz === undefined) delete process.env.TZ;
    else process.env.TZ = prevTz;
  });

  it('bounds a date-only column month at midnight UTC', () => {
    const { start, end } = utcMonthRange(2026, 7);
    expect(start.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  it('rolls over from December to January of the next year', () => {
    const { start, end } = utcMonthRange(2026, 11);
    expect(start.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });
});

describe('wibMonthRange', () => {
  beforeAll(() => {
    process.env.TZ = 'UTC';
  });
  afterAll(() => {
    if (prevTz === undefined) delete process.env.TZ;
    else process.env.TZ = prevTz;
  });

  it('closes the month on the WIB clock, whole last day included', () => {
    const { start, end } = wibMonthRange(2026, 10); // November 2026
    expect(start.toISOString()).toBe('2026-10-31T17:00:00.000Z'); // 1 Nov 00:00 WIB
    expect(end.toISOString()).toBe('2026-11-30T16:59:59.999Z'); // 30 Nov 23:59:59.999 WIB
  });

  it('covers the whole of the last day, not just its midnight', () => {
    const { start, end } = wibMonthRange(2026, 10);
    // 30 Nov 10:00 WIB — the payment the UTC-midnight bound used to drop.
    const lastDayPayment = new Date('2026-11-30T03:00:00.000Z');
    expect(lastDayPayment >= start && lastDayPayment <= end).toBe(true);
  });

  it('includes the first hours of the 1st, stored on the previous UTC day', () => {
    const { start, end } = wibMonthRange(2026, 10);
    // 1 Nov 02:00 WIB is 31 Oct 19:00Z.
    const earlyFirstDay = new Date('2026-10-31T19:00:00.000Z');
    expect(earlyFirstDay >= start && earlyFirstDay <= end).toBe(true);
  });

  it('handles February and a leap year', () => {
    expect(wibMonthRange(2026, 1).end.toISOString()).toBe('2026-02-28T16:59:59.999Z');
    expect(wibMonthRange(2024, 1).end.toISOString()).toBe('2024-02-29T16:59:59.999Z');
  });

  it('rolls over from December to January of the next year', () => {
    const { start, end } = wibMonthRange(2026, 11);
    expect(start.toISOString()).toBe('2026-11-30T17:00:00.000Z'); // 1 Dec 00:00 WIB
    expect(end.toISOString()).toBe('2026-12-31T16:59:59.999Z'); // 31 Dec 23:59:59.999 WIB
  });
});

describe('dayDate / calendarDate', () => {
  beforeAll(() => {
    process.env.TZ = 'UTC';
  });
  afterAll(() => {
    if (prevTz === undefined) delete process.env.TZ;
    else process.env.TZ = prevTz;
  });

  it('stores a day as the value a date-only column holds: midnight UTC', () => {
    // The value readers stringify without a timezone, so a server-local-midnight
    // instant (which is 17:00Z the day before on a UTC+7 host) would render a day
    // early and fall outside its own UTC-month bounds.
    expect(dayDate('2026-08-10').toISOString()).toBe('2026-08-10T00:00:00.000Z');
    expect(calendarDate('2026-08-10')?.toISOString()).toBe('2026-08-10T00:00:00.000Z');
  });

  it('is the same instant on any server timezone', () => {
    const utc = dayDate('2026-08-01');
    process.env.TZ = 'Asia/Makassar'; // UTC+8, east of WIB
    const makassar = dayDate('2026-08-01');
    process.env.TZ = 'America/New_York';
    const newYork = dayDate('2026-08-01');
    process.env.TZ = 'UTC';

    expect(utc.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(makassar.getTime()).toBe(utc.getTime());
    expect(newYork.getTime()).toBe(utc.getTime());
  });

  it('leaves an absent value undefined and clears an empty one', () => {
    expect(calendarDate(undefined)).toBeUndefined();
    expect(calendarDate('')).toBeNull();
    expect(calendarDate(null)).toBeNull();
  });
});

describe('wibDayBound', () => {
  beforeAll(() => {
    process.env.TZ = 'UTC';
  });
  afterAll(() => {
    if (prevTz === undefined) delete process.env.TZ;
    else process.env.TZ = prevTz;
  });

  it('takes a date-only bound to the first and last instant of that WIB day', () => {
    // `new Date('2026-01-31')` is 07:00 WIB — the bug this helper exists for.
    expect(wibDayBound('2026-01-31', 'start').toISOString()).toBe('2026-01-30T17:00:00.000Z');
    expect(wibDayBound('2026-01-31', 'end').toISOString()).toBe('2026-01-31T16:59:59.999Z');
  });

  it('keeps an entry made in the last WIB hours of the day inside the end bound', () => {
    // 31 January 14:00 WIB — the reproduction in the report, dropped by
    // `new Date('2026-01-31')`.
    const entry = new Date('2026-01-31T14:00:00+07:00');
    expect(entry.getTime()).toBeLessThanOrEqual(wibDayBound('2026-01-31', 'end').getTime());
  });

  it('resolves an instant to the WIB day it falls on', () => {
    // 2026-01-31 23:30 WIB is 2026-01-31T16:30Z; the end bound stays on 31 Jan.
    expect(wibDayBound('2026-01-31T16:30:00Z', 'end').toISOString()).toBe(
      '2026-01-31T16:59:59.999Z'
    );
    // 2026-01-31 00:30 WIB is 2026-01-30T17:30Z — still 31 January WIB.
    expect(wibDayBound('2026-01-30T17:30:00Z', 'end').toISOString()).toBe(
      '2026-01-31T16:59:59.999Z'
    );
  });

  it('is the same instant on any server timezone', () => {
    const utc = wibDayBound('2026-01-31', 'end');
    process.env.TZ = 'Asia/Makassar';
    const makassar = wibDayBound('2026-01-31', 'end');
    process.env.TZ = 'America/New_York';
    const newYork = wibDayBound('2026-01-31', 'end');
    process.env.TZ = 'UTC';

    expect(makassar.getTime()).toBe(utc.getTime());
    expect(newYork.getTime()).toBe(utc.getTime());
  });
});

describe('wibYearBounds', () => {
  beforeAll(() => {
    process.env.TZ = 'UTC';
  });
  afterAll(() => {
    if (prevTz === undefined) delete process.env.TZ;
    else process.env.TZ = prevTz;
  });

  it('spans the WIB year, ending on the last millisecond of 31 December', () => {
    const { start, end } = wibYearBounds(new Date('2026-06-15T10:00:00Z'));
    expect(start.toISOString()).toBe('2025-12-31T17:00:00.000Z');
    expect(end.toISOString()).toBe('2026-12-31T16:59:59.999Z');
  });

  it('reads the year WIB is in, not the year UTC is in', () => {
    // 2025-12-31 19:00Z is 2026-01-01 02:00 WIB — the year rolls.
    const { start } = wibYearBounds(new Date('2025-12-31T19:00:00Z'));
    expect(start.toISOString()).toBe('2025-12-31T17:00:00.000Z');
  });
});

describe('wibOverdueCutoff', () => {
  it('is the first instant of the WIB day the clock is on', () => {
    // 26 Nov 2026 08:00 WIB is 26 Nov 01:00Z; the cutoff is 26 Nov 00:00 WIB.
    expect(wibOverdueCutoff(new Date('2026-11-26T01:00:00Z')).toISOString()).toBe(
      '2026-11-25T17:00:00.000Z'
    );
  });

  it('holds the same cutoff through the whole WIB day', () => {
    const morning = wibOverdueCutoff(new Date('2026-11-26T01:00:00Z')); // 08:00 WIB
    const evening = wibOverdueCutoff(new Date('2026-11-26T16:30:00Z')); // 23:30 WIB
    expect(evening.getTime()).toBe(morning.getTime());
  });

  it('advances to the next WIB day once the WIB midnight passes', () => {
    // 26 Nov 2026 23:30 WIB (16:30Z) is still 26 November; 27 Nov 00:30 WIB
    // (26 Nov 17:30Z) has crossed into the next WIB day.
    expect(wibOverdueCutoff(new Date('2026-11-26T16:30:00Z')).toISOString()).toBe(
      '2026-11-25T17:00:00.000Z'
    );
    expect(wibOverdueCutoff(new Date('2026-11-26T17:30:00Z')).toISOString()).toBe(
      '2026-11-26T17:00:00.000Z'
    );
  });

  it('is the same instant on any server timezone', () => {
    const utc = wibOverdueCutoff(new Date('2026-11-26T01:00:00Z'));
    process.env.TZ = 'America/New_York';
    const newYork = wibOverdueCutoff(new Date('2026-11-26T01:00:00Z'));
    process.env.TZ = 'UTC';

    expect(newYork.getTime()).toBe(utc.getTime());
  });
});
