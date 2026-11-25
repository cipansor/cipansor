import { describe, it, expect } from 'vitest';
import { RoleCode } from '@prisma/client';
import {
  FOUNDATION_SCOPE_ROLES,
  CROSS_UNIT_SCOPE_ROLES,
  actorSeesUnit,
  isFoundationScopedRole,
  seesAllUnits,
  tokenUnitId,
} from './resolve-unit-id';

/**
 * These lists decide who a unit-scoped `where` clause is widened for. A wrong
 * entry does not throw — it silently hides rows from someone who should see
 * them, or reveals rows to someone who should not — so the behaviour they
 * encode is pinned here rather than trusted to review.
 *
 * The regression that prompted this: services scoped with
 * `where.unitId = user.unitId || 'none'` and branched on the LEGACY `role`.
 * deriveLegacyRole() maps every YAYASAN_* code onto 'UNIT_ADMIN', so the
 * foundation board (which has no unitId) fell through to `'none'` and saw an
 * empty list, while boarding/shared-service staff — seeded into one unit —
 * saw only that unit's slice of santri who actually span several.
 */
describe('seesAllUnits', () => {
  it('is true for the whole yayasan board', () => {
    for (const roleCode of [
      RoleCode.YAYASAN_PEMBINA,
      RoleCode.YAYASAN_KETUA,
      RoleCode.YAYASAN_SEKRETARIS,
      RoleCode.YAYASAN_BENDAHARA,
      RoleCode.YAYASAN_ANGGOTA,
      RoleCode.YAYASAN_PENGAWAS,
    ]) {
      // No unitId at all — this is exactly the shape that used to resolve to
      // 'none'. The legacy role is deliberately the misleading 'UNIT_ADMIN'
      // that deriveLegacyRole() produces, to prove the decision ignores it.
      expect(seesAllUnits({ roleCode, role: 'UNIT_ADMIN' }), roleCode).toBe(true);
    }
  });

  it('is true for boarding and shared-service staff', () => {
    for (const roleCode of [
      RoleCode.MUHAFIDZ,
      RoleCode.MUSYRIF,
      RoleCode.PESANTREN_PENGASUH,
      RoleCode.PERAWAT,
      RoleCode.PUSTAKAWAN,
      RoleCode.LABORAN,
      RoleCode.KEAMANAN,
    ]) {
      // Seeded into SMP IT but serve every unit; breadth is decided from the
      // role, so the caller's unitId never narrows them.
      expect(seesAllUnits({ roleCode, role: 'UNIT_ADMIN' }), roleCode).toBe(true);
    }
  });

  it('is true for SUPER_ADMIN even when only the legacy role is known', () => {
    // Some callers predate roleCode and pass `role` alone; SUPER_ADMIN must
    // still be recognised so a global admin is never scoped to one unit.
    expect(seesAllUnits({ role: RoleCode.SUPER_ADMIN })).toBe(true);
    expect(seesAllUnits({ roleCode: RoleCode.SUPER_ADMIN, role: 'SUPER_ADMIN' })).toBe(true);
  });

  it('is false for a genuine single-unit administrator', () => {
    // A unit admin sees its own unit and no other. Its legacy role is also
    // 'UNIT_ADMIN' — the same string the yayasan board maps to — so this is the
    // case that proves the decision is made on roleCode, not on the legacy
    // role. If this ever returned true the fix would have widened everyone.
    expect(seesAllUnits({ roleCode: RoleCode.SMPIT_ADMIN, role: 'UNIT_ADMIN' })).toBe(false);
  });

  it('is false for a classroom teacher', () => {
    // A unit teacher, not to be confused with USTADZ, which is a
    // pesantren-wide teaching role and is deliberately cross-unit.
    expect(seesAllUnits({ roleCode: RoleCode.SMPIT_GURU, role: 'TEACHER' })).toBe(false);
  });

  it('is false when neither roleCode nor a SUPER_ADMIN legacy role is present', () => {
    expect(seesAllUnits({})).toBe(false);
    expect(seesAllUnits({ roleCode: null, role: null })).toBe(false);
  });
});

describe('actorSeesUnit', () => {
  const unitAdmin = { roleCode: RoleCode.SMPIT_ADMIN, unitId: 'unit-smp' };

  it('refuses a unit admin a row with no unit or another unit', () => {
    expect(actorSeesUnit(unitAdmin, null)).toBe(false);
    expect(actorSeesUnit(unitAdmin, 'unit-sd')).toBe(false);
    expect(actorSeesUnit(unitAdmin, 'unit-smp')).toBe(true);
  });

  it('keeps a Super Admin able to reach a row with no unit', () => {
    expect(actorSeesUnit({ roleCode: RoleCode.SUPER_ADMIN, unitId: null }, null)).toBe(true);
  });
});

describe('scope role lists', () => {
  it('every RoleCode in the lists is a real enum member', () => {
    // A rename in the schema that missed these arrays would otherwise scope on
    // a string that matches nobody.
    const members = new Set<string>(Object.values(RoleCode));
    for (const code of [...FOUNDATION_SCOPE_ROLES, ...CROSS_UNIT_SCOPE_ROLES]) {
      expect(members.has(code), code).toBe(true);
    }
  });

  it('foundation and cross-unit lists do not overlap', () => {
    // They grant the same breadth by different reasoning; an entry in both is a
    // copy-paste slip worth catching, not a real dual membership.
    const foundation = new Set<string>(FOUNDATION_SCOPE_ROLES);
    for (const code of CROSS_UNIT_SCOPE_ROLES) {
      expect(foundation.has(code), code).toBe(false);
    }
  });

  it('isFoundationScopedRole matches the list and rejects unknowns', () => {
    expect(isFoundationScopedRole(RoleCode.YAYASAN_KETUA)).toBe(true);
    expect(isFoundationScopedRole(RoleCode.SMPIT_ADMIN)).toBe(false);
    expect(isFoundationScopedRole(null)).toBe(false);
    expect(isFoundationScopedRole(undefined)).toBe(false);
  });
});

describe('tokenUnitId — one scope rule for every token path', () => {
  it('uses the assignment unit whenever the assignment names one', () => {
    expect(tokenUnitId('unit-smp', 'YAYASAN_KETUA', 'unit-sd')).toBe('unit-smp');
    expect(tokenUnitId('unit-smp', 'SDIT_GURU', 'unit-sd')).toBe('unit-smp');
  });

  it('lets only a foundation role carry no unit', () => {
    expect(tokenUnitId(null, 'YAYASAN_KETUA', 'unit-sd')).toBeNull();
    expect(tokenUnitId(null, 'YAYASAN_PENGAWAS', 'unit-sd')).toBeNull();
    expect(tokenUnitId(undefined, 'SUPER_ADMIN', null)).toBeNull();
  });

  it('keeps cross-unit service roles on their home unit — breadth comes from seesAllUnits, not an empty scope', () => {
    expect(tokenUnitId(null, 'PERAWAT', 'unit-smp')).toBe('unit-smp');
    expect(tokenUnitId(null, 'PESANTREN_PENGASUH', 'unit-smp')).toBe('unit-smp');
  });

  it('falls back to the home unit for a unit role, and to null only when there is none', () => {
    expect(tokenUnitId(null, 'SDIT_GURU', 'unit-sd')).toBe('unit-sd');
    expect(tokenUnitId(null, 'SDIT_GURU', null)).toBeNull();
    expect(tokenUnitId(null, undefined, 'unit-sd')).toBe('unit-sd');
  });
});
