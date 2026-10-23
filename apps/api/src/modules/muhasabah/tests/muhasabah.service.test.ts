import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { muhasabahService } from '../muhasabah.service';
import { prisma } from '@/lib/prisma';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    dailyMuhasabah: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
    },
  },
}));

/**
 * "Hari muhasabah" mengikuti kalender WIB (Asia/Jakarta, UTC+7), bukan jam
 * host. Kontainer API tidak menyetel `TZ`, jadi `setHours(0, 0, 0, 0)` di
 * sana membulatkan ke tengah malam *UTC*: catatan yang diisi pukul 05:00 WIB
 * tersimpan pada hari kemarin. Kolom `DailyMuhasabah.date` bertipe `@db.Date`
 * dan Prisma membacanya sebagai instan tengah malam UTC, jadi nilainya harus
 * dibangun lewat `dayOf(todayWib())`.
 *
 * Berkas ini mengunci instan seperti dilaporkan di issue #888.
 */
describe('muhasabahService — kalender WIB', () => {
  const previousTz = process.env.TZ;

  beforeAll(() => {
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
  });

  // 23 Okt 2026 05:00 WIB — server UTC masih 22 Okt.
  const JAKARTA_EARLY_MORNING = '2026-10-22T22:00:00.000Z';
  const WIB_DAY = new Date('2026-10-23T00:00:00.000Z');

  it('create menyimpan hari WIB, bukan hari UTC', async () => {
    vi.setSystemTime(new Date(JAKARTA_EARLY_MORNING));
    vi.mocked(prisma.dailyMuhasabah.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.dailyMuhasabah.create).mockResolvedValue({ id: 'm1' } as any);

    await muhasabahService.create({ studentId: 's1', date: '2026-10-23' } as any);

    expect(vi.mocked(prisma.dailyMuhasabah.create).mock.calls[0][0].data.date).toEqual(WIB_DAY);
  });

  it('create memeriksa hari yang sama sebelum menulis (kunci studentId_date)', async () => {
    vi.setSystemTime(new Date(JAKARTA_EARLY_MORNING));
    vi.mocked(prisma.dailyMuhasabah.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.dailyMuhasabah.create).mockResolvedValue({ id: 'm1' } as any);

    await muhasabahService.create({ studentId: 's1', date: '2026-10-23' } as any);

    expect(vi.mocked(prisma.dailyMuhasabah.findUnique).mock.calls[0][0].where).toEqual({
      studentId_date: { studentId: 's1', date: WIB_DAY },
    });
  });

  it('getDailyReport menyaring hari WIB yang diminta', async () => {
    vi.setSystemTime(new Date(JAKARTA_EARLY_MORNING));
    vi.mocked(prisma.dailyMuhasabah.findMany).mockResolvedValue([]);

    const report = await muhasabahService.getDailyReport('2026-10-23');

    expect((vi.mocked(prisma.dailyMuhasabah.findMany).mock.calls[0][0] as any).where.date).toEqual(
      WIB_DAY
    );
    expect(report.date).toEqual(WIB_DAY);
  });

  it('nilai tersimpan sama di server UTC maupun WIB', async () => {
    vi.setSystemTime(new Date(JAKARTA_EARLY_MORNING));
    vi.mocked(prisma.dailyMuhasabah.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.dailyMuhasabah.create).mockResolvedValue({ id: 'm1' } as any);

    process.env.TZ = 'UTC';
    await muhasabahService.create({ studentId: 's1', date: '2026-10-23' } as any);
    const onUtcServer = vi.mocked(prisma.dailyMuhasabah.create).mock.calls[0][0].data.date;

    process.env.TZ = 'Asia/Jakarta';
    await muhasabahService.create({ studentId: 's1', date: '2026-10-23' } as any);
    const onWibServer = vi.mocked(prisma.dailyMuhasabah.create).mock.calls[1][0].data.date;

    process.env.TZ = 'UTC';
    expect(onUtcServer).toEqual(WIB_DAY);
    expect(onWibServer).toEqual(WIB_DAY);
  });
});
