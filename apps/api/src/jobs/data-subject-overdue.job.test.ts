import { describe, it, expect, vi, beforeEach } from 'vitest';

// Pengingat tenggat: satu pesan per permintaan per petugas per hari, dan tidak
// ada satu pun ketika tidak ada permintaan yang lewat tenggat atau tidak ada
// petugas pemegang PDP_MANAGE.

vi.mock('@/lib/prisma', () => ({
  prisma: {
    dataSubjectRequest: { findMany: vi.fn() },
    role: { findMany: vi.fn() },
    userRoleAssignment: { findMany: vi.fn() },
  },
}));
vi.mock('@/modules/notifications', () => ({ createNotification: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { prisma } from '@/lib/prisma';
import { createNotification } from '@/modules/notifications';
import { DSR_LIST_LINK, runDataSubjectOverdueReminder } from './data-subject-overdue.job';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.role.findMany).mockResolvedValue([{ id: 'role-1' }] as any);
  vi.mocked(prisma.userRoleAssignment.findMany).mockResolvedValue([
    { userId: 'officer-1' },
    { userId: 'officer-2' },
  ] as any);
  vi.mocked(createNotification).mockResolvedValue({} as never);
});

const overdueRow = {
  id: 'dsr-1',
  requestNo: 'DSR-2026-0001',
  dueAt: new Date('2026-11-18T00:00:00.000Z'),
};

describe('runDataSubjectOverdueReminder', () => {
  it('mengingatkan setiap petugas sekali per permintaan, dengan tautan daftar', async () => {
    vi.mocked(prisma.dataSubjectRequest.findMany).mockResolvedValue([overdueRow] as any);

    const result = await runDataSubjectOverdueReminder(new Date('2026-11-20T00:00:00.000Z'));

    expect(result).toEqual({ overdue: 1, reminded: 2 });
    expect(createNotification).toHaveBeenCalledTimes(2);
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'officer-1',
        type: 'REMINDER',
        priority: 'HIGH',
        link: DSR_LIST_LINK,
        // Satu pengingat per permintaan per petugas per hari.
        dedupeKey: 'dsr-overdue:dsr-1:officer-1:2026-11-20',
      })
    );
    expect(DSR_LIST_LINK).toBe('/settings/permintaan-data');
  });

  it('tidak mengirim apa pun ketika tidak ada yang lewat tenggat', async () => {
    vi.mocked(prisma.dataSubjectRequest.findMany).mockResolvedValue([] as any);

    expect(await runDataSubjectOverdueReminder()).toEqual({ overdue: 0, reminded: 0 });
    expect(createNotification).not.toHaveBeenCalled();
    // Tidak ada pekerjaan, jadi tidak ada alasan menyentuh tabel peran.
    expect(prisma.role.findMany).not.toHaveBeenCalled();
  });

  it('melaporkan permintaan terlambat walau tidak ada petugas yang dapat diingatkan', async () => {
    vi.mocked(prisma.dataSubjectRequest.findMany).mockResolvedValue([overdueRow] as any);
    vi.mocked(prisma.role.findMany).mockResolvedValue([] as any);

    expect(await runDataSubjectOverdueReminder()).toEqual({ overdue: 1, reminded: 0 });
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('tidak menghitung pengiriman yang gagal sebagai terkirim', async () => {
    vi.mocked(prisma.dataSubjectRequest.findMany).mockResolvedValue([overdueRow] as any);
    vi.mocked(createNotification).mockRejectedValueOnce(new Error('smtp down'));

    expect(await runDataSubjectOverdueReminder()).toEqual({ overdue: 1, reminded: 1 });
  });
});
