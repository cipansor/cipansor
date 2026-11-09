import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    guestBook: { count: vi.fn(), findMany: vi.fn() },
    studentVisit: { count: vi.fn(), findMany: vi.fn() },
    studentPackage: { count: vi.fn() },
  },
}));

import { prisma } from '@/lib/prisma';
import * as service from '../reception.service';

/**
 * Kartu "Tamu Hari Ini" (dan penyaring tanggal buku tamu / kunjungan) harus
 * memakai kalender WIB (Asia/Jakarta, UTC+7), bukan jam host. Kontainer API
 * berjalan tanpa `TZ`, yaitu UTC, jadi `new Date().setHours(0, 0, 0, 0)`
 * membatasi hari **UTC**: tiap pagi pukul 00:00-06:59 WIB resepsionis menghitung
 * tamu hari kemarin. Instan di bawah dikunci seperti dilaporkan di issue #891.
 */
describe('ReceptionService - jendela hari WIB', () => {
  const previousTz = process.env.TZ;

  beforeAll(() => {
    // Produksi menjalankan kontainer tanpa TZ, yaitu UTC. Paksa itu di sini
    // supaya tes gagal andai kode kembali membaca zona host.
    process.env.TZ = 'UTC';
    vi.useFakeTimers({ toFake: ['Date'] });
  });

  afterAll(() => {
    vi.useRealTimers();
    if (previousTz === undefined) delete process.env.TZ;
    else process.env.TZ = previousTz;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.guestBook.count).mockResolvedValue(0);
    vi.mocked(prisma.studentVisit.count).mockResolvedValue(0);
    vi.mocked(prisma.studentPackage.count).mockResolvedValue(0);
    vi.mocked(prisma.guestBook.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.studentVisit.findMany).mockResolvedValue([] as never);
  });

  // 1 Nov 2026 00:00 WIB - server UTC masih 31 Okt 17:00.
  const WIB_DAY_START = '2026-10-31T17:00:00.000Z';
  // 1 Nov 2026 23:59:59.999 WIB - server UTC masih 1 Nov 16:59.
  const WIB_DAY_END = '2026-11-01T16:59:59.999Z';

  const checkInWindow = (mock: { mock: { calls: unknown[][] } }) =>
    (mock.mock.calls[0][0] as { where: { checkIn: { gte: Date; lte: Date } } }).where.checkIn;

  describe('getStats.guestsToday', () => {
    it('menghitung hari WIB saat server masih di hari UTC kemarin', async () => {
      // 1 Nov 2026 01:30 WIB - jendela bug: UTC membaca 31 Okt.
      vi.setSystemTime(new Date('2026-10-31T18:30:00Z'));

      await service.getStats('unit-1');

      const { gte, lte } = checkInWindow(vi.mocked(prisma.guestBook.count));
      expect(gte.toISOString()).toBe(WIB_DAY_START);
      expect(lte.toISOString()).toBe(WIB_DAY_END);
      // Jendela lama adalah tengah malam UTC 31 Okt - tepat sehari kemarin.
      expect(gte.toISOString()).not.toBe('2026-10-31T00:00:00.000Z');
    });

    it('memakai hari WIB yang sama sepanjang hari itu', async () => {
      vi.setSystemTime(new Date('2026-11-01T10:00:00Z')); // 1 Nov 17:00 WIB

      await service.getStats('unit-1');

      const { gte, lte } = checkInWindow(vi.mocked(prisma.guestBook.count));
      expect(gte.toISOString()).toBe(WIB_DAY_START);
      expect(lte.toISOString()).toBe(WIB_DAY_END);
    });

    it('menjaga angka non-tamu tetap apa adanya', async () => {
      vi.setSystemTime(new Date('2026-11-01T10:00:00Z'));

      await service.getStats('unit-1');

      expect(prisma.studentVisit.count).toHaveBeenCalledWith({
        where: { unitId: 'unit-1', status: { in: ['PENDING', 'APPROVED'] } },
      });
      expect(prisma.studentPackage.count).toHaveBeenCalledWith({
        where: { unitId: 'unit-1', status: 'RECEIVED' },
      });
    });
  });

  describe('getGuestBooks ?date=', () => {
    it('membaca tanggal picker sebagai hari WIB, bukan tengah malam host', async () => {
      await service.getGuestBooks('unit-1', { date: '2026-11-01' });

      const { gte, lte } = checkInWindow(vi.mocked(prisma.guestBook.findMany));
      expect(gte.toISOString()).toBe(WIB_DAY_START);
      expect(lte.toISOString()).toBe(WIB_DAY_END);
    });

    it('mengubah instan penuh menjadi hari WIB tempat ia jatuh', async () => {
      // 1 Nov 2026 01:30 WIB - instan ini milik 1 Nov WIB, bukan 31 Okt.
      await service.getGuestBooks('unit-1', { date: '2026-10-31T18:30:00Z' });

      const { gte } = checkInWindow(vi.mocked(prisma.guestBook.findMany));
      expect(gte.toISOString()).toBe(WIB_DAY_START);
    });

    it('tidak menyaring tanggal bila tidak diminta', async () => {
      await service.getGuestBooks('unit-1', {});

      const where = (vi.mocked(prisma.guestBook.findMany).mock.calls[0][0] as { where: object })
        .where;
      expect(where).not.toHaveProperty('checkIn');
    });
  });

  describe('getStudentVisits ?date=', () => {
    it('memakai jendela hari WIB yang sama', async () => {
      await service.getStudentVisits('unit-1', { date: '2026-11-01' });

      const { gte, lte } = checkInWindow(vi.mocked(prisma.studentVisit.findMany));
      expect(gte.toISOString()).toBe(WIB_DAY_START);
      expect(lte.toISOString()).toBe(WIB_DAY_END);
    });
  });
});
