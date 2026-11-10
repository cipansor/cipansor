import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    growthRecord: { findFirst: vi.fn(), delete: vi.fn() },
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

  it('deletes the record once the scope check finds it', async () => {
    mocked.growthRecord.findFirst.mockResolvedValue({ id: 'gr-1' });
    mocked.growthRecord.delete.mockResolvedValue({ id: 'gr-1' });

    await deleteGrowthRecord('gr-1', scope);

    // The scope rides the lookup, not the delete: a record outside it reads as
    // not found, never deleted.
    expect(mocked.growthRecord.findFirst).toHaveBeenCalledWith({
      where: { id: 'gr-1', student: { unitId: 'unit-1' } },
      select: { id: true },
    });
    expect(mocked.growthRecord.delete).toHaveBeenCalledWith({ where: { id: 'gr-1' } });
  });

  it('refuses a record outside the caller scope, and deletes nothing', async () => {
    mocked.growthRecord.findFirst.mockResolvedValue(null);

    await expect(deleteGrowthRecord('gr-2', scope)).rejects.toThrow(/not found/i);
    expect(mocked.growthRecord.delete).not.toHaveBeenCalled();
  });
});
