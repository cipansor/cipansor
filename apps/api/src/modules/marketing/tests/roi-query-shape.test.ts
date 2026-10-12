import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    payment: { findMany: vi.fn() },
  },
}));

import { prisma } from '@/lib/prisma';
import { getMonthlyAttributedRevenue } from '../roi.service';

const mocked = prisma as any;

/**
 * `getMonthlyAttributedRevenue` builds its `where` by hand, and its unit test
 * mocks Prisma — so a wrong relation name is invisible there. This test runs
 * the real argument through a real Prisma client's validator: Prisma rejects a
 * `where` that names a relation the schema does not have *before* it opens a
 * connection, so the invalid shape fails here even with no database.
 */
const validatingClient = new PrismaClient({
  adapter: new PrismaPg({ connectionString: 'postgresql://unused:unused@127.0.0.1:5999/unused' }),
});

beforeAll(() => {
  mocked.payment.findMany.mockImplementation(async (args: unknown) => {
    try {
      await validatingClient.payment.findMany(args as never);
    } catch (error) {
      // A valid query reaches the connection attempt and fails there (the host
      // above is not listening); a validation error never gets that far.
      if (error instanceof Prisma.PrismaClientValidationError) throw error;
    }
    return [];
  });
});

afterAll(async () => {
  await validatingClient.$disconnect();
});

describe('getMonthlyAttributedRevenue query shape', () => {
  beforeEach(() => vi.clearAllMocks());

  it('builds a where Prisma accepts (relation path exists in the schema)', async () => {
    await expect(getMonthlyAttributedRevenue('unit-1', 3)).resolves.toHaveLength(3);
    expect(mocked.payment.findMany).toHaveBeenCalledTimes(1);
  });
});
