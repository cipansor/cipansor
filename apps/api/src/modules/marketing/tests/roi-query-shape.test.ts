import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    marketingCampaign: { findMany: vi.fn() },
    registrant: { groupBy: vi.fn(), findMany: vi.fn() },
    invoice: { findMany: vi.fn() },
    payment: { findMany: vi.fn() },
  },
}));

import { prisma } from '@/lib/prisma';
import { calculateCampaignROI, getMonthlyAttributedRevenue } from '../roi.service';

const mocked = prisma as any;

/**
 * Both functions build their `where` by hand, and their unit tests mock Prisma —
 * so a wrong relation name is invisible there. This test runs the real
 * arguments through a real Prisma client's validator: Prisma rejects a `where`
 * that names a relation the schema does not have *before* it opens a
 * connection, so the invalid shape fails here even with no database.
 *
 * Regression guard for #755: `calculateCampaignROI` used to query
 * `(prisma.invoice as any).findMany({ where: { registrant } }).catch(() => [])`,
 * a relation `Invoice` does not have, silently yielding zero revenue.
 */
const validatingClient = new PrismaClient({
  adapter: new PrismaPg({ connectionString: 'postgresql://unused:unused@127.0.0.1:5999/unused' }),
});

/** Pass real args to the real validator; only a schema-valid query reaches the connection attempt. */
function validate<T extends (...args: never[]) => unknown>(fn: T) {
  return async (args: unknown) => {
    try {
      await fn(args as never);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) throw error;
    }
    return [];
  };
}

beforeAll(() => {
  mocked.marketingCampaign.findMany.mockResolvedValue([
    { id: 'c1', name: 'Ads', code: 'A1', budget: 100, _count: { registrants: 1 } },
  ]);
  mocked.registrant.groupBy.mockResolvedValue([]);
  mocked.invoice.findMany.mockImplementation(
    validate(validatingClient.invoice.findMany.bind(validatingClient))
  );
  mocked.registrant.findMany.mockImplementation(
    validate(validatingClient.registrant.findMany.bind(validatingClient))
  );
  mocked.payment.findMany.mockImplementation(
    validate(validatingClient.payment.findMany.bind(validatingClient))
  );
});

afterAll(async () => {
  await validatingClient.$disconnect();
});

describe('calculateCampaignROI query shape', () => {
  beforeEach(() => vi.clearAllMocks());

  it('builds a where Prisma accepts for both revenue sources', async () => {
    await expect(calculateCampaignROI('unit-1')).resolves.toHaveLength(1);
    expect(mocked.invoice.findMany).toHaveBeenCalledTimes(1);
    expect(mocked.registrant.findMany).toHaveBeenCalledTimes(1);
  });
});

describe('getMonthlyAttributedRevenue query shape', () => {
  beforeEach(() => vi.clearAllMocks());

  it('builds a where Prisma accepts (relation path exists in the schema)', async () => {
    await expect(getMonthlyAttributedRevenue('unit-1', 3)).resolves.toHaveLength(3);
    expect(mocked.payment.findMany).toHaveBeenCalledTimes(1);
    expect(mocked.registrant.findMany).toHaveBeenCalledTimes(1);
  });
});
