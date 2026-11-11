import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Prisma } from '@prisma/client';

/**
 * `getSppMatrix` reads `Invoice.dueDate`, a date-only column kept at midnight
 * UTC (#811). Its year bounds and its month read must therefore use the UTC
 * calendar: a server-local `new Date(year, …)` bounds the year in the server's
 * zone and `getMonth()` reads the column there, so on a server west of UTC the
 * 31 December invoice falls out of the year and the matrix loses its last
 * month. These cases run under a non-UTC `TZ` and assert both the bounds handed
 * to Prisma and the month each invoice lands in.
 */

const mockPrisma = vi.hoisted(() => ({
  student: { findMany: vi.fn() },
  paymentType: { findFirst: vi.fn() },
  invoice: { findMany: vi.fn() },
}));

vi.mock('../../../lib/prisma', () => ({ prisma: mockPrisma }));

import { getSppMatrix } from '../finance.service';

const student = {
  id: 'stud-1',
  nis: '2024001',
  user: { id: 'u1', name: 'Santri Satu' },
  enrollments: [{ class: { id: 'c1', name: '6A' } }],
};

const invoice = (dueDate: string, id = 'inv') => ({
  id,
  studentId: student.id,
  dueDate: new Date(dueDate),
  status: 'PENDING',
  amount: new Prisma.Decimal(250000),
  paidAmount: new Prisma.Decimal(0),
});

const prevTz = process.env.TZ;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TZ = 'America/New_York'; // UTC-5: a server west of WIB
  mockPrisma.student.findMany.mockResolvedValue([student]);
  mockPrisma.paymentType.findFirst.mockResolvedValue({
    id: 'pt-spp',
    amount: new Prisma.Decimal(250000),
  });
  mockPrisma.invoice.findMany.mockResolvedValue([]);
});

afterEach(() => {
  if (prevTz === undefined) delete process.env.TZ;
  else process.env.TZ = prevTz;
});

describe('getSppMatrix — date-only dueDate on the UTC calendar', () => {
  it('bounds the year at midnight UTC, not on the server clock', async () => {
    await getSppMatrix({ year: 2026 });

    const where = mockPrisma.invoice.findMany.mock.calls[0][0].where;
    expect(where.dueDate.gte.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    // `[start, end)` — exclusive upper bound keeps a 31 Dec invoice in the year
    // even though a server-local 31 Dec 23:59:59 bound would read it a day late.
    expect(where.dueDate.lt.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('places a 1 January invoice in the January column', async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([invoice('2027-01-01T00:00:00.000Z')]);

    const result = await getSppMatrix({ year: 2027 });

    expect(result.students[0].months.Jan.status).toBe('PENDING');
    expect(result.students[0].months.Feb.status).toBe('NOT_BILLED');
  });

  it('places a 31 December invoice in the December column', async () => {
    mockPrisma.invoice.findMany.mockResolvedValue([invoice('2026-12-31T00:00:00.000Z')]);

    const result = await getSppMatrix({ year: 2026 });

    expect(result.students[0].months.Dec.status).toBe('PENDING');
    expect(result.students[0].months.Dec.dueDate).toBe('2026-12-31T00:00:00.000Z');
  });
});
