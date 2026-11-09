import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { businessUnitService } from '../business-unit.service';
import { prisma } from '@/lib/prisma';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    businessUnit: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    canteenTransaction: { groupBy: vi.fn() },
    laundryTransaction: { groupBy: vi.fn() },
  },
}));

describe('BusinessUnitService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should list business units with current-month revenue', async () => {
    const mockBUs = [
      { id: '1', name: 'Kantin A' },
      { id: '2', name: 'Laundry B' },
    ];
    (prisma.businessUnit.findMany as any).mockResolvedValue(mockBUs);
    (prisma.canteenTransaction.groupBy as any).mockResolvedValue([
      { businessUnitId: '1', _sum: { total: 150000 }, _count: { id: 12 } },
    ]);
    (prisma.laundryTransaction.groupBy as any).mockResolvedValue([
      { businessUnitId: '2', _sum: { total: 80000 }, _count: { id: 4 } },
    ]);

    const result = await businessUnitService.list({ unitId: 'unit-1' });

    expect(result).toEqual([
      { id: '1', name: 'Kantin A', monthlyRevenue: 150000, monthlyTransactions: 12 },
      { id: '2', name: 'Laundry B', monthlyRevenue: 80000, monthlyTransactions: 4 },
    ]);
    expect(prisma.businessUnit.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ unitId: 'unit-1' }),
      })
    );
  });

  it('should create a business unit', async () => {
    const data = { unitId: 'u1', name: 'Test BU', code: 'BU01', type: 'CANTEEN' as any };
    (prisma.businessUnit.findUnique as any).mockResolvedValue(null);
    (prisma.businessUnit.create as any).mockResolvedValue({ id: 'bu1', ...data });

    const result = await businessUnitService.create(data);

    expect(result.id).toBe('bu1');
    expect(prisma.businessUnit.create).toHaveBeenCalled();
  });

  it('should getById with unitId scoping', async () => {
    const mockBU = { id: 'bu1', unitId: 'unit-1', name: 'Kantin A' };
    (prisma.businessUnit.findFirst as any).mockResolvedValue(mockBU);

    const result = await businessUnitService.getById('bu1', 'unit-1');

    expect(result).toEqual(mockBU);
    expect(prisma.businessUnit.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'bu1', unitId: 'unit-1' }),
      })
    );
  });

  it('should throw notFound when getById targets a different unit', async () => {
    (prisma.businessUnit.findFirst as any).mockResolvedValue(null);

    await expect(businessUnitService.getById('bu1', 'other-unit')).rejects.toThrow();
  });

  describe('current-month window follows the WIB calendar (not the host clock)', () => {
    const prevTz = process.env.TZ;

    beforeEach(() => {
      process.env.TZ = 'UTC';
      vi.useFakeTimers({ toFake: ['Date'] });
      (prisma.businessUnit.findMany as any).mockResolvedValue([]);
      (prisma.canteenTransaction.groupBy as any).mockResolvedValue([]);
      (prisma.laundryTransaction.groupBy as any).mockResolvedValue([]);
    });

    afterEach(() => {
      vi.useRealTimers();
      if (prevTz === undefined) delete process.env.TZ;
      else process.env.TZ = prevTz;
    });

    const monthStartOf = (call: number) =>
      (prisma.canteenTransaction.groupBy as any).mock.calls[call][0].where.createdAt.gte as Date;

    it('on 1 Nov 2026 00:30 WIB bounds November, not October', async () => {
      vi.setSystemTime(new Date('2026-10-31T17:30:00Z')); // 1 Nov 2026 00:30 WIB

      await businessUnitService.list({});

      // 00:00 WIB on 1 Nov, the first instant of the WIB month.
      expect(monthStartOf(0).toISOString()).toBe('2026-10-31T17:00:00.000Z');
      const laundryStart = (prisma.laundryTransaction.groupBy as any).mock.calls[0][0].where
        .createdAt.gte as Date;
      expect(laundryStart.toISOString()).toBe('2026-10-31T17:00:00.000Z');
    });

    it('counts a sale made at 00:30 WIB on the 1st in the new month', async () => {
      vi.setSystemTime(new Date('2026-11-15T03:00:00Z')); // mid-November

      await businessUnitService.list({});

      const firstNightSale = new Date('2026-10-31T17:30:00Z'); // 1 Nov 00:30 WIB
      expect(firstNightSale.getTime()).toBeGreaterThanOrEqual(monthStartOf(0).getTime());
      // ...and a sale at 23:30 WIB on 31 Oct stays in October.
      const lastNightOfOctober = new Date('2026-10-31T16:30:00Z');
      expect(lastNightOfOctober.getTime()).toBeLessThan(monthStartOf(0).getTime());
    });

    it('on 1 Jan 2027 00:30 WIB bounds January 2027, not December 2026', async () => {
      vi.setSystemTime(new Date('2026-12-31T17:30:00Z')); // 1 Jan 2027 00:30 WIB

      await businessUnitService.list({});

      expect(monthStartOf(0).toISOString()).toBe('2026-12-31T17:00:00.000Z');
    });
  });
});
