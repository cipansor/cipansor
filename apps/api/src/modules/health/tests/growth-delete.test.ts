import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    growthRecord: { deleteMany: vi.fn() },
  },
}));

import { prisma } from '@/lib/prisma';
import { deleteGrowthRecord } from '../health.service';

const mocked = prisma as unknown as {
  growthRecord: Record<string, ReturnType<typeof vi.fn>>;
};

/** A nurse of one unit: the scope keeps them to their own unit's santri. */
const scope = { unitId: 'unit-1' };

describe('deleteGrowthRecord', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes the record with the scope in the same statement', async () => {
    mocked.growthRecord.deleteMany.mockResolvedValue({ count: 1 });

    await expect(deleteGrowthRecord('gr-1', scope)).resolves.toEqual({ id: 'gr-1' });

    // The scope rides the delete itself, so a record outside it can never be
    // removed — not even if it leaves the caller's reach between a read and a
    // write (TOCTOU).
    expect(mocked.growthRecord.deleteMany).toHaveBeenCalledWith({
      where: { id: 'gr-1', student: { unitId: 'unit-1' } },
    });
  });

  it('refuses a record outside the caller scope, and deletes nothing', async () => {
    mocked.growthRecord.deleteMany.mockResolvedValue({ count: 0 });

    await expect(deleteGrowthRecord('gr-2', scope)).rejects.toThrow(/not found/i);
  });
});
