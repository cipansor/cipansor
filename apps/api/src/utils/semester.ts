import { ApiError, ErrorCode } from '@/middleware/error';
import { wibDayOf } from '@/utils/wib';

/**
 * The two semesters of an academic year — one rule for report cards and
 * attendance, so a day is never in one semester for grades and in the other
 * for the register.
 */

/**
 * Semester date range for an academic year.
 *
 * The Indonesian school year runs July–June. Semester 1 (Ganjil) spans the
 * school-year start through Dec 31 of that calendar year; Semester 2 (Genap)
 * spans Jan 1 of the following calendar year through the school-year end.
 *
 * Both grade classification and attendance must use the SAME boundary so a
 * grade in early January is not counted in one semester while the attendance
 * for those same days is counted in the other.
 *
 * Exported for the unit tests that pin the Dec 31 "end of day" boundary.
 */
export function getSemesterDateRange(
  academicYear: { startDate: Date | string; endDate: Date | string },
  semester: number
): { startDate: Date; endDate: Date } {
  // Every caller that reaches here must pass exactly 1 or 2. The unified-raport
  // controller parses `semester` straight from the query string, so a value like
  // 99 used to fall through the `semester === 1 ? … : …` ternary and silently
  // produce a Semester 2 (Genap) raport that looked legitimate. Reject it here
  // so ALL entry points — individual, class bulk and unified — are covered by
  // the same boundary.
  if (semester !== 1 && semester !== 2) {
    throw new ApiError(ErrorCode.BAD_REQUEST, 'Semester harus bernilai 1 (Ganjil) atau 2 (Genap)');
  }
  const startDate = new Date(academicYear.startDate);
  const endDate = new Date(academicYear.endDate);
  // Anchor the boundary to the operation's timezone (WIB, UTC+7), not to the
  // server host. The exam/grade timestamps (`scheduledAt`/`gradedAt`) are
  // stored by Prisma as UTC DateTimes, and a school schedules them in WIB, so
  // the "Semester 2 starts Jan 1" rule is really "01 Jan 00:00 WIB". A distinct
  // Jan 1 *local-morning* exam (before 07:00 WIB) is stored as the *previous*
  // Dec 31 UTC evening; anchored at UTC midnight it would fall inside Semester 1.
  //
  // WIB = UTC+7, so "01 Jan 00:00 WIB" == "31 Dec 17:00 UTC". The boundary is
  // pinned with `Date.UTC` plus the constant WIB offset, which makes it
  // independent of whatever timezone this process happens to run in (on a UTC
  // host, anchoring naively at `Date.UTC(y, 11, 31, 23, 59, 59, 999)` reproduces
  // the bug above).
  //
  // End of day Dec 31 WIB (not midnight): a Dec 31-afternoon WIB exam must not
  // slip past the `<= semEndDate` check and be dropped from Semester 1. With the
  // WIB anchor, `sem1End` is the last millisecond of Dec 31 WIB and `sem2Start`
  // is the first millisecond of Jan 1 WIB, so the two windows never overlap.
  const WIB_UTC_OFFSET_HOURS = 7;
  const startYear = startDate.getUTCFullYear();
  // "01 Jan 00:00 of the next year" expressed in UTC, minus the 7h the
  // operational calendar is ahead of UTC.
  const sem2StartLocal = Date.UTC(startYear + 1, 0, 1); // 01 Jan 00:00 UTC
  const sem2Start = new Date(
    sem2StartLocal - WIB_UTC_OFFSET_HOURS * 60 * 60 * 1000 // 31 Dec 17:00 UTC
  );
  const sem1End = new Date(sem2Start.getTime() - 1); // last ms before sem2Start
  return semester === 1 ? { startDate, endDate: sem1End } : { startDate: sem2Start, endDate };
}

/**
 * The semester `at` falls in, and its first day as a WIB calendar day
 * (yyyy-MM-dd) — the form the attendance register stores its dates in.
 */
export function semesterAt(
  academicYear: { startDate: Date | string; endDate: Date | string },
  at: Date
): { semester: 1 | 2; startDay: string } {
  const semester = at <= getSemesterDateRange(academicYear, 1).endDate ? 1 : 2;
  const { startDate } = getSemesterDateRange(academicYear, semester);
  return { semester, startDay: wibDayOf(new Date(startDate)) };
}
