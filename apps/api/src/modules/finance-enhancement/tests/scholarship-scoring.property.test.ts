import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  criterionKind,
  scoreCriteria,
  type ScorableCriterion,
  type ScoringFacts,
} from '../scholarship-scoring.service';
import { IncomeRange } from '@prisma/client';

// Feature: web-api-reconnect-phase-2, Property 20: Skor beasiswa
//
// For any list of criteria (name, weight, targetValue) and any santri data:
// every criterion score is within 0–100; the criterion family follows the name
// alone, case-insensitively; the total is the weighted mean of the criteria that
// were not excluded, `null` when all of them were, and marked incomplete when at
// least one was; and a second run over the same input gives the same answer.
//
// Validates R11.4, R11.5, R11.8, R11.12.

const HAFALAN_NAMES = ['Hafalan Al-Quran', 'TAHFIDZ', 'setoran hafalan'];
const AKADEMIK_NAMES = ['Nilai Akademik', 'nilai rata-rata', 'AKADEMIK'];
const PENGHASILAN_NAMES = ['Penghasilan Orang Tua', 'PENGHASILAN keluarga'];
const MANUAL_NAMES = ['Wawancara', 'Akhlak', 'Kehadiran'];

const INCOME_RANGES = Object.values(IncomeRange);

const criterionArb: fc.Arbitrary<ScorableCriterion> = fc.record({
  id: fc.uuid(),
  name: fc.oneof(
    fc.constantFrom(...HAFALAN_NAMES),
    fc.constantFrom(...AKADEMIK_NAMES),
    fc.constantFrom(...PENGHASILAN_NAMES),
    fc.constantFrom(...MANUAL_NAMES)
  ),
  weight: fc.double({ min: 0.1, max: 10, noNaN: true }),
  targetValue: fc.oneof(
    fc.constant(null),
    fc.constantFrom('5', '10', '30', '100', '85%'),
    fc.constant('abc') // a target that is not a number must not produce NaN
  ),
});

const factsArb: fc.Arbitrary<ScoringFacts> = fc.record({
  tahfidzJuz: fc.oneof(fc.constant(null), fc.integer({ min: 0, max: 30 })),
  averageGrade: fc.oneof(fc.constant(null), fc.double({ min: 0, max: 100, noNaN: true })),
  income: fc
    .record({
      known: fc.boolean(),
      bracket: fc.constantFrom(...INCOME_RANGES),
    })
    .map(({ known, bracket }) => ({
      // The scorer only reads `known` and `bracket`; the figures are irrelevant
      // to the properties under test.
      totalIdr: 0,
      bracket,
      known,
      knownEarners: known ? 1 : 0,
    })),
});

describe('Property 20: Skor beasiswa', () => {
  it('keeps every criterion score within 0–100 and every total a weighted mean of what it could read', () => {
    fc.assert(
      fc.property(fc.array(criterionArb, { maxLength: 8 }), factsArb, (criteria, facts) => {
        const result = scoreCriteria(criteria, facts);

        expect(result.criteria).toHaveLength(criteria.length);

        for (const c of result.criteria) {
          if (c.excluded) {
            expect(c.score).toBeNull();
          } else {
            expect(c.score).not.toBeNull();
            expect(Number.isNaN(c.score as number)).toBe(false);
            expect(c.score as number).toBeGreaterThanOrEqual(0);
            expect(c.score as number).toBeLessThanOrEqual(100);
          }
        }

        const counted = result.criteria.filter((c) => !c.excluded);
        const totalWeight = counted.reduce((sum, c) => sum + c.weight, 0);
        const weighted = counted.reduce((sum, c) => sum + (c.score as number) * c.weight, 0);

        if (counted.length === 0 || totalWeight === 0) {
          expect(result.totalScore).toBeNull();
        } else {
          expect(result.totalScore).toBeCloseTo(weighted / totalWeight, 10);
          expect(result.totalScore as number).toBeGreaterThanOrEqual(0);
          expect(result.totalScore as number).toBeLessThanOrEqual(100);
        }

        expect(result.complete).toBe(criteria.length === counted.length);
      }),
      { numRuns: 100 }
    );
  });

  it('follows the criterion name alone, ignoring case, to decide what it can read', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          ...HAFALAN_NAMES.map((n) => [n, 'HAFALAN'] as const),
          ...AKADEMIK_NAMES.map((n) => [n, 'AKADEMIK'] as const),
          ...PENGHASILAN_NAMES.map((n) => [n, 'PENGHASILAN'] as const),
          ...MANUAL_NAMES.map((n) => [n, 'MANUAL'] as const)
        ),
        ([name, kind]) => {
          expect(criterionKind(name)).toBe(kind);
          expect(criterionKind(name.toUpperCase())).toBe(kind);
          expect(criterionKind(name.toLowerCase())).toBe(kind);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('gives the same answer for the same input, twice', () => {
    fc.assert(
      fc.property(fc.array(criterionArb, { maxLength: 8 }), factsArb, (criteria, facts) => {
        expect(scoreCriteria(criteria, facts)).toEqual(scoreCriteria(criteria, facts));
      }),
      { numRuns: 100 }
    );
  });

  it('excludes a criterion with no data for it, and says so in the value', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...HAFALAN_NAMES, ...AKADEMIK_NAMES, ...PENGHASILAN_NAMES),
        (name) => {
          const facts: ScoringFacts = {
            tahfidzJuz: null,
            averageGrade: null,
            income: {
              totalIdr: 0,
              bracket: IncomeRange.TIDAK_BERPENGHASILAN,
              known: false,
              knownEarners: 0,
            },
          };
          const result = scoreCriteria([{ id: 'c1', name, weight: 1, targetValue: '10' }], facts);

          expect(result.criteria[0].excluded).toBe(true);
          expect(result.criteria[0].value).toMatch(/^(NO_DATA|UNKNOWN)$/);
          expect(result.totalScore).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });
});
