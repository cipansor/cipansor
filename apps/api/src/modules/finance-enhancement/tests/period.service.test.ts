import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    financialPeriod: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

import { prisma } from '@/lib/prisma';
import { createFinancialPeriod, closePeriod, getFinancialPeriods } from '../period.service';

// A unit admin pinned to unit-1; a foundation role that reaches every unit.
const UNIT_ADMIN = { roleCode: 'SDIT_ADMIN', unitId: 'unit-1' };
const FOUNDATION = { roleCode: 'SUPER_ADMIN', unitId: null };

const PERIOD_INPUT = {
  unitId: 'unit-1',
  name: 'Semester 1',
  startDate: '2026-07-01T00:00:00.000Z',
  endDate: '2026-12-31T00:00:00.000Z',
};

describe('PeriodService — unit scope', () => {
  beforeEach(() => vi.clearAllMocks());

  it('createFinancialPeriod pins a unit admin to its own unit, ignoring the body', async () => {
    vi.mocked(prisma.financialPeriod.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.financialPeriod.create).mockResolvedValue({ id: 'fp-1' } as never);

    await createFinancialPeriod({ ...PERIOD_INPUT, unitId: 'other-unit' }, UNIT_ADMIN);

    expect(prisma.financialPeriod.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ unit: { connect: { id: 'unit-1' } } }),
      })
    );
  });

  it('closePeriod refuses a period of another unit (404)', async () => {
    vi.mocked(prisma.financialPeriod.findUnique).mockResolvedValue({
      unitId: 'other-unit',
    } as never);

    await expect(closePeriod('fp-1', 'user-1', UNIT_ADMIN)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(prisma.financialPeriod.update).not.toHaveBeenCalled();
  });

  it('closePeriod closes a period of the admin own unit', async () => {
    vi.mocked(prisma.financialPeriod.findUnique).mockResolvedValue({ unitId: 'unit-1' } as never);
    vi.mocked(prisma.financialPeriod.update).mockResolvedValue({ id: 'fp-1' } as never);

    await expect(closePeriod('fp-1', 'user-1', UNIT_ADMIN)).resolves.toBeDefined();
  });

  it('getFinancialPeriods narrows to the named unit', async () => {
    vi.mocked(prisma.financialPeriod.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.financialPeriod.count).mockResolvedValue(0 as never);

    await getFinancialPeriods({ unitId: 'unit-1' }, UNIT_ADMIN);

    expect(prisma.financialPeriod.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ unitId: 'unit-1' }) })
    );
  });

  it('getFinancialPeriods pins a unit admin to its own unit, ignoring a query unitId', async () => {
    vi.mocked(prisma.financialPeriod.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.financialPeriod.count).mockResolvedValue(0 as never);

    await getFinancialPeriods({ unitId: 'other-unit' }, UNIT_ADMIN);

    expect(prisma.financialPeriod.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ unitId: 'unit-1' }) })
    );
  });

  it('a foundation role may name any unit', async () => {
    vi.mocked(prisma.financialPeriod.findUnique).mockResolvedValue({ unitId: 'unit-9' } as never);
    vi.mocked(prisma.financialPeriod.update).mockResolvedValue({ id: 'fp-1' } as never);

    await expect(closePeriod('fp-1', 'user-1', FOUNDATION)).resolves.toBeDefined();
  });
});
