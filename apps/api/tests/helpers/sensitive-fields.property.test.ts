import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { SENSITIVE_STUDENT_FIELDS, expectNoSensitiveStudentFields } from './sensitive-fields';

// Property 48 (R24.7): the helper accepts a response built from the safe
// columns, and rejects one that carries any sensitive santri column at any
// depth. The helper is what every later phase-2 contract test leans on, so it
// is checked directly.

const safeStudentArb = fc.record({
  id: fc.uuid(),
  nis: fc.string(),
  nisn: fc.string(),
  unitId: fc.uuid(),
  user: fc.record({ id: fc.uuid(), name: fc.string() }),
});

describe('Property 48: no sensitive santri fields', () => {
  it('accepts a response of safe columns, at any nesting', () => {
    // Feature: web-api-reconnect-phase-2, Property 48: Tanpa kolom sensitif
    fc.assert(
      fc.property(fc.array(safeStudentArb), (students) => {
        expect(() =>
          expectNoSensitiveStudentFields({ data: students, meta: { total: students.length } })
        ).not.toThrow();
      }),
      { numRuns: 100 }
    );
  });

  it('rejects a response that carries a sensitive column at any depth', () => {
    // Feature: web-api-reconnect-phase-2, Property 48: Tanpa kolom sensitif
    fc.assert(
      fc.property(
        safeStudentArb,
        fc.constantFrom(...SENSITIVE_STUDENT_FIELDS),
        fc.constantFrom('top', 'nested', 'list'),
        (student, field, where) => {
          const value = { [field]: 'x' };
          const response =
            where === 'top'
              ? { ...student, ...value }
              : where === 'nested'
                ? { student: { ...student, ...value } }
                : { data: [{ ...student, ...value }] };
          expect(() => expectNoSensitiveStudentFields(response)).toThrow();
        }
      ),
      { numRuns: 100 }
    );
  });
});
