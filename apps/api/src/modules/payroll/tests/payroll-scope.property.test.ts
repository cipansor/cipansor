import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { BENDAHARA_ROLE_CODES } from '@cipansor/shared';

import { invoiceScope } from '@/modules/finance/finance.service';
import { listUnitFor } from '@/modules/payroll/payroll-access';

import { seesAllUnits } from '@/utils/resolve-unit-id';

// Property 14: Penyaringan unit Bendahara_Unit (R1.16, R29.9), #988 (PR-02)
// part: the finance list `where`. The payroll part is below (#990, PR-04).
//
// A Bendahara_Unit is a unit treasurer, not a foundation reader: their list
// `where` always carries the token's unit, whatever `unitId` the request names,
// so the request's own filter can never widen the result to another unit.

const UNITS = ['unit-a', 'unit-b', 'unit-c'] as const;

const bendaharaArb = fc.record({
  sub: fc.string({ minLength: 1 }),
  roleCode: fc.constantFrom(...BENDAHARA_ROLE_CODES),
  role: fc.constant('UNIT_ADMIN' as const),
  unitId: fc.constantFrom(...UNITS),
});

/** Evaluate the invoice `where` over an in-memory row. */
function invoiceMatches(
  where: ReturnType<typeof invoiceScope>,
  row: { paymentType: { unitId: string } }
): boolean {
  const filter = where.paymentType as { unitId?: string } | undefined;
  return !filter?.unitId || filter.unitId === row.paymentType.unitId;
}

describe('Property 14: Bendahara_Unit unit filtering', () => {
  it('a Bendahara_Unit list where always carries the token unit, whatever unitId the request names', () => {
    // Feature: web-api-reconnect-phase-2, Property 14: Penyaringan unit Bendahara_Unit
    fc.assert(
      fc.property(bendaharaArb, (actor) => {
        // No Bendahara_Unit is a foundation-scoped reader: their breadth is
        // never wider than their unit.
        expect(seesAllUnits(actor)).toBe(false);

        const where = invoiceScope(actor);
        expect(where).toEqual({ paymentType: { unitId: actor.unitId } });

        // Same result as a request that names no unit, and a request naming
        // another unit yields nothing from that other unit.
        const own = { paymentType: { unitId: actor.unitId! } };
        const other = { paymentType: { unitId: 'unit-other' } };
        expect(invoiceMatches(where, own)).toBe(true);
        expect(invoiceMatches(where, other)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('the payroll list `where` is pinned the same way (#990, R1.16)', () => {
    // Feature: web-api-reconnect-phase-2, Property 14: Penyaringan unit Bendahara_Unit
    fc.assert(
      fc.property(
        bendaharaArb,
        fc.option(fc.constantFrom(...UNITS), { nil: undefined }),
        (actor, named) => {
          // A treasurer is pinned to the token's unit; a request naming another
          // unit (or none) changes nothing.
          expect(listUnitFor(actor, named)).toBe(actor.unitId);
          // Every other reader is not pinned: the request may narrow, or ask for
          // every unit.
          const reader = { ...actor, roleCode: 'SUPER_ADMIN' as const };
          expect(listUnitFor(reader, named)).toBe(named);
          expect(listUnitFor(reader, 'all')).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('a treasurer without a unit reaches nothing rather than everything', () => {
    // The one case that must never widen: a token with no unit is refused, not
    // treated as "every unit".
    expect(() =>
      listUnitFor({ sub: 'u', roleCode: BENDAHARA_ROLE_CODES[0], unitId: null })
    ).toThrow(/tidak terikat pada unit/i);
  });
});
