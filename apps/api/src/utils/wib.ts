/**
 * Wall-clock arithmetic in WIB (Asia/Jakarta, UTC+7), the timezone every school
 * day in this system is scheduled in. This is the **one** module for the WIB
 * calendar: both the helpers that build the bounds a `DateTime` column filters
 * on, and the ones that turn a calendar day into the value a date-only column
 * stores. It used to be two modules (`wib.ts` and `wib-day.ts`) whose `dayOf`
 * named two opposite conversions — merged 2026-11-12, ticket #851, decision K7.
 *
 * A `@db.Date` column stores a calendar day with no timezone, and Prisma reads
 * and writes it as the UTC instant of midnight. The container runs UTC, so
 * `new Date().setHours(0, 0, 0, 0)` produces the *UTC* day: a 06:30 WIB check-in
 * (23:30 UTC the day before) was filed under the previous day, and a shift
 * start built with `setHours(7, 0)` landed seven hours off — a 06:30 punch
 * computed as 975 minutes late. These helpers do the arithmetic on the WIB
 * calendar day instead.
 *
 * Indonesia has no daylight saving, so UTC+7 is a constant and no tz database
 * lookup is needed.
 *
 * Two forms a "calendar day" can take, kept apart on purpose:
 *
 *  - **a stored day** — the UTC instant of midnight (`dayOf`/`dayDate`), which
 *    is what a date-only column holds and what its readers stringify;
 *  - **a WIB instant** — a real moment on the WIB clock (`wibDayStart`,
 *    `wibDayEnd`, `wibTimeOnDay`), which is what a `DateTime` column filters on.
 *
 * A function's name says which conversion it performs and in which direction:
 * `…Of` reads a value out of an instant or a stored day, `…DayStart`/`…DayEnd`
 * build a WIB instant, `dayOf`/`dayDate`/`calendarDayOf` work on the stored
 * form. None of them is named `dayOf` in two directions any more.
 */

const WIB_OFFSET_MINUTES = 7 * 60;
const DAY_MS = 24 * 60 * 60 * 1000;

// ============================================================================
// Calendar days on the WIB clock: the bounds a DateTime column filters on
// ============================================================================

/** The first instant of a WIB calendar day: `day` 00:00 WIB. */
export function wibDayStart(day: string): Date {
  return new Date(`${day}T00:00:00.000+07:00`);
}

/** The last instant of a WIB calendar day: `day` 23:59:59.999 WIB. */
export function wibDayEnd(day: string): Date {
  return new Date(`${day}T23:59:59.999+07:00`);
}

/**
 * The exclusive `lt` bound that makes a date-only `Invoice.dueDate` overdue:
 * the first instant of today's WIB day. A bill due WIB day D is stored at
 * D 00:00Z and stays due through the whole of D, so it is overdue only once D
 * has ended. Comparing the column to `new Date()` instead made a bill overdue
 * at 07:00 WIB on its own due date, because D 00:00Z is exactly that instant.
 */
export function wibOverdueCutoff(now: Date = new Date()): Date {
  return wibDayStart(wibDayOf(now));
}

/**
 * A report bound a request carries as a date — the date-only `YYYY-MM-DD` the
 * report pages send — as the instant a `DateTime` column filter needs.
 *
 * `new Date('2026-01-31')` is midnight UTC, which is 07:00 WIB: filtering a
 * `DateTime` column with `lte` on it silently drops every entry made later that
 * day, so a month report loses its last day. This resolves the date to the WIB
 * day it names and takes that day's first millisecond for a lower bound or its
 * last for an upper bound. A string that carries a time is resolved to the WIB
 * day that instant falls on, so an ISO caller means the same day.
 */
export function wibDayBound(value: string, edge: 'start' | 'end'): Date {
  const day = wibDayOf(new Date(value));
  return edge === 'start' ? wibDayStart(day) : wibDayEnd(day);
}

/**
 * The WIB calendar year a moment falls in, as the `[start, end]` instants a
 * `DateTime` filter needs. Year-to-date reports default to it, so a default
 * derived from the server clock must not land on the previous UTC year.
 */
