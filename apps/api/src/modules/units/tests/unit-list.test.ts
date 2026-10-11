import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Which units an account's unit pickers offer. The pesantren's staff serve
 * santri of every school, and their forms ask for the santri's unit first: a
 * list holding only their own unit — the pesantren — left them no school to
 * pick. A school's staff are offered their school.
 */

vi.mock('@/lib/prisma', () => ({
  prisma: { unit: { findMany: vi.fn(), count: vi.fn() } },
}));

import { prisma } from '@/lib/prisma';
import { unitService } from '../unit.service';

const db = prisma as unknown as {
  unit: { findMany: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> };
};

const SMP = '11111111-1111-4111-8111-111111111111';
const PESANTREN = '33333333-3333-4333-8333-333333333333';

async function whereFor(role: string, roleCode: string, unitId: string | null) {
  await unitService.findAll({ page: 1, limit: 100 } as never, { role, roleCode, unitId });
  return db.unit.findMany.mock.calls[0][0].where;
}

beforeEach(() => {
  vi.clearAllMocks();
  db.unit.findMany.mockResolvedValue([]);
  db.unit.count.mockResolvedValue(0);
});

describe('the unit list', () => {
  it('offers every unit to the musyrif, the ustadz and the muhafidz', async () => {
    for (const code of ['MUSYRIF', 'USTADZ', 'MUHAFIDZ', 'PESANTREN_PENGASUH']) {
      vi.clearAllMocks();
      db.unit.findMany.mockResolvedValue([]);
      db.unit.count.mockResolvedValue(0);
      expect(await whereFor('TEACHER', code, PESANTREN)).toEqual({ deletedAt: null });
    }
  });

  it("offers a school's teacher their own unit only", async () => {
    expect(await whereFor('TEACHER', 'SMPIT_GURU', SMP)).toEqual({ deletedAt: null, id: SMP });
  });
});
