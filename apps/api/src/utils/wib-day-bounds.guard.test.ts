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
 * bounds come from `utils/wib.ts` / `utils/wib-day.ts`.
 *
 * This guard does not forbid the pattern everywhere — plenty of other modules
 * still shift an instant that way. It pins the dashboard module, where the bug
 * lived, so the same defect cannot walk back in unnoticed.
 */

const API = resolve(__dirname, '..', '..');

/** The files whose day bounds must be WIB: the dashboard module and its metrics. */
const GUARDED = ['src/modules/dashboard', 'src/lib/dashboard-metrics.ts'];

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

const codeLines = (file: string) =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line));

describe('the dashboard bounds its day in WIB, not in the server clock', () => {
  it.each(GUARDED)('%s builds no day bound with a local setHours(0,0,0,0)', (path) => {
    const offenders = sourceFiles(path)
      .filter((file) => codeLines(file).some((line) => LOCAL_MIDNIGHT.test(line)))
      .map((file) => relative(API, file));

    expect(offenders).toEqual([]);
  });

  it('still has the WIB day helpers it should bound with', () => {
    for (const path of GUARDED) {
      const text = sourceFiles(path)
        .map((f) => readFileSync(f, 'utf8'))
        .join('\n');
      expect(text).toMatch(/from '@\/utils\/wib(-day)?'/);
    }
  });
});
