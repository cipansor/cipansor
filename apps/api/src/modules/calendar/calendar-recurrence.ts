import { shiftWibDay } from '@/utils/wib';
import type { EventRecurrenceCode } from '@cipansor/shared';

/**
 * Recurring events, materialised (#1155).
 *
 * A series is stored as one row per occurrence, so the six places that read
 * `calendar_events` by date — the list, today, statistics, the attendance
 * reminder, the work calendar and the notification scheduler — are each right
 * about an occurrence without carrying expansion logic of their own. The first
 * occurrence is the parent; every later one points back at it.
 *
 * The arithmetic runs on WIB calendar days through `utils/wib`, never on a
 * local `Date`: the container is UTC, and `setMonth()` on a local date slides
 * the day across the 00:00–07:00 WIB window.
 */

const MAX_OCCURRENCES = 400;
const DAY_MS = 86_400_000;

const daysInMonth = (year: number, monthIndex: number) =>
  new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

const isoDay = (year: number, monthIndex: number, day: number) =>
  `${year.toString().padStart(4, '0')}-${(monthIndex + 1).toString().padStart(2, '0')}-${day
    .toString()
    .padStart(2, '0')}`;

/** Whole days from `from` to `to`, both "yyyy-MM-dd". */
export function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / DAY_MS
  );
}

/** The RRULE stored on the series' parent, e.g. `FREQ=WEEKLY;UNTIL=20270620`. */
export function recurrenceRuleFor(
  frequency: Exclude<EventRecurrenceCode, 'NONE'>,
  until: string
): string {
  return `FREQ=${frequency};UNTIL=${until.replace(/-/g, '')}`;
}

/**
 * Every occurrence **after** the first, as WIB calendar days, up to and
 * including `until`.
 *
 * Monthly and yearly series follow RFC 5545: a month without the 29th–31st, or
 * a year without 29 February, is **skipped** rather than clamped to the last
 * day — clamping would turn "the 31st" into a series that drifts earlier every
 * month, which is not the day the user chose.
 */
export function occurrenceDays(
  start: string,
  frequency: Exclude<EventRecurrenceCode, 'NONE'>,
  until: string
): string[] {
  const [year, month, day] = start.split('-').map(Number);
  const out: string[] = [];

  for (let n = 1; n <= MAX_OCCURRENCES; n++) {
    if (frequency === 'DAILY' || frequency === 'WEEKLY') {
      const candidate = shiftWibDay(start, frequency === 'DAILY' ? n : n * 7);
      if (candidate > until) break;
      out.push(candidate);
      continue;
    }

    const monthOffset = frequency === 'MONTHLY' ? n : n * 12;
    const total = year * 12 + (month - 1) + monthOffset;
    const candidateYear = Math.floor(total / 12);
    const candidateMonth = total % 12;

    // The month itself has moved past the series' end: nothing later can land
    // inside it, whether or not this month has the chosen day.
    if (isoDay(candidateYear, candidateMonth, 1) > until) break;
    if (day > daysInMonth(candidateYear, candidateMonth)) continue;

    const candidate = isoDay(candidateYear, candidateMonth, day);
    if (candidate > until) break;
    out.push(candidate);
  }

  return out;
}
