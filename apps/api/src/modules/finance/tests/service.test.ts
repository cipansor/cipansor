import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import * as prismaClient from '@prisma/client';

// Mock prisma before imports
vi.mock('../../../lib/prisma', () => {
  const mockPrisma = {
    paymentType: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    invoice: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    payment: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
    },
    academicYear: {
      findUnique: vi.fn(),
    },
    student: {
      findMany: vi.fn(async () => []),
    },
    scholarshipRecipient: {
      // No active scholarships by default — invoice amount stays as-is.
      findMany: vi.fn(async () => []),
    },
    $transaction: vi.fn(),
  };
  mockPrisma.$transaction.mockImplementation((callback) => callback(mockPrisma));
  return { prisma: mockPrisma };
});

import { prisma } from '../../../lib/prisma';
import * as financeService from '../finance.service';
import * as notificationService from '../../notifications/notifications.service';

import { eventBus } from '@/lib/event-bus';

vi.mock('../../notifications/notifications.service', () => ({
  createNotification: vi.fn(),
}));

vi.mock('@/lib/event-bus', () => ({
  eventBus: {
    emit: vi.fn(),
  },
}));

describe('Finance Service Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createPaymentType', () => {
    it('should create a payment type successfully', async () => {
      const dto = {
        name: 'SPP',
        code: 'SPP-01',
        description: 'Sumbangan Pembinaan Pendidikan',
        isRecurring: true,
        isActive: true,
        amount: 500000,
        unitId: 'unit-1',
      };

      const mockCreated = {
        id: 'pt-1',
        ...dto,
        amount: new Prisma.Decimal(500000),
        unit: { id: 'unit-1', name: 'SMA' },
      };

      vi.mocked(prisma.paymentType.create).mockResolvedValue(mockCreated as any);

      const result = await financeService.createPaymentType(dto);

      expect(prisma.paymentType.create).toHaveBeenCalledWith({
        data: {
          name: dto.name,
          code: dto.code,
          description: dto.description,
          isRecurring: dto.isRecurring,
          isActive: dto.isActive,
          amount: expect.any(Prisma.Decimal),
          unit: { connect: { id: dto.unitId } },
          account: undefined,
        },
        include: { unit: { select: { id: true, name: true } } },
      });

      expect(result).toEqual(mockCreated);
    });
  });

  describe('createInvoice', () => {
    it('should create an invoice and send notification', async () => {
      const dto = {
        title: 'Pembayaran SPP Januari',
        amount: 500000,
        dueDate: '2026-03-01',
        studentId: 'stud-1',
        paymentTypeId: 'pt-1',
      };

      const mockInvoice = {
        id: 'inv-1',
        invoiceNumber: 'INV-202602-00001',
        student: {
          user: { id: 'user-1', name: 'John Doe', email: 'john@example.com' },
          unit: { id: 'unit-1', name: 'SMA' },
        },
        paymentType: { id: 'pt-1', name: 'SPP', code: 'SPP-01' },
        amount: new Prisma.Decimal(500000),
        dueDate: new Date('2026-03-01T00:00:00.000Z'),
      };

      vi.mocked(prisma.invoice.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.invoice.create).mockResolvedValue(mockInvoice as any);
      vi.mocked(notificationService.createNotification).mockResolvedValue({} as any);

      const result = await financeService.createInvoice(dto);

      expect(prisma.invoice.findFirst).toHaveBeenCalled();
      expect(prisma.invoice.create).toHaveBeenCalled();
      expect(notificationService.createNotification).toHaveBeenCalled();
      expect(result).toEqual(mockInvoice);
    });

    it('should apply an active scholarship percentage discount to the invoice amount', async () => {
      const dto = {
        title: 'Pembayaran SPP Januari',
        amount: 500000,
        dueDate: '2026-03-01',
        studentId: 'stud-1',
        paymentTypeId: 'pt-1',
      };

      vi.mocked(prisma.invoice.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.scholarshipRecipient.findMany).mockResolvedValue([
        {
          id: 'rec-1',
          scholarship: {
            discounts: [
              {
                componentId: 'pt-1',
                discountType: 'PERCENTAGE',
                discountValue: new Prisma.Decimal(50),
              },
              // Discount for a different payment type must be ignored.
              {
                componentId: 'pt-other',
                discountType: 'PERCENTAGE',
                discountValue: new Prisma.Decimal(100),
              },
            ],
          },
        },
      ] as any);
      vi.mocked(prisma.invoice.create).mockResolvedValue({
        id: 'inv-2',
        student: { user: { id: 'u1' }, unit: { id: 'unit-1' } },
      } as any);
      vi.mocked(notificationService.createNotification).mockResolvedValue({} as any);

      await financeService.createInvoice(dto);

      const createArgs = vi.mocked(prisma.invoice.create).mock.calls[0][0];
      expect(Number(createArgs.data.amount)).toBe(250000);
    });

    it('stores a supplied deadline as the date-only value of the day it names', async () => {
      // A bill's deadline is a calendar day. `createInvoice` stores it at
      // midnight UTC — the form the monthly guard, the reminder window and the
      // academic-year bounds all compare against — so "10 August" is stored as
      // 2026-08-10T00:00Z and renders as the 10th, whatever the server zone.
      vi.mocked(prisma.invoice.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.invoice.create).mockResolvedValue({
        id: 'inv-3',
        amount: new Prisma.Decimal(500000),
        dueDate: new Date('2026-08-10T00:00:00.000Z'),
        student: { user: { id: 'u1' } },
        paymentType: { name: 'SPP' },
      } as any);
      vi.mocked(notificationService.createNotification).mockResolvedValue({} as any);

      await financeService.createInvoice({
        amount: 500000,
        dueDate: '2026-08-10',
        studentId: 'stud-1',
        paymentTypeId: 'pt-1',
      } as any);

      const createArgs = vi.mocked(prisma.invoice.create).mock.calls[0][0];
      expect((createArgs.data.dueDate as Date).toISOString()).toBe('2026-08-10T00:00:00.000Z');
    });

    it('stores an update deadline as the date-only value of the day it names', async () => {
      vi.mocked(prisma.invoice.update).mockResolvedValue({ id: 'inv-1' } as any);

      await financeService.updateInvoice('inv-1', { dueDate: '2026-08-10' } as any);

      const updateArgs = vi.mocked(prisma.invoice.update).mock.calls[0][0];
      expect((updateArgs.data.dueDate as Date).toISOString()).toBe('2026-08-10T00:00:00.000Z');
    });
  });
});

