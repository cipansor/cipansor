import { prisma } from '../lib/prisma';
import { dayOf, dayString, wibWeekday } from './wib';

/**
 * The work calendar: which days a unit works, and which are holidays.
 *
 * Three places used to answer this question separately — the staff attendance
 * service, the payslip's day count and the deduction engine — and they did not
 * agree: two read `WorkWeekConfig`, one hardcoded Monday–Friday. A slip then
 * printed one number of work days while its deductions used another. There is
 * one answer now, here, and the callers ask for it.
 */

/** A unit's work week, falling back to the yayasan default, then to Mon–Sat. */
export async function workWeekFor(unitId: string | null): Promise<{
  workDays: number[];
  hoursPerDay: number;
}> {
  const week =
    (unitId
      ? await prisma.workWeekConfig.findFirst({ where: { unitId, isActive: true } })
      : null) ??
    (await prisma.workWeekConfig.findFirst({ where: { unitId: null, isActive: true } }));
  return {
    workDays: week?.workDays ?? [1, 2, 3, 4, 5, 6],
    hoursPerDay: week?.hoursPerDay ?? 7,
  };
}

/** A holiday as a closed interval of WIB dates, inclusive. */
export interface HolidayRange {
  from: string;
  to: string;
  title: string;
}

/**
 * Whole-unit holidays overlapping `[start, end]`, for a unit or yayasan-wide.
 * The holiday list is what keeps a national holiday from being counted as an
 * absence, so both the register and the payslip read it through this function.
 */
export async function holidaysInRange(
  start: Date,
  end: Date,
  unitId: string | null
): Promise<HolidayRange[]> {
  const rows = await prisma.calendarEvent.findMany({
    where: {
      eventType: 'HOLIDAY',
      deletedAt: null,
      // A draft is a holiday a third-party source suggested but nobody approved;
      // it must not turn a work day into a holiday or a payslip into a blank one.
      isDraft: false,
      startDate: { lte: end },
      OR: [{ endDate: null }, { endDate: { gte: start } }],
      AND: [{ OR: [{ unitId: null }, ...(unitId ? [{ unitId }] : [])] }],
    },
    select: { title: true, startDate: true, endDate: true },
  });
  return rows.map((h) => ({
    from: dayString(h.startDate),
    to: h.endDate ? dayString(h.endDate) : dayString(h.startDate),
    title: h.title,
  }));
}

/** Whether a WIB day falls inside any holiday range. */
export function isHolidayDay(day: string, holidays: HolidayRange[]): boolean {
  return holidays.some((h) => day >= h.from && day <= h.to);
}

/** Whether a WIB day is a working day for a unit, given its week and holidays. */
export function isWorkDay(day: string, workDays: number[], holidays: HolidayRange[]): boolean {
  if (!workDays.includes(wibWeekday(day))) return false;
  return !isHolidayDay(day, holidays);
}

/** Whether a WIB day is not a working day for a unit. */
export async function isNonWorkingDay(day: string, unitId: string | null): Promise<boolean> {
  const week = await workWeekFor(unitId);
  const holidays = await holidaysInRange(dayOf(day), dayOf(day), unitId);
  return !isWorkDay(day, week.workDays, holidays);
}

/**
 * Every working day in `[start, end]` for a unit, as `YYYY-MM-DD` WIB — the
 * work week minus whole-unit holidays. This is the set a payslip's day count
 * and its "unrecorded day" check both use.
 */
export async function workDatesInRange(
  start: Date,
  end: Date,
  unitId: string | null
): Promise<string[]> {
  const week = await workWeekFor(unitId);
  const holidays = await holidaysInRange(start, end, unitId);

  const dates: string[] = [];
  const first = dayOf(dayString(start));
  const last = dayOf(dayString(end));
  for (let d = first; d <= last; d = new Date(d.getTime() + 86_400_000)) {
    const day = dayString(d);
    if (isWorkDay(day, week.workDays, holidays)) dates.push(day);
  }
  return dates;
}
