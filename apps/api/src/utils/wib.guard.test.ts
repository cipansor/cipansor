import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';

/**
 * One home for the WIB calendar (ticket #851, decision K7).
 *
 * `apps/api/src/utils/` used to hold two date modules, `wib.ts` and `wib-day.ts`,
 * and each named `dayOf` in the *opposite* direction: `wib.ts` took a
 * "yyyy-MM-dd" to a stored day, `wib-day.ts` took a stored day back to a string.
 * TypeScript caught most mis-imports, but a reader could not, and the pair kept
 * sprouting a third copy at the call site. They are one module now, and this
 * guard keeps it that way:
 *
 *  1. the module itself is the only place that names those conversions;
 *  2. `wib-day.ts` does not come back;
 *  3. a *new* file may not convert a WIB calendar day inline — the modules that
 *     still do are pinned in a baseline that may only shrink.
 */

const API = resolve(__dirname, '..', '..');
const WIB_MODULE = 'src/utils/wib.ts';

/** Every name the module owns. A local definition of one elsewhere is the
 * duplication this ticket removed, whatever the reason. */
const OWNED_NAMES = [
  'todayWib',
  'wibDayOf',
  'wibDay',
  'wibMonthYear',
  'wibMonthKey',
  'wibMonthStart',
  'wibDayStart',
  'wibDayEnd',
  'wibDayBound',
  'wibOverdueCutoff',
  'wibYearBounds',
  'wibMonthRange',
  'utcMonthRange',
  'wibDate',
  'dayOf',
  'dayDate',
  'dayString',
  'calendarDayOf',
  'calendarDate',
  'shiftWibDay',
  'wibWeekday',
  'wibWeekRange',
  'wibTimeOnDay',
  'wibMinutesOfDay',
];

function sourceFiles(root: string): string[] {
  const full = join(API, root);
  if (!existsSync(full)) return [];
  if (statSync(full).isFile()) return [full];
  const out: string[] = [];
  for (const name of readdirSync(full)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    out.push(...sourceFiles(join(root, name)));
  }
  return out.filter((f) => /\.ts$/.test(f) && !/\.test\.ts$/.test(f));
}

const read = (file: string) => readFileSync(file, 'utf8');

// A local `const`/`let`/`var`/`function` definition of an owned name — not an
// import, not a call. `export { dayOf } from …` (a re-export) is a definition
// too, which is what the deleted `wib-day.ts` became during the migration.
const localDefinition = (name: string) =>
  new RegExp(`(?:\\b(?:const|let|var|function)\\s+${name}\\b|\\bexport\\s*\\{[^}]*\\b${name}\\b)`);

/**
 * Inline WIB calendar conversion: a fixed +07:00 offset inside an ISO timestamp, a hand-written
 * `7 * 60 * 60 * 1000`, a `WIB_OFFSET` constant, or the `en-CA` day read.
 * `timeZone: 'Asia/Jakarta'` for *display* (`toLocaleString`) is not one — it
 * converts nothing — and neither is the cron `timezone: 'Asia/Jakarta'` option,
 * so those are deliberately outside the predicate (K7: the guard covers the
 * calendar conversion, not the string).
 */
const CONVERSION = [
  /\+\d{2}:\d{2}/, // a "+07:00" offset in a Date string
  /7\s*\*\s*60\s*\*\s*60\s*\*\s*1000/, // 7h in ms
  /\bWIB_OFFSET/, // a local offset constant
  /toLocaleDateString\(\s*'en-CA'/, // the day read `todayWib` wraps
];

const offendingLines = (file: string): string[] =>
  read(file)
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .filter((line) => CONVERSION.some((rx) => rx.test(line)));

/**
 * Files that still convert a WIB calendar day inline, measured 2026-11-12. The
 * ticket's criterion #4 lets them migrate only when next touched; this list may
 * only shrink — a new entry means a new copy, and an entry whose file no longer
 * offends must be removed (the guard fails on a stale one too). It is empty as
 * of 2026-11-12: every inline conversion the ticket found is now migrated. The
 * `timeZone: 'Asia/Jakarta'` *display* formatters are not conversions and are
 * not listed.
 */
const BASELINE: string[] = [];

describe('the WIB calendar has one home', () => {
  it.each(OWNED_NAMES)('no file outside %s defines %s itself', (name) => {
    const rx = localDefinition(name);
    const offenders = sourceFiles('src')
      .concat(sourceFiles('prisma'))
      .map((f) => relative(API, f))
      .filter((rel) => rel !== WIB_MODULE)
      .filter((rel) => rx.test(read(join(API, rel))));
    expect(offenders).toEqual([]);
  });

  it('the second date module does not come back', () => {
    expect(existsSync(join(API, 'src/utils/wib-day.ts'))).toBe(false);
    const importers = sourceFiles('src')
      .concat(sourceFiles('prisma'))
      .filter((f) => /utils\/wib-day['"]/.test(read(f)))
      .map((f) => relative(API, f));
    expect(importers).toEqual([]);
  });

  it('only the pinned files still convert a WIB day inline, and the list shrinks', () => {
    const roots = ['src', 'prisma'];
    const offenders = roots
      .flatMap((root) => sourceFiles(root))
      .map((f) => relative(API, f))
      .filter((rel) => rel !== WIB_MODULE)
      .filter((rel) => offendingLines(join(API, rel)).length > 0)
      .sort();

    const unexpected = offenders.filter((rel) => !BASELINE.includes(rel));
    expect(unexpected).toEqual([]);

    const stale = BASELINE.filter((rel) => !offenders.includes(rel));
    expect(stale).toEqual([]);
  });

  it('the predicate would catch the copy the ticket removed', () => {
    for (const line of [
      'const wibDay = (d: Date) => new Date(d.getTime() + WIB_OFFSET_MS);',
      'const start = new Date(`${day}T00:00:00+07:00`);',
      "const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });",
    ]) {
      expect(CONVERSION.some((rx) => rx.test(line))).toBe(true);
    }
    // …and leaves a display formatter and a cron schedule alone.
    for (const line of [
      "date.toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta' })",
      "cron.schedule('0 4 * * *', run, { timezone: 'Asia/Jakarta' })",
    ]) {
      expect(CONVERSION.some((rx) => rx.test(line))).toBe(false);
    }
  });
});