export function wibYearBounds(moment: Date): { start: Date; end: Date } {
  const { year } = wibMonthYear(moment);
  const first = wibDate(year, 0, 1);
  const last = wibDate(year, 11, 31);
  return { start: wibDayStart(wibDayOf(first)), end: wibDayEnd(wibDayOf(last)) };
}

/**
 * A calendar month as the real-instant bounds a `DateTime` column holding a
 * wall-clock moment uses: `[00:00:00.000 WIB on the 1st, 23:59:59.999 WIB on
 * the last day]`. `utcMonthRange` bounds a *date-only* column at midnight UTC;
 * this bounds a *timestamp* column (`JournalEntry.date`, the moment an entry
 * was posted). Using the UTC bounds there drops the whole last day and the
 * first hours of the 1st (00:00–07:00 WIB, stored the previous UTC day).
 *
 * `month` is zero-based (0-11), as in `wibMonthYear`.
 */
export function wibMonthRange(year: number, month: number): { start: Date; end: Date } {
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const mm = String(month + 1).padStart(2, '0');
  return {
    start: wibDayStart(`${year}-${mm}-01`),
    end: wibDayEnd(`${year}-${mm}-${String(lastDay).padStart(2, '0')}`),
  };
}

/** A calendar month as the date-only bounds its column uses: `[start, end)` at
 * midnight UTC — the form `wibDate` writes for a date-only column. */
export function utcMonthRange(year: number, month: number): { start: Date; end: Date } {
  const nextYear = month === 11 ? year + 1 : year;
  const nextMonth = (month + 1) % 12;
  return {
    start: new Date(Date.UTC(year, month, 1)),
    end: new Date(Date.UTC(nextYear, nextMonth, 1)),
  };
}

// ============================================================================
// Instants on the WIB clock
// ============================================================================

/** Minutes since WIB midnight for an instant; 0–1439. */
export function wibMinutesOfDay(instant: Date): number {
  const utcMinutes = instant.getUTCHours() * 60 + instant.getUTCMinutes();
  return (utcMinutes + WIB_OFFSET_MINUTES) % (24 * 60);
}

/**
 * The instant of a WIB wall-clock time ("HH:mm") on a WIB calendar day. The
 * inverse of `wibMinutesOfDay`: 07:00 on 2026-09-30 WIB is 00:00Z that day.
 */
export function wibTimeOnDay(day: string, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const midnight = dayOf(day).getTime();
  return new Date(midnight + (h * 60 + m - WIB_OFFSET_MINUTES) * 60_000);
}

/**
 * The WIB Monday–Sunday week a calendar day belongs to, as `[start, end)`
 * instants: Monday 00:00 WIB → the following Monday 00:00 WIB, with the same
 * bounds for the week before (`prevStart`).
 *
 * The bounds are WIB midnights, which also select the right days from a
 * `@db.Date` column: a day D is stored at UTC midnight, and that instant always
 * falls inside the WIB day D window `[D-1 17:00Z, D 17:00Z)`. Computing the
 * week from the server clock instead (`setDate`/`setHours` on a UTC container)
 * lands on the previous Monday for the whole 00:00–07:00 WIB stretch, because
 * the clock is still on the day before.
 */
export function wibWeekRange(day: string): { start: Date; end: Date; prevStart: Date } {
  const dow = (wibWeekday(day) + 6) % 7; // 0 = Monday
  const monday = dayString(new Date(dayOf(day).getTime() - dow * DAY_MS));
  const start = new Date(`${monday}T00:00:00.000+07:00`);
  return {
    start,
    end: new Date(start.getTime() + 7 * DAY_MS),
    prevStart: new Date(start.getTime() - 7 * DAY_MS),
  };
}

// ============================================================================
// Reading a calendar day out of an instant
// ============================================================================

/** Today's calendar day in WIB, "yyyy-MM-dd". */
export const todayWib = (now: Date = new Date()): string =>
  now.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });

/** The WIB calendar day a moment falls on, as a date input shows it. */
export function wibDayOf(moment: Date): string {
  return new Date(moment.getTime() + WIB_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}

/**
 * The WIB calendar month a moment falls on, as `{ year, month }` with `month`
 * zero-based (0-11) like `Date.getMonth()`.
 *
 * The monthly billing job fires at 04:00 WIB on the 1st, which is still the
 * previous month — and, in January, the previous year — on a UTC server. WIB
 * is a fixed UTC+7 with no daylight saving, so shifting the instant and reading
 * the UTC fields derives the WIB month from any server clock.
 */
export function wibMonthYear(moment: Date): { year: number; month: number } {
  const shifted = new Date(moment.getTime() + WIB_OFFSET_MINUTES * 60_000);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() };
}

