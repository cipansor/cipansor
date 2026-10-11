/**
 * Santri of two schools and the people who reach them, for tests of the
 * one rule about which santri an account sees (`studentScope`,
 * src/utils/student-scope.ts).
 *
 * `findStudentLike` answers `prisma.student.findFirst` the way Postgres would
 * for the `where` shapes that rule produces — `{}`, `{ unitId }`,
 * `{ userId }`, `{ parents: { some: { parentId } } }`, `{ id: { in: [] } }`,
 * combined with `AND` — so a test measures the rule, not the call's shape.
 */

export const SMP = '11111111-1111-4111-8111-111111111111';
export const SMA = '22222222-2222-4222-8222-222222222222';
export const PESANTREN = '33333333-3333-4333-8333-333333333333';

export const SANTRI_SMP = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  unitId: SMP,
  userId: 'u-santri-smp',
  parentIds: ['u-wali-smp'],
  deletedAt: null,
};
export const SANTRI_SMA = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  unitId: SMA,
  userId: 'u-santri-sma',
  parentIds: ['u-wali-sma'],
  deletedAt: null,
};
const SANTRI = [SANTRI_SMP, SANTRI_SMA];

/** Who asks. The pesantren's staff are pinned to the pesantren unit. */
export const ACTORS = {
  ustadz: { sub: 'u-ustadz', role: 'TEACHER', roleCode: 'USTADZ', unitId: PESANTREN },
  musyrif: { sub: 'u-musyrif', role: 'TEACHER', roleCode: 'MUSYRIF', unitId: PESANTREN },
  muhafidz: { sub: 'u-muhafidz', role: 'TEACHER', roleCode: 'MUHAFIDZ', unitId: PESANTREN },
  guruSmp: { sub: 'u-guru-smp', role: 'TEACHER', roleCode: 'SMPIT_GURU', unitId: SMP },
  santriSmp: { sub: 'u-santri-smp', role: 'STUDENT', roleCode: 'SMPIT_SISWA', unitId: SMP },
  waliSmp: { sub: 'u-wali-smp', role: 'PARENT', roleCode: 'SMPIT_ORANG_TUA', unitId: SMP },
  waliSma: { sub: 'u-wali-sma', role: 'PARENT', roleCode: 'SMAQ_ORANG_TUA', unitId: SMA },
};

type Where = Record<string, unknown>;

/** A santri as the rule reads one. */
export interface SantriLike {
  id: string;
  unitId: string;
  userId: string;
  parentIds: string[];
  deletedAt: null;
}

/** Whether `where` (a `StudentWhereInput` of the shapes above) matches `s`. */
export function studentMatches(s: SantriLike, where: Where | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, value]) => {
    const v = value as Where | string | null | undefined;
    switch (key) {
      case 'AND':
        return (value as Where[]).every((w) => studentMatches(s, w));
      case 'id':
        if (v && typeof v === 'object' && Array.isArray((v as Where).in)) {
          return ((v as Where).in as string[]).includes(s.id);
        }
        return s.id === v;
      case 'unitId':
        return s.unitId === v;
      case 'userId':
        return s.userId === v;
      case 'deletedAt':
        return s.deletedAt === v;
      case 'parents': {
        const parentId = ((v as Where).some as Where).parentId as string;
        return s.parentIds.includes(parentId);
      }
      default:
        throw new Error(`santri-fixture: no rule for where.${key}`);
    }
  });
}

/** `prisma.student.findFirst`, over the fixture. */
export async function findStudentLike(args: { where?: Where }) {
  const found = SANTRI.find((s) => studentMatches(s, args.where));
  return found ? { id: found.id, unitId: found.unitId } : null;
}
