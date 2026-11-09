import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UserRole } from '@prisma/client';

vi.mock('../../../lib/prisma', () => ({
  prisma: {
    mealMenu: { findMany: vi.fn() },
  },
}));

import { prisma } from '../../../lib/prisma';
import { mealsService } from '../meals.service';

const UNIT = 'unit-sd';

const admin = {
  sub: 'user-1',
  role: UserRole.SUPER_ADMIN,
  roleCode: 'SUPER_ADMIN',
  unitId: null,
};

/** `where.date` as the `@db.Date` column holds it: midnight UTC of the day. */
const queriedDay = (): string => {
  const call = vi.mocked(prisma.mealMenu.findMany).mock.calls[0][0];
  return (call!.where as { date: Date }).date.toISOString().slice(0, 10);
};

describe('mealsService.getTodayMenu — mencari hari kalender WIB', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(prisma.mealMenu.findMany).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('memakai hari WIB saat 06:00 WIB, ketika di server masih hari UTC sebelumnya', async () => {
    // 2026-10-26T23:00Z = 27 Oktober 2026, 06:00 WIB.
    vi.setSystemTime(new Date('2026-10-26T23:00:00.000Z'));

    await mealsService.getTodayMenu(UNIT, admin);

    expect(queriedDay()).toBe('2026-10-27');
  });

  it('memakai hari WIB saat 00:30 WIB', async () => {
    // 2026-10-26T17:30Z = 27 Oktober 2026, 00:30 WIB.
    vi.setSystemTime(new Date('2026-10-26T17:30:00.000Z'));

    await mealsService.getTodayMenu(UNIT, admin);

    expect(queriedDay()).toBe('2026-10-27');
  });

  it('memakai hari WIB saat tengah hari WIB', async () => {
    // 2026-10-27T05:00Z = 27 Oktober 2026, 12:00 WIB.
    vi.setSystemTime(new Date('2026-10-27T05:00:00.000Z'));

    await mealsService.getTodayMenu(UNIT, admin);

    expect(queriedDay()).toBe('2026-10-27');
  });

  it('tetap mencari tanggal yang sama pada hari yang sama', async () => {
    // 2026-10-27T16:59Z = 27 Oktober 2026, 23:59 WIB.
    vi.setSystemTime(new Date('2026-10-27T16:59:00.000Z'));

    await mealsService.getTodayMenu(UNIT, admin);

    expect(queriedDay()).toBe('2026-10-27');
  });

  it('menolak unit yang bukan milik pengguna', async () => {
    vi.setSystemTime(new Date('2026-10-27T05:00:00.000Z'));
    const unitAdmin = {
      sub: 'user-2',
      role: UserRole.UNIT_ADMIN,
      roleCode: 'UNIT_ADMIN',
      unitId: 'unit-smp',
    };

    await expect(mealsService.getTodayMenu(UNIT, unitAdmin)).rejects.toThrow('Access denied');
    expect(prisma.mealMenu.findMany).not.toHaveBeenCalled();
  });
});