describe('generateBulkSppInvoices', () => {
  beforeEach(() => vi.clearAllMocks());

  it('bills only santri who are still enrolled, never alumni or those who left', async () => {
    (prisma.paymentType.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'pt-spp',
      name: 'SPP',
      amount: new Prisma.Decimal(350000),
    });
    const findStudents = (prisma as unknown as { student: { findMany: ReturnType<typeof vi.fn> } })
      .student.findMany;
    findStudents.mockResolvedValue([]);

    await financeService.generateBulkSppInvoices({
      unitId: 'unit-1',
      paymentTypeId: 'pt-spp',
      year: 2026,
      month: 9,
    });

    expect(findStudents).toHaveBeenCalledWith({
      where: expect.objectContaining({ unitId: 'unit-1', status: 'active', deletedAt: null }),
    });
  });

  it('queries the idempotence guard with WIB month bounds, not server-local ones', async () => {
    // On a UTC server `new Date(2026, 7, 1)` is 2026-08-01T00:00Z = 07:00 WIB on
    // the 1st, so an invoice due at 01:00 WIB on the 1st (2026-07-31T18:00Z) fell
    // outside the guard: `!existing` was true and a re-run created a duplicate.
    // The guard must use the same [00:00 WIB, next 00:00 WIB) band the reminder
    // job uses — red before the fix, green after.
    const prevTz = process.env.TZ;
    process.env.TZ = 'UTC';
    try {
      (prisma.paymentType.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'pt-spp',
        name: 'SPP',
        amount: new Prisma.Decimal(350000),
      });
      (
        prisma as unknown as { student: { findMany: ReturnType<typeof vi.fn> } }
      ).student.findMany.mockResolvedValue([{ id: 'student-1', unitId: 'unit-1' }]);
      vi.mocked(prisma.invoice.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.invoice.create).mockResolvedValue({ id: 'inv-1' } as any);

      await financeService.generateBulkSppInvoices({
        unitId: 'unit-1',
        paymentTypeId: 'pt-spp',
        year: 2026,
        month: 7, // August
      });

      expect(vi.mocked(prisma.invoice.findFirst).mock.calls[0][0]?.where?.dueDate).toEqual({
        gte: new Date('2026-08-01T00:00:00.000Z'),
        lt: new Date('2026-09-01T00:00:00.000Z'),
      });
    } finally {
      if (prevTz === undefined) delete process.env.TZ;
      else process.env.TZ = prevTz;
    }
  });

  it('does not bill a first-day invoice twice on a server east of WIB', async () => {
    // The due date was built with `new Date(year, month, dueDay)`, which reads
    // the server timezone. On UTC+8 a `dueDay: 1` bill lands at 2026-07-31T16:00Z
    // — one hour *before* the WIB month guard opens (2026-07-31T17:00Z) — so a
    // rerun could not find its own invoice and billed the student again. Emulate
    // Prisma's `dueDate: { gte, lt }` filter against what was actually stored.
    const prevTz = process.env.TZ;
    process.env.TZ = 'Asia/Makassar'; // UTC+8, east of WIB
    try {
      (prisma.paymentType.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'pt-spp',
        name: 'SPP',
        amount: new Prisma.Decimal(350000),
      });
      (
        prisma as unknown as { student: { findMany: ReturnType<typeof vi.fn> } }
      ).student.findMany.mockResolvedValue([{ id: 'student-1', unitId: 'unit-1' }]);

      const stored: Array<{ dueDate: Date }> = [];
      vi.mocked(prisma.invoice.create).mockImplementation((async ({ data }: any) => {
        stored.push({ dueDate: data.dueDate });
        return { id: `inv-${stored.length}`, ...data } as any;
      }) as never);
      vi.mocked(prisma.invoice.findFirst).mockImplementation((async ({ where }: any) => {
        if (!where?.dueDate) return null; // generateInvoiceNumber's prefix lookup
        const { gte, lt } = where.dueDate;
        return stored.find((r) => r.dueDate >= gte && r.dueDate < lt) ?? null;
      }) as never);

      const run = () =>
        financeService.generateBulkSppInvoices({
          unitId: 'unit-1',
          paymentTypeId: 'pt-spp',
          year: 2026,
          month: 7, // August
          dueDay: 1,
        });

      await run();
      expect(stored).toHaveLength(1);
      expect(stored[0].dueDate.toISOString()).toBe('2026-08-01T00:00:00.000Z'); // date-only 1 Aug

      const second = await run();
      expect(stored).toHaveLength(1); // the rerun found the invoice, created none
      expect(second.created).toBe(0);
      expect(second.skipped).toBe(1);
    } finally {
      vi.mocked(prisma.invoice.findFirst).mockReset();
      if (prevTz === undefined) delete process.env.TZ;
      else process.env.TZ = prevTz;
    }
  });

  it('finds a manually created first-day invoice and does not bill it again', async () => {
    // The gate's scenario: a manual SPP invoice the caller meant as "1 August".
    // The create contract is the calendar day, stored date-only (2026-08-01T00:00Z),
    // so the guard's [2026-08-01Z, 2026-09-01Z) band finds it and August
    // generation does not bill the student twice.
    const prevTz = process.env.TZ;
    process.env.TZ = 'UTC';
    try {
      (prisma.paymentType.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'pt-spp',
        name: 'SPP',
        amount: new Prisma.Decimal(350000),
      });
      (
        prisma as unknown as { student: { findMany: ReturnType<typeof vi.fn> } }
      ).student.findMany.mockResolvedValue([{ id: 'student-1', unitId: 'unit-1' }]);
      vi.mocked(prisma.scholarshipRecipient.findMany).mockResolvedValue([] as any);
      vi.mocked(notificationService.createNotification).mockResolvedValue({} as any);

      const stored: Array<{ dueDate: Date }> = [];
      vi.mocked(prisma.invoice.create).mockImplementation((async ({ data }: any) => {
        stored.push({ dueDate: data.dueDate });
        return {
          id: `inv-${stored.length}`,
          amount: data.amount ?? new Prisma.Decimal(350000),
          dueDate: data.dueDate,
          student: { user: { id: 'u1' } },
          paymentType: { name: 'SPP' },
          ...data,
        } as any;
      }) as never);
      vi.mocked(prisma.invoice.findFirst).mockImplementation((async ({ where }: any) => {
        if (!where?.dueDate) return null; // generateInvoiceNumber's prefix lookup
        const { gte, lt } = where.dueDate;
        return stored.find((r) => r.dueDate >= gte && r.dueDate < lt) ?? null;
      }) as never);

      await financeService.createInvoice({
        amount: 350000,
        dueDate: '2026-08-01', // 1 August, the calendar day
        studentId: 'student-1',
        paymentTypeId: 'pt-spp',
      } as any);
      expect(stored).toHaveLength(1);
      expect(stored[0].dueDate.toISOString()).toBe('2026-08-01T00:00:00.000Z');

      const result = await financeService.generateBulkSppInvoices({
        unitId: 'unit-1',
        paymentTypeId: 'pt-spp',
        year: 2026,
        month: 7, // August
        dueDay: 1,
      });

      expect(stored).toHaveLength(1); // the guard found the manual invoice
      expect(result.created).toBe(0);
      expect(result.skipped).toBe(1);
    } finally {
      vi.mocked(prisma.invoice.findFirst).mockReset();
      if (prevTz === undefined) delete process.env.TZ;
      else process.env.TZ = prevTz;
    }
  });
});

