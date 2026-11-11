import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createBudget,
  updateBudget,
  getBudgets,
  deleteBudget,
  recalculateBudgetUsage,
} from '../budget.service';
import { prisma } from '../../../lib/prisma';
import { Prisma } from '@prisma/client';

// Mock Prisma Decimal
const Decimal = class {
  constructor(public val: number | string) {}
  toNumber() {
    return Number(this.val);
  }
  toString() {
    return String(this.val);
  }
  plus(v: any) {
    return new Decimal(Number(this.val) + Number(v));
  }
  minus(v: any) {
    return new Decimal(Number(this.val) - Number(v));
  }
};

// @ts-ignore
Prisma.Decimal = Decimal;

// Mock Prisma
vi.mock('../../../lib/prisma', () => ({
  prisma: {
    budget: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      deleteMany: vi.fn(),
    },
    journalEntry: {
      aggregate: vi.fn(),
    },
    purchaseRequestItem: {
      count: vi.fn(),
    },
  },
}));

// A unit admin pinned to unit-1; a foundation role that reaches every unit.
const UNIT_ADMIN = { roleCode: 'SDIT_ADMIN', unitId: 'unit-1' };
const FOUNDATION = { roleCode: 'SUPER_ADMIN', unitId: null };

describe('Budget Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a budget successfully', async () => {
    const input = {
      unitId: 'unit-1',
      academicYearId: 'year-1',
      accountId: 'acc-1',
      amount: 1000000,
      periodType: 'YEARLY' as const,
      createdById: 'user-1',
    };

    const mockCreatedBudget = {
      id: 'budget-1',
      ...input,
      amount: new Prisma.Decimal(input.amount),
      usedAmount: new Prisma.Decimal(0),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    (prisma.budget.findUnique as any).mockResolvedValue(null);
    (prisma.budget.create as any).mockResolvedValue(mockCreatedBudget);

    const result = await createBudget(input, UNIT_ADMIN);

    expect(prisma.budget.findUnique).toHaveBeenCalledWith({
      where: {
        unitId_academicYearId_accountId: {
          unitId: input.unitId,
          academicYearId: input.academicYearId,
          accountId: input.accountId,
        },
      },
    });

    expect(prisma.budget.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amount: new Prisma.Decimal(input.amount),
        }),
      })
    );

    expect(result).toEqual(mockCreatedBudget);
  });

  it('should pin a unit admin to its own unit, ignoring the body unitId', async () => {
    (prisma.budget.findUnique as any).mockResolvedValue(null);
    (prisma.budget.create as any).mockResolvedValue({ id: 'budget-1' });

    await createBudget(
      {
        unitId: 'other-unit',
        academicYearId: 'year-1',
        accountId: 'acc-1',
        amount: 1000,
        createdById: 'user-1',
      },
      UNIT_ADMIN
    );

    expect(prisma.budget.findUnique).toHaveBeenCalledWith({
      where: {
        unitId_academicYearId_accountId: {
          unitId: 'unit-1',
          academicYearId: 'year-1',
          accountId: 'acc-1',
        },
      },
    });
    expect(prisma.budget.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ unit: { connect: { id: 'unit-1' } } }),
      })
    );
  });

  it('should throw error if budget already exists', async () => {
    (prisma.budget.findUnique as any).mockResolvedValue({ id: 'existing' });

    await expect(
      createBudget(
        {
          unitId: 'unit-1',
          academicYearId: 'year-1',
          accountId: 'acc-1',
          amount: 1000000,
          createdById: 'user-1',
        },
        UNIT_ADMIN
      )
    ).rejects.toThrow('Budget for this account and academic year already exists');
  });

  it('should get budgets with correct transformation', async () => {
    const mockBudgets = [
      {
        id: '1',
        unitId: 'unit-1',
        accountId: 'acc-1',
        amount: new Prisma.Decimal(1000),
        usedAmount: new Prisma.Decimal(200),
        academicYear: { startDate: new Date(), endDate: new Date() },
      },
    ];

    (prisma.budget.findMany as any).mockResolvedValue(mockBudgets);
    (prisma.budget.count as any).mockResolvedValue(1);

    const result = await getBudgets({}, UNIT_ADMIN);

    expect(result.data[0].amount).toBe(1000);
    expect(result.data[0].usedAmount).toBe(200);
  });

  it('getBudgets pins a unit admin to its own unit, ignoring a query unitId', async () => {
    (prisma.budget.findMany as any).mockResolvedValue([]);
    (prisma.budget.count as any).mockResolvedValue(0);

    await getBudgets({ unitId: 'other-unit' }, UNIT_ADMIN);

    expect(prisma.budget.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ unitId: 'unit-1' }) })
    );
  });

  it('getBudgets lets a foundation role read the unit it names', async () => {
    (prisma.budget.findMany as any).mockResolvedValue([]);
    (prisma.budget.count as any).mockResolvedValue(0);

    await getBudgets({ unitId: 'other-unit' }, FOUNDATION);

    expect(prisma.budget.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ unitId: 'other-unit' }) })
    );
  });

  it('updateBudget refuses a budget in another unit with 404', async () => {
    (prisma.budget.findUnique as any).mockResolvedValue({ unitId: 'other-unit' });

    await expect(updateBudget('budget-1', { amount: 5 }, UNIT_ADMIN)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(prisma.budget.update).not.toHaveBeenCalled();
  });

  it('updateBudget updates a budget in the admin own unit', async () => {
    (prisma.budget.findUnique as any).mockResolvedValue({ unitId: 'unit-1' });
    (prisma.budget.update as any).mockResolvedValue({ id: 'budget-1' });

    await updateBudget('budget-1', { amount: 5 }, UNIT_ADMIN);
    expect(prisma.budget.update).toHaveBeenCalled();
  });

  it('deleteBudget refuses a budget in another unit with 404', async () => {
    (prisma.budget.findUnique as any).mockResolvedValue({ unitId: 'other-unit' });

    await expect(deleteBudget('budget-1', UNIT_ADMIN)).rejects.toMatchObject({ statusCode: 404 });
    expect(prisma.budget.deleteMany).not.toHaveBeenCalled();
  });

  it('deleteBudget removes an unused budget in the admin own unit', async () => {
    (prisma.budget.findUnique as any).mockResolvedValue({ unitId: 'unit-1' });
    (prisma.purchaseRequestItem.count as any).mockResolvedValue(0);
    (prisma.budget.deleteMany as any).mockResolvedValue({ count: 1 });

    await expect(deleteBudget('budget-1', UNIT_ADMIN)).resolves.toEqual({ success: true });
  });

  it('recalculateBudgetUsage refuses a unit the admin does not reach', async () => {
    await expect(recalculateBudgetUsage('other-unit', 'year-1', UNIT_ADMIN)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('a foundation role reaches a named unit', async () => {
    (prisma.budget.findUnique as any).mockResolvedValue({ unitId: 'unit-9' });
    (prisma.budget.update as any).mockResolvedValue({ id: 'budget-1' });

    await expect(updateBudget('budget-1', { amount: 5 }, FOUNDATION)).resolves.toBeDefined();
  });
});
