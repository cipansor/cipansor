import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma';
import { generateRecurringBills } from '../finance.service';
import { STUDENT_STATUS } from '@cipansor/shared';

// Mock all external dependencies
vi.mock('../../../lib/prisma', () => ({
  prisma: {
    student: {
      findMany: vi.fn(),
    },
    paymentType: {
      findMany: vi.fn(),
    },
    invoice: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  },
}));

describe('Finance Scheduler Unit Tests - Auto Billing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateRecurringBills', () => {
    it('should query active students and recurring payment types', async () => {
      vi.mocked(prisma.student.findMany).mockResolvedValue([
        { id: 'student-1', unitId: 'unit-1', status: STUDENT_STATUS.ACTIVE } as any,
      ]);

      vi.mocked(prisma.paymentType.findMany).mockResolvedValue([
        { id: 'pt-spp', code: 'SPP', amount: new Prisma.Decimal(500000), unitId: 'unit-1' } as any,
      ]);

      vi.mocked(prisma.invoice.findFirst).mockResolvedValue(null);

      await generateRecurringBills();

      // Kosakatanya diturunkan dari STUDENT_STATUS, bukan diketik ulang.
      // Sampai 2026-09-13 assertion ini memaku 'ACTIVE' huruf besar — dan HIJAU,
      // justru karena kodenya juga salah. Kolomnya berisi 'active' huruf kecil,
      // jadi penyaring itu selalu mengembalikan nol santri dan tagihan berulang
      // tidak pernah terbit untuk siapa pun. Uji yang memaku ejaan yang salah
      // mengubah cacat menjadi kontrak; yang menemukannya adalah perbaikan
      // kodenya, bukan uji ini.
      expect(prisma.student.findMany).toHaveBeenCalledWith({
        where: { status: STUDENT_STATUS.ACTIVE },
        select: { id: true, unitId: true, userId: true },
      });

      expect(prisma.paymentType.findMany).toHaveBeenCalledWith({
        where: { isRecurring: true, isActive: true },
      });
    });

    it('should generate invoices for eligible students', async () => {
      vi.mocked(prisma.student.findMany).mockResolvedValue([
        { id: 'student-1', unitId: 'unit-1', userId: 'user-1' } as any,
      ]);

      vi.mocked(prisma.paymentType.findMany).mockResolvedValue([
        {
          id: 'pt-spp',
          code: 'SPP',
          amount: new Prisma.Decimal(500000),
          unitId: 'unit-1',
          name: 'SPP',
        } as any,
      ]);

      // Mock that invoice doesn't exist yet for this month
      vi.mocked(prisma.invoice.findFirst).mockResolvedValue(null);

      // Mock the create response
      vi.mocked(prisma.invoice.create).mockResolvedValue({ id: 'inv-new' } as any);

      const result = await generateRecurringBills();

      expect(prisma.invoice.findFirst).toHaveBeenCalledTimes(2); // 1 for existing check, 1 for generateInvoiceNumber
      expect(prisma.invoice.create).toHaveBeenCalledTimes(1);

      // Verify invoice data
      const createCall = vi.mocked(prisma.invoice.create).mock.calls[0][0];
      expect(createCall.data.studentId).toBe('student-1');
      expect(createCall.data.paymentTypeId).toBe('pt-spp');
      expect(createCall.data.amount.toString()).toBe('500000');

      expect(result.processed).toBe(1);
      expect(result.created).toBe(1);
    });

    it('numbers and labels a backdated run from its billed month, not the clock', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-15T04:00:00Z'));
      try {
        vi.mocked(prisma.student.findMany).mockResolvedValue([
          { id: 'student-1', unitId: 'unit-1', userId: 'user-1' } as any,
        ]);
        vi.mocked(prisma.paymentType.findMany).mockResolvedValue([
          {
            id: 'pt-spp',
            code: 'SPP',
            amount: new Prisma.Decimal(500000),
            unitId: 'unit-1',
            name: 'SPP',
          } as any,
        ]);
        vi.mocked(prisma.invoice.findFirst).mockResolvedValue(null);
        vi.mocked(prisma.invoice.create).mockResolvedValue({ id: 'inv-new' } as any);

        await generateRecurringBills(new Date('2026-07-31T21:00:00Z')); // 1 Aug WIB

        const createCall = vi.mocked(prisma.invoice.create).mock.calls[0][0];
        expect(createCall.data.period).toBe('Agustus 2026');
        expect(createCall.data.invoiceNumber).toMatch(/^INV-202608-/);
      } finally {
        vi.useRealTimers();
      }
    });

    it('queries the idempotence guard with WIB month bounds, not server-local ones', async () => {
      // Same defect as generateBulkSppInvoices: on a UTC server the guard's
      // `new Date(year, month, 1)` starts the month at 07:00 WIB, so an invoice
      // due early on the 1st WIB slips past `findFirst` and a re-run duplicates
      // it. The guard must use the [00:00 WIB, next 00:00 WIB) band.
      const prevTz = process.env.TZ;
      process.env.TZ = 'UTC';
      try {
        vi.mocked(prisma.student.findMany).mockResolvedValue([
          { id: 'student-1', unitId: 'unit-1', userId: 'user-1' } as any,
        ]);
        vi.mocked(prisma.paymentType.findMany).mockResolvedValue([
          {
            id: 'pt-spp',
            code: 'SPP',
            amount: new Prisma.Decimal(500000),
            unitId: 'unit-1',
            name: 'SPP',
          } as any,
        ]);
        vi.mocked(prisma.invoice.findFirst).mockResolvedValue(null);
        vi.mocked(prisma.invoice.create).mockResolvedValue({ id: 'inv-new' } as any);

        await generateRecurringBills(new Date('2026-07-31T21:00:00Z')); // 1 Aug WIB

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
      // Same mismatch as the bulk generator: a local due date can precede the
      // WIB guard on a server east of WIB. Emulate Prisma's dueDate gte/lt
      // filter against what was stored and rerun.
      const prevTz = process.env.TZ;
      process.env.TZ = 'Asia/Makassar'; // UTC+8, east of WIB
      try {
        vi.mocked(prisma.student.findMany).mockResolvedValue([
          { id: 'student-1', unitId: 'unit-1', userId: 'user-1' } as any,
        ]);
        vi.mocked(prisma.paymentType.findMany).mockResolvedValue([
          {
            id: 'pt-spp',
            code: 'SPP',
            amount: new Prisma.Decimal(500000),
            unitId: 'unit-1',
            name: 'SPP',
          } as any,
        ]);

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

        const at = new Date('2026-07-31T21:00:00Z'); // 1 Aug WIB
        await generateRecurringBills(at);
        expect(stored).toHaveLength(1);
        // 10 August as a date-only value; a UTC+8 local construction would put
        // it at 2026-08-09T16:00Z, outside the guard.
        expect(stored[0].dueDate.toISOString()).toBe('2026-08-10T00:00:00.000Z');

        const second = await generateRecurringBills(at);
        expect(stored).toHaveLength(1);
        expect(second.created).toBe(0);
        expect(second.skipped).toBe(1);
      } finally {
        vi.mocked(prisma.invoice.findFirst).mockReset();
        if (prevTz === undefined) delete process.env.TZ;
        else process.env.TZ = prevTz;
      }
    });

    it('should skip invoice creation if already billed for the month', async () => {
      vi.mocked(prisma.student.findMany).mockResolvedValue([
        { id: 'student-1', unitId: 'unit-1', userId: 'user-1' } as any,
      ]);

      vi.mocked(prisma.paymentType.findMany).mockResolvedValue([
        {
          id: 'pt-spp',
          code: 'SPP',
          amount: new Prisma.Decimal(500000),
          unitId: 'unit-1',
          name: 'SPP',
        } as any,
      ]);

      // Mock that invoice ALREADY exists for this month
      vi.mocked(prisma.invoice.findFirst).mockResolvedValue({ id: 'inv-existing' } as any);

      const result = await generateRecurringBills();

      expect(prisma.invoice.findFirst).toHaveBeenCalledTimes(1);

      // Should NOT create
      expect(prisma.invoice.create).not.toHaveBeenCalled();

      expect(result.processed).toBe(1);
      expect(result.created).toBe(0);
      expect(result.skipped).toBe(1);
    });
  });
});
