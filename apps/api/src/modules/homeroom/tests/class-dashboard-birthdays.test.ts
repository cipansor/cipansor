import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { upcomingBirthdaysOf } from '../homeroom.service';

/**
 * "Ulang Tahun Mendatang" on the homeroom dashboard (#948). The UTC container's
 * clock is still yesterday between 00:00 and 06:59 WIB, and the birthday's
 * midnight was compared with the current instant, so a birthday later today
 * read as already past and dropped out of the list for a year.
 */

const santri = (id: string, birthDate: string) => ({
  id,
  nis: `N-${id}`,
  birthDate: new Date(`${birthDate}T00:00:00.000Z`), // a date input's day
  user: { name: `Santri ${id}` },
});

const prevTz = process.env.TZ;
beforeAll(() => {
  process.env.TZ = 'UTC';
});
afterAll(() => {
  if (prevTz === undefined) delete process.env.TZ;
  else process.env.TZ = prevTz;
});

const days = (list: ReturnType<typeof upcomingBirthdaysOf>) =>
  list.map((b) => [b.student.id, b.daysUntil]);

describe('upcomingBirthdaysOf', () => {
  it('lists a birthday today at 17:00 WIB with daysUntil 0', () => {
    const now = new Date('2026-11-06T10:00:00.000Z'); // 6 Nov 2026 17:00 WIB
    expect(days(upcomingBirthdaysOf([santri('a', '2012-11-06')], now))).toEqual([['a', 0]]);
  });

  it('counts on the WIB day between 00:00 and 06:59 WIB', () => {
    const now = new Date('2026-11-06T17:30:00.000Z'); // 7 Nov 2026 00:30 WIB
    const list = upcomingBirthdaysOf(
      [
        santri('today', '2012-11-07'),
        santri('yesterday', '2012-11-06'),
        santri('next', '2012-11-08'),
      ],
      now
    );
    // 6 November has passed in WIB; 7 November is today, 8 November tomorrow.
    expect(days(list)).toEqual([
      ['today', 0],
      ['next', 1],
    ]);
  });

  it('keeps the 0..30 window, soonest first, across the year end', () => {
    const now = new Date('2026-12-20T03:00:00.000Z'); // 20 Dec 2026 10:00 WIB
    const list = upcomingBirthdaysOf(
      [santri('jan', '2011-01-05'), santri('dec', '2011-12-25'), santri('far', '2011-02-10')],
      now
    );
    expect(days(list)).toEqual([
      ['dec', 5],
      ['jan', 16],
    ]);
  });

  it('places a 29 February birthday on 1 March in a common year', () => {
    const now = new Date('2027-02-27T03:00:00.000Z'); // 27 Feb 2027 10:00 WIB
    expect(days(upcomingBirthdaysOf([santri('leap', '2012-02-29')], now))).toEqual([['leap', 2]]);
  });
});
