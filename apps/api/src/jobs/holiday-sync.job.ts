import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { syncConfiguredHolidays } from '@/modules/calendar/holiday-sync.service';

/**
 * Tarik libur nasional ke kalender — sebulan sekali, tanggal 1 pukul 05:00 WIB.
 *
 * Sumbernya API publik (pengaturan `HOLIDAY_SYNC`), jadi hasilnya DISIMPAN ke
 * `CalendarEvent` sebagai **draf**, bukan dibaca saat dibutuhkan. Draf belum
 * menjadi hari libur: absensi dan penggajian mengabaikannya sampai admin
 * menyetujuinya, karena sumber pihak ketiga tidak boleh diam-diam mengubah hari
 * kerja. Kalau sumbernya mati, kalender yang sudah ada tetap dipakai dan tidak
 * ada hari libur yang berubah menjadi Alpa.
 *
 * Tanggal 1 dipilih karena `api-hari-libur` memperbarui datanya tiap tanggal 1:
 * menariknya lebih sering hanya membaca data yang sama. Idempoten — libur yang
 * sudah ada dilewati, jadi menjalankannya berkali-kali tidak menggandakan apa
 * pun.
 */
export async function runHolidaySync(): Promise<{ created: number } | null> {
  const actor = await prisma.user.findFirst({
    where: { deletedAt: null, roleAssignments: { some: { role: { code: 'SUPER_ADMIN' } } } },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!actor) {
    // No super admin to attribute the calendar rows to. Skipping is correct:
    // the calendar is still usable, and inventing an author would put a name
    // on a row nobody chose.
    logger.warn('[HolidaySync] No SUPER_ADMIN to attribute holiday events to; skipping');
    return null;
  }

  const { ran, results } = await syncConfiguredHolidays(actor.id);
  if (!ran) {
    logger.info('[HolidaySync] Disabled by configuration; skipping');
    return null;
  }
  const created = results.reduce((sum, r) => sum + r.created, 0);
  logger.info(
    `[HolidaySync] ${created} holiday(s) added from ${results.length} year(s): ` +
      results.map((r) => `${r.year}=${r.entries}`).join(', ')
  );
  return { created };
}
