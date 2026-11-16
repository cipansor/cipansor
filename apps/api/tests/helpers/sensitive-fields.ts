import { expect } from 'vitest';

/**
 * The santri columns an API response must never carry (R24.7). `include:
 * { student }` sends them all — NIK, No. KK, the parents' NIK and income —
 * which is how the grade, attendance and tahfidz lists once leaked them. A
 * response that names a santri carries only what the screen needs.
 *
 * `IncomeRange` on a scholarship is the one exception: the income *band*, not
 * the figure, is what a scholarship decision reads.
 */
export const SENSITIVE_STUDENT_FIELDS = [
  'nik',
  'noKK',
  'fatherNik',
  'motherNik',
  'guardianNik',
  'fatherIncome',
  'motherIncome',
  'guardianIncome',
] as const;

/**
 * Asserts that no object reachable from `value` carries a sensitive santri
 * field. Used by every phase-2 contract test that reads santri data.
 */
export function expectNoSensitiveStudentFields(value: unknown): void {
  const found: string[] = [];
  const walk = (node: unknown, path: string) => {
    if (Array.isArray(node)) {
      node.forEach((child, i) => walk(child, `${path}[${i}]`));
      return;
    }
    if (node && typeof node === 'object') {
      for (const [key, child] of Object.entries(node)) {
        if ((SENSITIVE_STUDENT_FIELDS as readonly string[]).includes(key)) {
          found.push(`${path}.${key}`);
        }
        walk(child, `${path}.${key}`);
      }
    }
  };
  walk(value, '$');
  expect(found, `sensitive santri fields present: ${found.join(', ')}`).toEqual([]);
}
