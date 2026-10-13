import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ACTORS, SMP } from '../../../../tests/mocks/santri-fixture';

/**
 * Whose sanad records a list shows. The muhafidz certifies santri of every
 * school while their own unit is the pesantren; a school's staff see their
 * school's. And a filter for one santri or one halaqoh is kept: the unit
 * filter used to replace it, so asking for one santri returned the unit's.
 */

vi.mock('@/lib/prisma', () => ({
  prisma: { sanadRecord: { findMany: vi.fn(), count: vi.fn() } },
}));

import { prisma } from '@/lib/prisma';
import { findAllSanadRecords } from '../sanad-certificate.service';

const db = prisma as unknown as {
  sanadRecord: { findMany: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> };
};

const contextOf = (a: (typeof ACTORS)[keyof typeof ACTORS]) => ({
  role: a.role,
  roleCode: a.roleCode,
  unitId: a.unitId,
  userId: a.sub,
});

async function whereFor(
  actor: (typeof ACTORS)[keyof typeof ACTORS],
  query: Record<string, unknown> = {}
) {
  await findAllSanadRecords({ page: 1, limit: 20, ...query } as never, contextOf(actor));
  return db.sanadRecord.findMany.mock.calls[0][0].where;
}

beforeEach(() => {
  vi.clearAllMocks();
  db.sanadRecord.findMany.mockResolvedValue([]);
  db.sanadRecord.count.mockResolvedValue(0);
});

describe('the sanad list', () => {
  it("spans every school's santri for the muhafidz", async () => {
    expect(await whereFor(ACTORS.muhafidz)).toEqual({});
  });

  it("keeps one santri's filter beside a school teacher's unit", async () => {
    expect(await whereFor(ACTORS.guruSmp, { studentId: 's1' })).toEqual({
      enrollment: { studentId: 's1', student: { unitId: SMP } },
    });
  });

  it('keeps a halaqoh filter for the muhafidz too', async () => {
    expect(await whereFor(ACTORS.muhafidz, { halaqohId: 'h1' })).toEqual({
      enrollment: { halaqohId: 'h1' },
    });
  });
});
