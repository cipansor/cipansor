/**
 * Takhosus murojaah dates are stored as the WIB calendar day (#1152 review).
 *
 * `MurojaahRecord.murojaahDate` is a `@db.Date` column and `getQuickStats`
 * counts the WIB day. The Takhosus writer used `new Date(value)` directly, so a
 * record sent as 00:30 WIB (still the previous UTC day) was filed under
 * yesterday and never counted today.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    takhosusEnrollment: { findUnique: vi.fn() },
    murojaahRecord: { create: vi.fn(), update: vi.fn() },
    murojaahMistake: { deleteMany: vi.fn() },
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { murojaahService } from '../murojaah.service';
import { createMurojaahSchema } from '../takhosus.schema';

const baseInput = {
  studentId: 'student-1',
  murojaahType: 'YAUMIYAH',
  juzStart: 1,
  juzEnd: 1,
  pagesReviewed: 2,
  durationMinutes: 30,
  qualityScore: 80,
  fluencyLevel: 3,
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.takhosusEnrollment.findUnique.mockResolvedValue(null);
  prismaMock.murojaahRecord.create.mockImplementation(async (args: { data: unknown }) => args.data);
  prismaMock.murojaahRecord.update.mockImplementation(async (args: { data: unknown }) => args.data);
});

describe('takhosus murojaahDate — stored as the WIB day', () => {
  it('files a 00:30 WIB create under that WIB day, not the previous UTC day', async () => {
    await murojaahService.create(
      { ...baseInput, murojaahDate: '2026-10-26T17:30:00.000Z' } as never,
      'teacher-1'
    );

    const data = prismaMock.murojaahRecord.create.mock.calls[0][0].data as {
      murojaahDate: Date;
    };
    expect(data.murojaahDate).toEqual(new Date('2026-10-27T00:00:00.000Z'));
  });

  it('files a 06:59 WIB update under that WIB day, not the previous UTC day', async () => {
    await murojaahService.update('murojaah-1', {
      murojaahDate: '2026-10-26T23:59:00.000Z',
    } as never);

    const data = prismaMock.murojaahRecord.update.mock.calls[0][0].data as {
      murojaahDate: Date;
    };
    expect(data.murojaahDate).toEqual(new Date('2026-10-27T00:00:00.000Z'));
  });

  it('leaves an already-midnight WIB instant on its own day', async () => {
    await murojaahService.create(
      { ...baseInput, murojaahDate: '2026-10-26T17:00:00.000Z' } as never,
      'teacher-1'
    );

    const data = prismaMock.murojaahRecord.create.mock.calls[0][0].data as {
      murojaahDate: Date;
    };
    expect(data.murojaahDate).toEqual(new Date('2026-10-27T00:00:00.000Z'));
  });
});

describe('takhosus murojaahDate — the route schema format', () => {
  const valid = {
    studentId: '11111111-1111-4111-8111-111111111111',
    teacherId: '22222222-2222-4222-8222-222222222222',
    murojaahDate: '2026-10-26T17:30:00.000Z',
    murojaahType: 'YAUMIYAH',
    juzStart: 1,
    juzEnd: 1,
    pagesReviewed: 2,
    durationMinutes: 30,
    qualityScore: 80,
    fluencyLevel: 3,
  };

  it('accepts the UTC instant the form sends for 00:30 WIB', () => {
    expect(createMurojaahSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects a +07:00 offset the form never sends', () => {
    expect(
      createMurojaahSchema.safeParse({
        ...valid,
        murojaahDate: '2026-10-27T00:30:00+07:00',
      }).success
    ).toBe(false);
  });
});