// The billing screens read these four. They had no unit filter and returned
// every Student column (NIK, family-card number, parents' NIK and income).
describe('bill and payment reads: scope and fields', () => {
  const smpTu = { sub: 'u-tu', role: 'STAFF', roleCode: 'SMPIT_TATA_USAHA', unitId: 'unit-smp' };
  const ketua = { sub: 'u-ketua', role: 'UNIT_ADMIN', roleCode: 'YAYASAN_KETUA', unitId: null };
  const parent = {
    sub: 'u-parent',
    role: 'PARENT',
    roleCode: 'SMPIT_ORANG_TUA',
    unitId: 'unit-smp',
  };
  const page = { page: 1, limit: 20 };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as any);
    vi.mocked(prisma.invoice.count).mockResolvedValue(0 as any);
    vi.mocked(prisma.payment.findMany).mockResolvedValue([] as any);
    vi.mocked(prisma.payment.count).mockResolvedValue(0 as any);
  });

  const lastInvoiceQuery = () => vi.mocked(prisma.invoice.findMany).mock.calls[0][0] as any;

  it("a unit's TU lists only bills of their own unit", async () => {
    await financeService.getInvoices(page as any, smpTu);
    const { where } = lastInvoiceQuery();
    expect(where.AND).toContainEqual({ paymentType: { unitId: 'unit-smp' } });
    expect(vi.mocked(prisma.invoice.count).mock.calls[0][0]).toEqual({ where });
  });

  it('the yayasan board lists every unit', async () => {
    await financeService.getInvoices(page as any, ketua);
    expect(lastInvoiceQuery().where.AND[0]).toEqual({});
  });

  it('returns a name and a NIS for the student, not the whole record', async () => {
    await financeService.getInvoices(page as any, smpTu);
    const { include } = lastInvoiceQuery();
    expect(include.student.select).toEqual({
      id: true,
      nis: true,
      unitId: true,
      user: { select: { id: true, name: true } },
    });
    expect(include.student.include).toBeUndefined();
  });

  it('lists the newest bills first', async () => {
    await financeService.getInvoices(page as any, smpTu);
    expect(lastInvoiceQuery().orderBy[0]).toEqual({ dueDate: 'desc' });
  });

  it('searches invoice number, NIS and santri name', async () => {
    await financeService.getInvoices({ ...page, search: ' rizky ' } as any, smpTu);
    const filters = lastInvoiceQuery().where.AND[1];
    expect(filters.OR).toEqual([
      { invoiceNumber: { contains: 'rizky', mode: 'insensitive' } },
      { student: { nis: { contains: 'rizky' } } },
      { student: { user: { name: { contains: 'rizky', mode: 'insensitive' } } } },
    ]);
  });

  it('filters a kind of bill by code across units', async () => {
    await financeService.getInvoices({ ...page, paymentTypeCode: 'SPP' } as any, ketua);
    expect(lastInvoiceQuery().where.AND[1].paymentType).toEqual({ code: 'SPP' });
  });

  it("an academic year means its months, so July's SPP (due the 10th) is in it", async () => {
    vi.mocked(prisma.academicYear.findUnique).mockResolvedValue({
      startDate: new Date('2026-07-15T00:00:00Z'),
      endDate: new Date('2027-06-30T00:00:00Z'),
    } as any);
    await financeService.getInvoices({ ...page, academicYearId: 'ay-2627' } as any, smpTu);
    const { dueDate } = lastInvoiceQuery().where.AND[1];
    expect(dueDate).toEqual({
      gte: new Date('2026-07-01T00:00:00Z'),
      lt: new Date('2027-07-01T00:00:00Z'),
    });
    const julySpp = new Date('2026-07-10T00:00:00Z');
    expect(julySpp >= dueDate.gte && julySpp < dueDate.lt).toBe(true);
  });

  it('a first-day bill stays inside its academic year, not the one before', async () => {
    // A dueDay:1 bill is stored at the first of the month. Kept as a date-only
    // value (00:00Z), July's bill sits at the year's own `gte`, not in June of
    // the year before — which a WIB-midnight instant (17:00Z the day before)
    // would fall outside of.
    vi.mocked(prisma.academicYear.findUnique).mockResolvedValue({
      startDate: new Date('2026-07-15T00:00:00Z'),
      endDate: new Date('2027-06-30T00:00:00Z'),
    } as any);
    await financeService.getInvoices({ ...page, academicYearId: 'ay-2627' } as any, smpTu);
    const { dueDate } = lastInvoiceQuery().where.AND[1];
    const firstDayBill = new Date('2026-07-01T00:00:00Z');
    expect(firstDayBill >= dueDate.gte && firstDayBill < dueDate.lt).toBe(true);
  });

  it('an unknown academic year matches nothing instead of every year', async () => {
    vi.mocked(prisma.academicYear.findUnique).mockResolvedValue(null);
    await financeService.getInvoices({ ...page, academicYearId: 'gone' } as any, smpTu);
    const { dueDate } = lastInvoiceQuery().where.AND[1];
    expect(dueDate.gte.getTime()).toBe(dueDate.lt.getTime());
  });

  it('a bill of another unit is not found', async () => {
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue(null);
    const bill = await financeService.getInvoiceById('inv-sma', smpTu);
    expect(bill).toBeNull();
    const arg = vi.mocked(prisma.invoice.findFirst).mock.calls[0][0] as any;
    expect(arg.where.AND).toEqual([{ id: 'inv-sma' }, { paymentType: { unitId: 'unit-smp' } }]);
    expect(arg.include.student.select.nik).toBeUndefined();
  });

  it("a parent opens only payments on their own children's bills", async () => {
    vi.mocked(prisma.payment.findFirst).mockResolvedValue(null);
    await financeService.getPaymentById('pay-1', parent);
    const arg = vi.mocked(prisma.payment.findFirst).mock.calls[0][0] as any;
    expect(arg.where.AND).toEqual([
      { id: 'pay-1' },
      { invoice: { student: { parents: { some: { parentId: 'u-parent' } } } } },
    ]);
  });

  it("the payments list is scoped to the TU's unit", async () => {
    await financeService.getPayments(page as any, smpTu);
    const arg = vi.mocked(prisma.payment.findMany).mock.calls[0][0] as any;
    expect(arg.where.AND[0]).toEqual({ invoice: { paymentType: { unitId: 'unit-smp' } } });
    expect(arg.include.invoice.include.student.select.user).toEqual({
      select: { id: true, name: true },
    });
  });

  it('the summary adds up only the bills the list would show', async () => {
    vi.mocked(prisma.academicYear.findUnique).mockResolvedValue({
      startDate: new Date('2026-07-15T00:00:00Z'),
      endDate: new Date('2027-06-30T00:00:00Z'),
    } as any);
    await financeService.getFinancialSummary(smpTu, 'ay-2627');
    const invoiceWhere = (vi.mocked(prisma.invoice.findMany).mock.calls[0][0] as any).where;
    expect(invoiceWhere.AND).toEqual([
      { paymentType: { unitId: 'unit-smp' } },
      { dueDate: { gte: new Date('2026-07-01T00:00:00Z'), lt: new Date('2027-07-01T00:00:00Z') } },
    ]);
    const paymentWhere = (vi.mocked(prisma.payment.findMany).mock.calls[0][0] as any).where;
    expect(paymentWhere).toEqual({ invoice: invoiceWhere });
  });
});
