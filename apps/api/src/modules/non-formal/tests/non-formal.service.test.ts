import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * A course enrollment opens an invoice numbered `INV-CRS-YYYYMM-NNNNN`, where
 * the sequence continues the last invoice with the same month prefix. The API
 * container runs in UTC, so between 00:00 and 06:59 WIB on the 1st the new
 * month's first invoice took the old month's prefix and continued its sequence
 * (#883). Both the prefix and the lookup it continues are on the WIB month.
 */

const tx = vi.hoisted(() => ({
  course: { findUnique: vi.fn() },
  courseEnrollment: { create: vi.fn(), update: vi.fn() },
  paymentType: { findFirst: vi.fn(), create: vi.fn() },
  invoice: { findFirst: vi.fn(), create: vi.fn() },
}));

vi.mock('../../../lib/prisma', () => ({
  prisma: {
    ...tx,
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  },
}));

import { courseService } from '../non-formal.service';

const COURSE = {
  id: 'course-1',
  unitId: 'unit-1',
  name: 'Bahasa Arab Dasar',
  // A Prisma Decimal: the service asks `price.gt(0)` before invoicing.
  price: { gt: (n: number) => 250000 > n, toString: () => '250000' },
  maxParticipants: 20,
  _count: { enrollments: 0 },
};

const prevTz = process.env.TZ;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TZ = 'UTC';
  vi.useFakeTimers({ toFake: ['Date'] });
  tx.course.findUnique.mockResolvedValue(COURSE);
  tx.courseEnrollment.update.mockResolvedValue({});
  tx.courseEnrollment.create.mockImplementation(async ({ data }) => ({ id: 'enr-1', ...data }));
  tx.paymentType.findFirst.mockResolvedValue({ id: 'pt-course' });
  tx.invoice.create.mockImplementation(async ({ data }) => ({ id: 'inv-1', ...data }));
});

afterEach(() => {
  vi.useRealTimers();
  if (prevTz === undefined) delete process.env.TZ;
  else process.env.TZ = prevTz;
});

const enroll = () =>
  courseService.enroll({
    courseId: COURSE.id,
    externalName: 'Peserta Umum',
    externalPhone: '081200000000',
  } as never);

const invoiceNumber = () => tx.invoice.create.mock.calls[0][0].data.invoiceNumber as string;
const invoiceDueDate = () => tx.invoice.create.mock.calls[0][0].data.dueDate as Date;
const lookedUpPrefix = () =>
  tx.invoice.findFirst.mock.calls[0][0].where.invoiceNumber.startsWith as string;

describe('course invoice number follows the WIB month', () => {
  it('starts November at 00001 for an enrollment at 00:30 WIB on 1 November', async () => {
    vi.setSystemTime(new Date('2026-10-31T17:30:00.000Z')); // 1 Nov 2026 00:30 WIB
    // October already has invoices; November has none yet.
    tx.invoice.findFirst.mockImplementation(async ({ where }) =>
      where.invoiceNumber.startsWith === 'INV-CRS-202610'
        ? { invoiceNumber: 'INV-CRS-202610-00042' }
        : null
    );

    await enroll();

    expect(lookedUpPrefix()).toBe('INV-CRS-202611');
    expect(invoiceNumber()).toBe('INV-CRS-202611-00001');
  });

  it('continues the sequence of the WIB month it is in', async () => {
    vi.setSystemTime(new Date('2026-11-15T03:00:00.000Z'));
    tx.invoice.findFirst.mockResolvedValue({ invoiceNumber: 'INV-CRS-202611-00007' });

    await enroll();

    expect(invoiceNumber()).toBe('INV-CRS-202611-00008');
  });

  it('rolls the year with the WIB calendar on 1 January', async () => {
    vi.setSystemTime(new Date('2026-12-31T17:30:00.000Z')); // 1 Jan 2027 00:30 WIB
    tx.invoice.findFirst.mockResolvedValue(null);

    await enroll();

    expect(lookedUpPrefix()).toBe('INV-CRS-202701');
    expect(invoiceNumber()).toBe('INV-CRS-202701-00001');
  });
});

describe('course invoice dueDate is a date-only WIB day (#811)', () => {
  it('is midnight UTC of the WIB day 7 days out', async () => {
    // 20 Nov 2026 02:00 WIB (19 Nov 21:00 UTC). +7 days of wall clock is
    // 27 Nov 02:00 WIB — the WIB day is 27 November, and the column keeps that
    // day at midnight UTC, not the wall-clock instant.
    vi.setSystemTime(new Date('2026-11-19T21:00:00.000Z'));
    tx.invoice.findFirst.mockResolvedValue(null);

    await enroll();

    expect(invoiceDueDate().toISOString()).toBe('2026-11-27T00:00:00.000Z');
  });

  it('resolves the WIB day, not the UTC day, near midnight', async () => {
    // 1 Jan 2027 00:30 WIB (31 Dec 2026 17:30 UTC). +7 days is 8 Jan 00:30 WIB;
    // the UTC day of that instant is 7 Jan, so a UTC-day read would be wrong.
    vi.setSystemTime(new Date('2026-12-31T17:30:00.000Z'));
    tx.invoice.findFirst.mockResolvedValue(null);

    await enroll();

    expect(invoiceDueDate().toISOString()).toBe('2027-01-08T00:00:00.000Z');
  });
});
