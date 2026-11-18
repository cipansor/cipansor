/**
 * The "Bulan ini" card on /announcements counts announcements of the WIB
 * calendar month, not of the UTC month.
 *
 * `stats` built its lower bound with `new Date(now.getFullYear(),
 * now.getMonth(), 1)`. The container runs UTC, so that constructor produced
 * midnight UTC — 07:00 WIB on the 1st — and, on the first morning of the month
 * (the UTC clock still on the previous month, and in January on the previous
 * year), it read the *previous* month. So an announcement published 00:00–06:59
 * WIB on the 1st fell out of "Bulan ini", and on the morning of the 1st the
 * window held the whole month before. Same defect class as the dashboard
 * periods (#1126/#1091/#955).
 *
 * `Announcement.createdAt` is a real `DateTime` column, so its lower bound must
 * be a WIB instant (17:00Z the day before).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    announcement: { count: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/modules/notifications', () => ({
  announcementDeliveryCounts: vi.fn(),
  deliverAnnouncement: vi.fn(),
  reviseAnnouncementDelivery: vi.fn(),
  withdrawAnnouncementDelivery: vi.fn(),
}));
vi.mock('@/modules/dormitories', () => ({ boardersOfMusyrif: vi.fn() }));

import { stats } from '../announcements.service';

const tu = { sub: 'tu-1', roleCode: 'SDIT_TATA_USAHA', unitId: 'unit-sd' };

/** The `createdAt.gte` the "Bulan ini" count was given. */
const thisMonthSince = (): Date => {
  const call = prismaMock.announcement.count.mock.calls.find(
    (c) => c[0]?.where?.AND?.[1]?.createdAt?.gte
  );
  return call![0].where.AND[1].createdAt.gte as Date;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  prismaMock.announcement.count.mockResolvedValue(0);
  prismaMock.user.findUnique.mockResolvedValue({
    unitId: 'unit-sd',
    userRoles: [],
    student: null,
    parentOf: [],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the "Bulan ini" card bounds its month on the WIB calendar', () => {
  it('uses the WIB month start on the first morning of the month (1 Nov 02:00 WIB)', async () => {
    // 1 Nov 2026 02:00 WIB = 31 Oct 2026 19:00Z; the UTC clock is still October.
    vi.setSystemTime(new Date('2026-10-31T19:00:00.000Z'));

    await stats(tu);

    // 1 Nov 2026 00:00 WIB = 31 Oct 17:00Z. The old constructor read the UTC
    // fields (still October) and produced 1 Oct.
    expect(thisMonthSince().toISOString()).toBe('2026-10-31T17:00:00.000Z');
  });

  it('keeps an early-morning announcement on the 1st inside "Bulan ini"', async () => {
    // Mid-month read: 15 Nov 2026 10:00 WIB = 15 Nov 03:00Z.
    vi.setSystemTime(new Date('2026-11-15T03:00:00.000Z'));

    await stats(tu);

    const since = thisMonthSince();
    // An announcement published 1 Nov 2026 03:00 WIB (31 Oct 20:00Z) is >= the
    // WIB month start. The old bound (1 Nov 00:00Z = 07:00 WIB) excluded it.
    const early = new Date('2026-10-31T20:00:00.000Z');
    expect(since.toISOString()).toBe('2026-10-31T17:00:00.000Z');
    expect(early.getTime()).toBeGreaterThanOrEqual(since.getTime());
  });

  it('does not read the previous month on the first morning of January (1 Jan 00:30 WIB)', async () => {
    // 1 Jan 2027 00:30 WIB = 31 Dec 2026 17:30Z; the UTC clock is still 2026.
    vi.setSystemTime(new Date('2026-12-31T17:30:00.000Z'));

    await stats(tu);

    // 1 Jan 2027 00:00 WIB = 31 Dec 2026 17:00Z. The old constructor read the
    // UTC year (2026) and jumped to 1 Jan 2026.
    expect(thisMonthSince().toISOString()).toBe('2026-12-31T17:00:00.000Z');
  });
});