/** `2026-09` — the month key a "already warned" marker stores. */
export function wibMonthKey(moment: Date): string {
  const { year, month } = wibMonthYear(moment);
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

/** A `@db.Date` value as a date input shows it. */
export function calendarDayOf(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

/**
 * The WIB calendar day `now` falls on, as the stored day (midnight UTC) a
 * `@db.Date` column holds — the chatbot usage ledger's `date` column. Read
 * through `wibDayOf` first, so an instant between 00:00 and 07:00 WIB is filed
 * under its own WIB day and not the previous UTC one.
 */
export const wibDay = (now: Date): Date => dayDate(wibDayOf(now));

/** The first day of the WIB month `now` falls in, as the stored day. */
export const wibMonthStart = (now: Date): Date => dayDate(`${wibMonthKey(now)}-01`);

// ============================================================================
// The stored form of a calendar day (midnight UTC) — what a date-only column holds
// ============================================================================

/**
 * A "yyyy-MM-dd" day as the `@db.Date` column stores it (UTC midnight). The
 * canonical writer: `wibDate` and `dayDate` produce the same value, and the
 * three names stay because each says something different at its call site.
 */
export const dayOf = (day: string): Date => new Date(`${day}T00:00:00.000Z`);

/**
 * A date input's day as the value a date-only column holds: midnight UTC
 * (`@db.Date`, and the form `academic-calendar.ts` and `academicYearBillingWindow`
 * already use). A `DateTime` column kept as a calendar day — `Invoice.dueDate` —
 * holds the same value, so every reader that stringifies it without a timezone
 * (`toLocaleDateString('id-ID')`) and every filter that bounds it with a UTC
 * first-of-month agree on the day.
 *
 * `Invoice.dueDate` now has this one canonical form: every writer stores it
 * through here or through another midnight-UTC helper — the manual
 * `createInvoice`/`updateInvoice` path, the recurring and bulk SPP runs, the
 * course enrollment invoice, and the seed — so the column holds midnight UTC
 * everywhere (#811).
 */
export const dayDate = (day: string): Date => new Date(`${day}T00:00:00.000Z`);

/**
 * The same day for an optional field: `undefined` stays undefined, so a PATCH
 * leaves the column alone; an empty value clears it.
 */
export function calendarDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  return value ? dayDate(value) : null;
}

/** The "yyyy-MM-dd" of a stored `@db.Date` value. The canonical reader. */
export const dayString = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * A calendar day as the value a date-only column holds: midnight UTC.
 *
 * Invoice `dueDate` is a date-only `DateTime`; the codebase stores these at
 * midnight UTC (`academic-calendar.ts`, `seeds/paket-presentasi.ts`, and
 * `academicYearBillingWindow`), readers stringify them without a timezone
 * (`toLocaleDateString('id-ID')`, `toISOString().slice(0, 10)`), and the
 * academic-year and monthly filters bound them with UTC first-of-month. A
 * date-only column can hold one form; returning midnight UTC keeps every one of
 * those readers and filters correct, whereas a WIB-midnight instant (17:00Z the
 * day before) reads as the previous day and falls out of its own month.
 *
 * `month` is zero-based (0-11); `Date.UTC` rolls an over-large `day` into the
 * next month, as `new Date(year, month, day)` did.
 */
export function wibDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day));
}

/** Day of week (0=Sunday … 6=Saturday) of a WIB calendar day. */
export const wibWeekday = (day: string): number => dayOf(day).getUTCDay();

/**
 * A WIB calendar day shifted by whole days (negative for earlier ones).
 *
 * The arithmetic is done on the UTC midnight the string already carries, so it
 * never consults the host clock — `setDate()` on a local `Date` would, and on a
 * UTC container that silently returns the previous day around 00:00–07:00 WIB.
 */
export function shiftWibDay(day: string, days: number): string {
  const d = dayOf(day);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
