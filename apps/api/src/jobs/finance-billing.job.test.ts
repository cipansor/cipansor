import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { Prisma } from '@prisma/client';

// The live monthly path (scheduler.ts -> runMonthlyAutoBilling) had no test, so
// it billed the server's calendar month. The cron fires at 04:00 WIB on the 1st
// (timezone 'Asia/Jakarta'), when the UTC production server still reads the
// previous month — every invoice was labelled the month (and in January, the
// year) that had just ended.

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    paymentType: { findMany: vi.fn(), findUnique: vi.fn() },
    student: { findMany: vi.fn() },
    invoice: { findFirst: vi.fn(), create: vi.fn() },
  },
}));

import { prisma } from '@/lib/prisma';
import { runMonthlyAutoBilling } from './finance-billing.job';

const paymentType = {
  id: 'pt-spp',
  name: 'SPP',
  amount: new Prisma.Decimal(500000),
  unitId: 'unit-1',
  unit: { name: 'SD IT' },
} as never;

const prevTz = process.env.TZ;

describe('runMonthlyAutoBilling bills the WIB calendar month', () => {
  beforeAll(() => {
    process.env.TZ = 'UTC';
    vi.useFakeTimers();
  });
  afterAll(() => {
    vi.useRealTimers();
    if (prevTz === undefined) delete process.env.TZ;
    else process.env.TZ = prevTz;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.paymentType.findMany).mockResolvedValue([paymentType]);
    vi.mocked(prisma.paymentType.findUnique).mockResolvedValue(paymentType);
    vi.mocked(prisma.student.findMany).mockResolvedValue([
      { id: 'student-1', unitId: 'unit-1', userId: 'user-1' } as never,
    ]);
    vi.mocked(prisma.invoice.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.invoice.create).mockResolvedValue({ id: 'inv' } as never);
  });

  function createdInvoice() {
    return vi.mocked(prisma.invoice.create).mock.calls[0][0].data;
  }

  it('bills August, not July, at 2026-08-01 04:00 WIB (the instant its own cron fires)', async () => {
    vi.setSystemTime(new Date('2026-07-31T21:00:00Z'));
    await runMonthlyAutoBilling();

    expect(createdInvoice().period).toBe('Agustus 2026');
    // The due date is stored as a date-only value (10 August, midnight UTC) so
    // that date readers render "10 Agustus" on any server timezone.
    expect(createdInvoice().dueDate).toEqual(new Date('2026-08-10T00:00:00.000Z'));
    // The invoice number carries the same WIB month as the period, so the two
    // never disagree about which month a bill belongs to.
    expect(createdInvoice().invoiceNumber).toMatch(/^INV-202608-/);
  });

  it('bills January 2026, not December 2025, at 2026-01-01 02:00 WIB', async () => {
    vi.setSystemTime(new Date('2025-12-31T19:00:00Z'));
    await runMonthlyAutoBilling();

    expect(createdInvoice().period).toBe('Januari 2026');
    expect(createdInvoice().dueDate).toEqual(new Date('2026-01-10T00:00:00.000Z'));
    expect(createdInvoice().invoiceNumber).toMatch(/^INV-202601-/);
  });

  it('numbers a backdated run from the billed month, not the wall clock', async () => {
    // System clock sits in September, but the caller asks the job to bill
    // August. The invoice number must follow the billed month, or it disagrees
    // with the period it was created for.
    vi.setSystemTime(new Date('2026-09-15T04:00:00Z'));
    await runMonthlyAutoBilling(new Date('2026-07-31T21:00:00Z'));

    expect(createdInvoice().period).toBe('Agustus 2026');
    expect(createdInvoice().invoiceNumber).toMatch(/^INV-202608-/);
  });

  it('scopes the idempotence check to the billed month as the due-date column stores it', async () => {
    vi.setSystemTime(new Date('2026-07-31T21:00:00Z'));
    await runMonthlyAutoBilling();

    // Bounds are the billed month as a date-only column holds it: midnight UTC
    // on the first, not a server-local `new Date(2026, 7, 1)` (07:00 WIB) nor a
    // WIB-midnight instant (17:00Z the day before).
    expect(prisma.invoice.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          dueDate: {
            gte: new Date('2026-08-01T00:00:00.000Z'),
            lt: new Date('2026-09-01T00:00:00.000Z'),
          },
        }),
      })
    );
  });
});
