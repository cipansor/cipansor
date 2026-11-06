import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The "ujian mendatang" window is a WIB day window (utils/wib-day.ts). The
// container runs UTC, so a UTC-midnight lower bound was still yesterday for
// the first seven hours of a WIB day — an exam held yesterday stayed listed as
// upcoming until 07:00 WIB. These tests freeze the clock inside that window
// and assert the bounds the query is given.

vi.mock('@/lib/prisma', () => ({
  prisma: {
    simaanExam: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

import { prisma } from '@/lib/prisma';
import { simaanService } from '../simaan.service';

const findMany = vi.mocked(prisma.simaanExam.findMany);

/** The `examDate` bounds the service handed to Prisma. */
const bounds = () => {
  const args = findMany.mock.calls[0][0] as unknown as {
    where: { examDate: { gte: Date; lte: Date } };
  };
  return args.where.examDate;
};

describe('simaanService.getUpcomingExams — WIB day boundary', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    findMany.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('excludes yesterday (WIB) during 00:00–06:59 WIB', async () => {
    // 2026-11-05T19:00Z is 2026-11-06 02:00 WIB.
    vi.setSystemTime(new Date('2026-11-05T19:00:00.000Z'));

    await simaanService.getUpcomingExams(undefined, 7);

    const { gte, lte } = bounds();
    expect(gte.toISOString()).toBe('2026-11-06T00:00:00.000Z');
    // days=7 closes on the WIB day 7 ahead, inclusive.
    expect(lte.toISOString()).toBe('2026-11-13T00:00:00.000Z');
  });

  it('uses the same WIB day later in the day (control)', async () => {
    // 2026-11-06T05:00Z is 2026-11-06 12:00 WIB — same WIB day as above.
    vi.setSystemTime(new Date('2026-11-06T05:00:00.000Z'));

    await simaanService.getUpcomingExams(undefined, 7);

    const { gte, lte } = bounds();
    expect(gte.toISOString()).toBe('2026-11-06T00:00:00.000Z');
    expect(lte.toISOString()).toBe('2026-11-13T00:00:00.000Z');
  });

  it('rolls the lower bound to the new WIB day just after midnight', async () => {
    // 2026-11-05T17:30Z is 2026-11-06 00:30 WIB.
    vi.setSystemTime(new Date('2026-11-05T17:30:00.000Z'));

    await simaanService.getUpcomingExams(undefined, 1);

    const { gte, lte } = bounds();
    expect(gte.toISOString()).toBe('2026-11-06T00:00:00.000Z');
    expect(lte.toISOString()).toBe('2026-11-07T00:00:00.000Z');
  });

  it('passes halaqohId through when given', async () => {
    vi.setSystemTime(new Date('2026-11-05T19:00:00.000Z'));

    await simaanService.getUpcomingExams('halaqoh-1', 7);

    expect(findMany.mock.calls[0][0]?.where).toMatchObject({ halaqohId: 'halaqoh-1' });
  });
});
