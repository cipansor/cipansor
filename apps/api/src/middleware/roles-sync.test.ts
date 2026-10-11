import { describe, it, expect } from 'vitest';
import { RoleCode } from '@prisma/client';
import {
  ALL_ROLE_CODES,
  LEGACY_ROLE_EXPANSION,
  LETTER_RETENTION_ROLE_CODES,
  LETTER_UNIT_SCOPE_ROLES,
  ROLE_CODE_TO_LEGACY,
  mayReviewLetterRetention,
} from '@cipansor/shared';
import { FOUNDATION_SCOPE_ROLES } from '@/utils/resolve-unit-id';

// The shared role groups (packages/shared/src/roles.ts) are plain strings —
// shared cannot import @prisma/client. This test is the contract that keeps
// them in exact sync with the database enum.
describe('shared role codes stay in sync with the Prisma RoleCode enum', () => {
  const prismaCodes = Object.values(RoleCode) as string[];

  it('every shared role code exists in the Prisma enum', () => {
    const unknown = ALL_ROLE_CODES.filter((c) => !prismaCodes.includes(c));
    expect(unknown).toEqual([]);
  });

  it('every Prisma role code is covered by a shared group', () => {
    const missing = prismaCodes.filter((c) => !ALL_ROLE_CODES.includes(c));
    expect(missing).toEqual([]);
  });

  it('has no duplicate codes across groups', () => {
    const dupes = ALL_ROLE_CODES.filter((c, i) => ALL_ROLE_CODES.indexOf(c) !== i);
    expect(dupes).toEqual([]);
  });

  it('legacy expansion only references real role codes', () => {
    for (const codes of Object.values(LEGACY_ROLE_EXPANSION)) {
      const unknown = codes.filter((c) => !prismaCodes.includes(c));
      expect(unknown).toEqual([]);
    }
  });

  it('wakasek and wali kelas are duties of a guru, not role codes (2026-09-26)', () => {
    // Wali kelas is Class.homeroomTeacherId. A role code for a duty drifts from
    // the relation it names: the seed once had a "Wali Kelas" account that was
    // wali kelas of no class, and a "Guru" account that was.
    expect(prismaCodes.filter((c) => /_WAKASEK$|_WALI_KELAS$/.test(c))).toEqual([]);
  });

  it('komite and alumni codes intentionally map to no legacy bucket', () => {
    for (const code of prismaCodes.filter((c) => c.endsWith('_KOMITE') || c.endsWith('_ALUMNI'))) {
      expect(ROLE_CODE_TO_LEGACY[code]).toBeUndefined();
    }
  });

  /**
   * `LETTER_RETENTION_ROLE_CODES` (shared) and the API's retention guard must
   * name the same set.
   *
   * The E-Office home shows the retention card from the shared list; the
   * controller refuses the endpoint from `choosesUnit(actor) ||
   * handlesUnitCorrespondence(actor)`. Those are two expressions of one rule —
   * `LETTER_UNIT_SCOPE_ROLES` plus the foundation roles that may choose a unit —
   * and the failure mode when they drift is a card that opens a 403, which is
   * exactly what shipped while the card checked only `unitId`. Pin them equal,
   * both directions.
   */
  it('the shared retention allowlist equals the API retention guard set', () => {
    const expected = [...LETTER_UNIT_SCOPE_ROLES, ...FOUNDATION_SCOPE_ROLES];
    expect([...LETTER_RETENTION_ROLE_CODES].sort()).toEqual([...expected].sort());
    // ... and the helper reads that list, not a private copy.
    for (const code of LETTER_RETENTION_ROLE_CODES) {
      expect(mayReviewLetterRetention(code)).toBe(true);
    }
    expect(mayReviewLetterRetention('SMPIT_SISWA')).toBe(false);
    expect(mayReviewLetterRetention(null)).toBe(false);
  });
});
