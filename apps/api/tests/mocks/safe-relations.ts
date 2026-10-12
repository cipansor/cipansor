/**
 * The person relations a query loads, and any column beyond the safe ones.
 *
 * `include: { student }` or `include: { evaluator }` loads the whole row — a
 * santri's NIK and No. KK, a teacher's NIK, home address and salary account —
 * and a list that returns the record sends it. `STUDENT_SAFE_SELECT` and
 * `TEACHER_SAFE_SELECT` (src/utils/student-scope.ts) are the columns a list
 * may carry. Give this the arguments of every Prisma call a service made; it
 * names each relation loaded whole and each unsafe column, so an empty answer
 * is the pass.
 */

const SAFE_COLUMNS = new Set(['id', 'nis', 'nisn', 'nip', 'unitId', 'user', 'enrollments']);
const PEOPLE = ['student', 'partner', 'evaluator', 'teacher'];

type Args = { include?: Record<string, unknown>; select?: Record<string, unknown> } | undefined;

export function unsafeRelations(calls: unknown[][]): string[] {
  const problems: string[] = [];
  for (const [args] of calls as [Args][]) {
    for (const key of PEOPLE) {
      const rel = (args?.include?.[key] ?? args?.select?.[key]) as
        true | { select?: Record<string, unknown>; include?: unknown } | undefined;
      if (!rel) continue;
      if (rel === true || !rel.select) {
        problems.push(`${key}: the whole row`);
        continue;
      }
      for (const column of Object.keys(rel.select)) {
        if (!SAFE_COLUMNS.has(column)) problems.push(`${key}.${column}`);
      }
    }
  }
  return problems;
}

/** How many of the calls load a person relation at all — so a pass is not vacuous. */
export function relationsLoaded(calls: unknown[][]): number {
  return (calls as [Args][]).filter(([args]) =>
    PEOPLE.some((key) => args?.include?.[key] ?? args?.select?.[key])
  ).length;
}
