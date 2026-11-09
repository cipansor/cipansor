import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The daily snapshot runs at 01:00 WIB, which is 18:00 UTC the day before in
// the UTC container. `periodDate` is a @db.Date column, so it must carry the
// WIB calendar day the snapshot represents — not the server's UTC day.

const upsert = vi.fn(async (_args: unknown) => ({}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    unit: { findMany: vi.fn(async () => [{ id: 'unit-sd', name: 'SD IT' }]) },
    academicYear: { findFirst: vi.fn(async () => ({ id: 'ay-2026' })) },
    dashboardMetricSnapshot: { upsert: (args: unknown) => upsert(args) },
  },
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const getOverview = vi.fn(async (_args: unknown) => ({
  students: { total: 10, active: 9, inactive: 1 },
  attendance: { rate: 0.9, total: 10, present: 9 },
  tahfidz: { avgScore: 80, totalRecords: 1, totalAyah: 5 },
  murojaah: { avgQuality: 75, totalRecords: 1, totalPages: 2 },
  simaan: { passRate: 0.5, totalExams: 2, passedExams: 1 },
  teachers: { total: 4 },
  classes: { total: 3 },
}));
vi.mock('@/modules/dashboard-enhancement/dashboard.service', () => ({
  dashboardService: { getOverview: (args: unknown) => getOverview(args) },
}));

import { createDailySnapshots } from './dashboard-snapshot.job';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createDailySnapshots', () => {
  it('stamps periodDate with the WIB day, not the UTC day', async () => {
    // 1 Nov 2026 01:00 WIB is 31 Oct 2026 18:00 UTC — the scheduled run time.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-31T18:00:00.000Z'));

    await createDailySnapshots();

    expect(upsert).toHaveBeenCalled();
    const first = vi.mocked(upsert).mock.calls[0][0] as {
      create: { periodDate: Date; periodType: string };
      where: { unitId_metricType_periodType_periodDate: { periodDate: Date } };
    };
    expect(first.create.periodDate.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(first.where.unitId_metricType_periodType_periodDate.periodDate.toISOString()).toBe(
      '2026-11-01T00:00:00.000Z'
    );
    expect(first.create.periodType).toBe('DAILY');
  });

  it('stamps the same WIB day for every metric of the unit', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-31T18:00:00.000Z'));

    await createDailySnapshots();

    const dates = vi
      .mocked(upsert)
      .mock.calls.map((c) => (c[0] as { create: { periodDate: Date } }).create.periodDate);
    expect(dates.length).toBeGreaterThan(0);
    for (const d of dates) {
      expect(d.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    }
  });

  it('stamps the WIB month when the UTC day is still in the previous month', async () => {
    // 1 Dec 2026 01:00 WIB is 30 Nov 2026 18:00 UTC — the UTC stamp would file
    // the snapshot under November.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-30T18:00:00.000Z'));

    await createDailySnapshots();

    const first = vi.mocked(upsert).mock.calls[0][0] as { create: { periodDate: Date } };
    expect(first.create.periodDate.toISOString()).toBe('2026-12-01T00:00:00.000Z');
  });
});
