import { describe, it, expect, vi } from 'vitest';

/**
 * Perilaku pekerjaan diuji di `registrant-retention.job.test.ts`; berkas ini
 * hanya memastikan **jadwalnya benar-benar terpasang**. Tanpa uji ini, fungsi
 * yang benar tetapi tidak pernah dipanggil penjadwal akan lulus seluruh uji
 * perilaku sambil tidak menghapus apa pun di produksi — persis kegagalan yang
 * membuat retensi absensi dan status gelombang SPMB pernah tidak berjalan.
 */
const { schedule, purgeExpiredRegistrants } = vi.hoisted(() => ({
  schedule: vi.fn(() => ({ stop: vi.fn() })),
  purgeExpiredRegistrants: vi.fn(async () => ({
    dryRun: false,
    expired: [],
    deleted: [],
    failed: [],
    withheld: 0,
  })),
}));

vi.mock('node-cron', () => ({ default: { schedule } }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('./registrant-retention.job', () => ({ purgeExpiredRegistrants }));

import { initializeScheduler } from './scheduler';

type Call = [string, () => Promise<void>, { timezone: string }];

describe('jadwal retensi pendaftar SPMB', () => {
  it('terpasang harian pukul 03.30 WIB, sesudah retensi absensi', () => {
    initializeScheduler();

    const calls = schedule.mock.calls as unknown as Call[];
    const entries = calls.filter(
      ([expr, , options]) => expr === '30 3 * * *' && options.timezone === 'Asia/Jakarta'
    );

    expect(entries).toHaveLength(1);
  });

  it('menjalankan penyapuan saat jadwalnya tiba, dan tidak melempar bila gagal', async () => {
    initializeScheduler();

    const calls = schedule.mock.calls as unknown as Call[];
    const [, run] = calls.find(([expr]) => expr === '30 3 * * *')!;

    await run();
    expect(purgeExpiredRegistrants).toHaveBeenCalledTimes(1);

    // Kegagalan penyapuan dicatat, bukan dibiarkan naik ke penjadwal: satu
    // malam gagal tidak boleh mematikan jadwal malam berikutnya.
    purgeExpiredRegistrants.mockRejectedValueOnce(new Error('database sibuk'));
    await expect(run()).resolves.toBeUndefined();
  });
});
