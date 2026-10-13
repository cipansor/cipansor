/**
 * Wall-clock arithmetic in WIB (Asia/Jakarta, UTC+7), the timezone every
 * school day in this system is scheduled in.
 *
 * A `@db.Date` column stores a calendar day with no timezone, and Prisma reads
 * and writes it as the UTC instant of midnight. The container runs UTC, so
 * `new Date().setHours(0, 0, 0, 0)` produces the *UTC* day: a 06:30 WIB check-in
 * (23:30 UTC the day before) was filed under the previous day, and a shift
 * start built with `setHours(7, 0)` landed seven hours off — a 06:30 punch
 * computed as 975 minutes late. These helpers do the arithmetic on the WIB
 * calendar day instead, and are the only place that conversion happens.
 *
 * Indonesia has no daylight saving, so UTC+7 is a constant and no tz database
 * lookup is needed.
 */

const WIB_OFFSET_MINUTES = 7 * 60;

/** Today's calendar day in WIB, "yyyy-MM-dd". */
export const todayWib = (now: Date = new Date()): string =>
  now.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });

/** A "yyyy-MM-dd" day as the `@db.Date` column stores it (UTC midnight). */
export const dayOf = (day: string): Date => new Date(`${day}T00:00:00.000Z`);

/** The "yyyy-MM-dd" of a stored `@db.Date` value. */
export const dayString = (date: Date): string => date.toISOString().slice(0, 10);

/** Minutes since WIB midnight for an instant; 0–1439. */
export function wibMinutesOfDay(instant: Date): number {
  const utcMinutes = instant.getUTCHours() * 60 + instant.getUTCMinutes();
  return (utcMinutes + WIB_OFFSET_MINUTES) % (24 * 60);
}

/** Day of week (0=Sunday … 6=Saturday) of a WIB calendar day. */
export const wibWeekday = (day: string): number => dayOf(day).getUTCDay();

/**
 * The instant of a WIB wall-clock time ("HH:mm") on a WIB calendar day. The
 * inverse of `wibMinutesOfDay`: 07:00 on 2026-09-30 WIB is 00:00Z that day.
 */
export function wibTimeOnDay(day: string, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const midnight = dayOf(day).getTime();
  return new Date(midnight + (h * 60 + m - WIB_OFFSET_MINUTES) * 60_000);
}
