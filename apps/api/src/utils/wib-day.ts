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
 * A date input's day as the value a date-only column holds: midnight UTC
 * (`@db.Date`, and the form `academic-calendar.ts` and `academicYearBillingWindow`
 * already use). A `DateTime` column kept as a calendar day — `Invoice.dueDate` —
 * holds the same value, so every reader that stringifies it without a timezone
 * (`toLocaleDateString('id-ID')`) and every filter that bounds it with a UTC
 * first-of-month agree on the day.
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

/** A `@db.Date` value as a date input shows it. */
export function dayOf(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}
