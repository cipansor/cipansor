import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    murojaahRecord: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

import { prisma } from '@/lib/prisma';
import {
  createMurojaahSchema,
  listMurojaahQuerySchema,
  halaqohMurojaahQuerySchema,
  studentMurojaahSummarySchema,
} from '../murojaah.schema';
import { murojaahService } from '../murojaah.service';
import type { ScopeActor } from '@/utils/student-scope';

const mocked = prisma as unknown as {
  murojaahRecord: {
    create: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
};

const STUDENT_ID = '11111111-1111-4111-8111-111111111111';
const HALAQOH_ID = '22222222-2222-4222-8222-222222222222';
const UNIT_ID = '33333333-3333-4333-8333-333333333333';

/** A minimal valid create body, as the form sends it. */
const createBody = (murojaahDate: string) => ({
  studentId: STUDENT_ID,
  murojaahType: 'DAILY',
  murojaahDate,
  juzStart: 1,
  juzEnd: 1,
  pagesReviewed: 1,
  durationMinutes: 30,
  qualityScore: 80,
});

/**
 * The Tambah Murojaah form sends `murojaahDate` as the date picker writes it,
 * "2026-10-28", while `createMurojaahSchema` demanded `z.string().datetime()`
 * — so every create failed 400 before reaching the service. The list's
 * `dateFrom`/`dateTo` filter and the analytics endpoints had the same shape.
 * `murojaahDate` is a `@db.Date` column: a calendar day, not an instant.
 */
describe('murojaah date schemas', () => {
  it('accepts a date-only murojaahDate from the picker', () => {
    const parsed = createMurojaahSchema.parse(createBody('2026-10-28'));
    expect(parsed.murojaahDate).toBe('2026-10-28');
  });

  it('still accepts a full datetime', () => {
    const parsed = createMurojaahSchema.parse(createBody('2026-10-28T00:00:00.000Z'));
    expect(parsed.murojaahDate).toBe('2026-10-28T00:00:00.000Z');
  });

  it('rejects a value that is neither a date nor a datetime', () => {
    expect(() => createMurojaahSchema.parse(createBody('28-10-2026'))).toThrow();
    expect(() => createMurojaahSchema.parse(createBody('2026-13-40'))).toThrow();
  });

  it('accepts date-only dateFrom/dateTo on the list query', () => {
    const parsed = listMurojaahQuerySchema.parse({ dateFrom: '2026-10-01', dateTo: '2026-10-31' });
    expect(parsed.dateFrom).toBe('2026-10-01');
    expect(parsed.dateTo).toBe('2026-10-31');
  });

  it('accepts date-only dates on the halaqoh and student-summary queries', () => {
    const halaqoh = halaqohMurojaahQuerySchema.parse({
      halaqohId: HALAQOH_ID,
      dateFrom: '2026-10-01',
      dateTo: '2026-10-31',
    });
    expect(halaqoh.dateFrom).toBe('2026-10-01');

    const summary = studentMurojaahSummarySchema.parse({
      studentId: STUDENT_ID,
      startDate: '2026-10-01',
      endDate: '2026-10-31',
    });
    expect(summary.startDate).toBe('2026-10-01');
  });
});

/**
 * A calendar day and the same day sent as a datetime must land on the same
 * `@db.Date` value. The picker sends WIB midnight (`2026-10-27T17:00:00.000Z`),
 * whose UTC day is the day before — so the service must derive the WIB day, not
 * read the instant's UTC fields.
 */
describe('murojaahService date handling', () => {
  const actor: ScopeActor = { sub: 'user-1', roleCode: 'TEACHER', unitId: UNIT_ID };

  beforeEach(() => {
    vi.clearAllMocks();
    mocked.murojaahRecord.create.mockImplementation(async ({ data }: any) => ({
      id: 'r1',
      ...data,
    }));
    mocked.murojaahRecord.findMany.mockResolvedValue([]);
    mocked.murojaahRecord.count.mockResolvedValue(0);
  });

  it('stores a date-only murojaahDate as that calendar day', async () => {
    await murojaahService.create(createMurojaahSchema.parse(createBody('2026-10-28')), 'user-1');
    const stored = mocked.murojaahRecord.create.mock.calls[0][0].data.murojaahDate as Date;
    expect(stored.toISOString()).toBe('2026-10-28T00:00:00.000Z');
  });

  it('stores a WIB-midnight datetime as the same calendar day as the date-only form', async () => {
    await murojaahService.create(
      createMurojaahSchema.parse(createBody('2026-10-27T17:00:00.000Z')),
      'user-1'
    );
    const stored = mocked.murojaahRecord.create.mock.calls[0][0].data.murojaahDate as Date;
    expect(stored.toISOString()).toBe('2026-10-28T00:00:00.000Z');
  });

  it('bounds the list date filter by the calendar day, not the UTC instant', async () => {
    await murojaahService.findAll(
      listMurojaahQuerySchema.parse({ dateFrom: '2026-10-01', dateTo: '2026-10-31' }),
      actor
    );
    const where = mocked.murojaahRecord.findMany.mock.calls[0][0].where;
    expect((where.murojaahDate.gte as Date).toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect((where.murojaahDate.lte as Date).toISOString()).toBe('2026-10-31T00:00:00.000Z');
  });
});
