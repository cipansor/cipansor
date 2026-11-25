import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';

/**
 * Every "hari ini" bound in the dashboard is a WIB calendar day (ticket #857).
 *
 * A bound built with `new Date().setHours(0, 0, 0, 0)` is midnight *local* —
 * on the UTC container, midnight UTC, which is the day before WIB between
 * 00:00 and 06:59 WIB. The dashboard reads `Attendance.date` (`@db.Date`,
 * filled with the WIB day) and `TahfidzRecord.recordedAt` (`DateTime`), so its
 * bounds come from `utils/wib.ts`. The analytics module
 * builds the same "hari ini" bounds (`getDashboardStats`) and labels the parent
 * activity chart by day (`getParentEngagement`), so it is pinned too (#978).
 * The calendar's `getToday` and the enhancement dashboard's quick stats were
 * the last two readers of the UTC day, so both modules are pinned as well
 * (#1152).
 *
 * A second, related defect: a *month* bucket built with
 * `new Date(x.getFullYear(), x.getMonth() + i, …)` is the server's month, which
 * on a UTC container is still the previous month between 00:00 and 06:59 WIB
 * on the 1st — the finance cash-flow forecast labelled its first bucket with
 * the month that had just ended and dropped the last requested month (#1149).
 * `MONTH_GUARDED` pins the modules whose month arithmetic must come from
 * `wibMonthYear`/`wibMonthRange`.
 *
 * This guard does not forbid the pattern everywhere — plenty of other modules
 * still shift an instant that way. It pins the modules where the bug lived, so
 * the same defect cannot walk back in unnoticed.
 */

const API = resolve(__dirname, '..', '..');

/** The files whose day bounds must be WIB: the dashboard module and its metrics,
 * the analytics module (dashboard card + parent activity chart), the calendar's
 * "today" reader, and the enhancement dashboard's quick stats. */
const GUARDED = [
  'src/modules/dashboard',
  'src/lib/dashboard-metrics.ts',
  'src/modules/analytics',
  'src/modules/calendar',
  'src/modules/dashboard-enhancement',
];

/** The files whose month buckets must be WIB: the finance cash-flow forecast. */
const MONTH_GUARDED = ['src/modules/finance-enhancement'];

function sourceFiles(path: string): string[] {
  const full = join(API, path);
  if (statSync(full).isFile()) return [full];
  const out: string[] = [];
  for (const name of readdirSync(full)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    out.push(...sourceFiles(join(path, name)));
  }
  return out.filter((f) => /\.ts$/.test(f) && !/\.test\.ts$/.test(f));
}

// `setHours(0, 0, 0, 0)` and its spaceless form, but not a `setHours` with a
// real time (`setHours(7, 0)`) and not the mention inside a comment.
const LOCAL_MIDNIGHT = /\.setHours\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/;

// A calendar month read off the server clock: `new Date(x.getFullYear(),
// x.getMonth() + …)`. The year/month pair is what makes it local — a
// `new Date(Date.UTC(...))` is not matched.
const LOCAL_MONTH = /new\s+Date\(\s*[\w.$]+\.getFullYear\(\)\s*,\s*[\w.$]+\.getMonth\(\)/;

// Scan the file as one code text, not line by line: a constructor split across
// lines (`new Date(\n  now.getFullYear(),\n  now.getMonth() + i,\n  1\n)`) is
// the same defect, and a per-line scan silently missed it.
const codeText = (file: string) =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

/** Every named import list pulled from `@/utils/wib` in a file. `[^}]` spans
 * newlines, so a multi-line import is read as one statement. */
function wibImports(text: string): string {
  const names: string[] = [];
  const re = /import\s*\{([^}]*)\}\s*from\s*'@\/utils\/wib(?:-day)?'/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) names.push(match[1]);
  return names.join(',');
}

describe('the dashboard bounds its day in WIB, not in the server clock', () => {
  it.each(GUARDED)('%s builds no day bound with a local setHours(0,0,0,0)', (path) => {
    const offenders = sourceFiles(path)
      .filter((file) => LOCAL_MIDNIGHT.test(codeText(file)))
      .map((file) => relative(API, file));

    expect(offenders).toEqual([]);
  });

  it.each(MONTH_GUARDED)('%s buckets no month with the server clock', (path) => {
    const offenders = sourceFiles(path)
      .filter((file) => LOCAL_MONTH.test(codeText(file)))
      .map((file) => relative(API, file));

    expect(offenders).toEqual([]);
  });

  it('still has the WIB day helpers it should bound with', () => {
    for (const path of GUARDED) {
      const text = sourceFiles(path)
        .map((f) => readFileSync(f, 'utf8'))
        .join('\n');
      expect(wibImports(text)).not.toBe('');
    }
  });

  it('still has the WIB month helpers it should bucket with', () => {
    for (const path of MONTH_GUARDED) {
      const text = sourceFiles(path)
        .map((f) => readFileSync(f, 'utf8'))
        .join('\n');
      // Importing any WIB helper is not enough: a file that kept `wibDayOf`
      // but dropped `wibMonthYear`/`wibMonthRange` would pass a bare import
      // check while the month arithmetic no longer has a WIB helper.
      expect(wibImports(text)).toMatch(/\bwibMonth(?:Year|Range)\b/);
    }
  });

  it('does not accept a day-only import in place of the month helpers', () => {
    expect(wibImports("import { wibDayOf } from '@/utils/wib';")).not.toMatch(
      /\bwibMonth(?:Year|Range)\b/
    );
    expect(wibImports("import { wibMonthYear, wibMonthRange } from '@/utils/wib';")).toMatch(
      /\bwibMonth(?:Year|Range)\b/
    );
  });

  it('the month predicate catches the copy the ticket removed, and spares a UTC month', () => {
    expect(
      LOCAL_MONTH.test('const monthDate = new Date(now.getFullYear(), now.getMonth() + i, 1);')
    ).toBe(true);
    expect(
      LOCAL_MONTH.test('const endDate = new Date(now.getFullYear(), now.getMonth() + months, 0);')
    ).toBe(true);
    // The same constructor split across lines is still the server's month.
    expect(
      LOCAL_MONTH.test(
        'const monthDate = new Date(\n  now.getFullYear(),\n  now.getMonth() + i,\n  1\n);'
      )
    ).toBe(true);
    // A month built on the UTC calendar is not the server's month.
    expect(LOCAL_MONTH.test('new Date(Date.UTC(year, month, 1))')).toBe(false);
  });
});
