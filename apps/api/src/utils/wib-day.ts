/**
 * Calendar days on the pesantren's clock: Western Indonesia Time, UTC+7, with
 * no daylight saving. A registration window that "closes on 20 December"
 * closes at the end of that day in Tasikmalaya, not seven hours later at
 * midnight UTC, wherever the server runs.
 */
export function wibDayStart(day: string): Date {
  return new Date(`${day}T00:00:00.000+07:00`);
}

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
export function dayDate(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/**
 * The same day for an optional field: `undefined` stays undefined, so a PATCH
 * leaves the column alone; an empty value clears it.
 */
export function calendarDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  return value ? dayDate(value) : null;
}

/** The WIB calendar day a moment falls on, as a date input shows it. */
export function wibDayOf(moment: Date): string {
  return new Date(moment.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
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
  const shifted = new Date(moment.getTime() + 7 * 60 * 60 * 1000);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() };
}

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

/** A `@db.Date` value as a date input shows it. */
export function dayOf(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}
