import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The account picker on `/finance/budgeting` must offer only the accounts
 * `createBudget` accepts: the chosen unit's own plus the shared (`unitId` null)
 * ones. Filtering that list client-side over the first page hid a unit's own
 * accounts that fell past page 1, so the filter moved into the query — and a
 * `unitId` filter that dropped the shared rows would be just as wrong.
 */
const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    accountCode: { findMany: vi.fn(), count: vi.fn() },
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { financeEnhancementService } from '../finance-enhancement.service';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.accountCode.findMany.mockResolvedValue([]);
  prismaMock.accountCode.count.mockResolvedValue(0);
});

const whereOf = () => prismaMock.accountCode.findMany.mock.calls[0][0].where;

describe('getAccountCodes — the unit filter', () => {
  it('matches the unit’s own accounts and the shared ones, nothing else', async () => {
    await financeEnhancementService.getAccountCodes({
      type: 'EXPENSE',
      unitId: 'unit-1',
      page: 1,
      limit: 100,
    });

    expect(whereOf()).toEqual({
      AND: [{ type: 'EXPENSE' }, { OR: [{ unitId: 'unit-1' }, { unitId: null }] }],
    });
  });

  it('leaves the query unscoped when no unit is given', async () => {
    await financeEnhancementService.getAccountCodes({ type: 'EXPENSE', page: 1, limit: 100 });

    expect(whereOf()).toEqual({ AND: [{ type: 'EXPENSE' }] });
  });

  it('keeps search and isActive alongside the unit filter', async () => {
    await financeEnhancementService.getAccountCodes({
      type: 'EXPENSE',
      isActive: true,
      search: '5101',
      unitId: 'unit-1',
      page: 1,
      limit: 100,
    });

    expect(whereOf()).toEqual({
      AND: [
        { type: 'EXPENSE' },
        { isActive: true },
        {
          OR: [
            { code: { contains: '5101', mode: 'insensitive' } },
            { name: { contains: '5101', mode: 'insensitive' } },
          ],
        },
        { OR: [{ unitId: 'unit-1' }, { unitId: null }] },
      ],
    });
  });
});
