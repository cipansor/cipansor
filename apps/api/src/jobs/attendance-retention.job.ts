/**
 * Retensi absensi pegawai — tiap hari pukul 03.15 WIB.
 *
 * Selfie dan koordinat adalah data pribadi spesifik (UU 27/2022 Ps. 4); Pasal 42
 * mewajibkan pemrosesan berakhir saat masa retensi tercapai. Tanpa pekerjaan ini
 * pengaturan retensi hanya angka di layar: foto tersimpan selamanya.
 *
 * 03.15 dipilih di celah yang kosong — snapshot harian 01.00, ringkasan mingguan
 * 02.00, penyapuan KTP 02.30, pembersihan snapshot 03.00. Pekerjaannya ringan
 * (kueri berindeks) dan idempoten.
 */

import { logger } from '@/lib/logger';
import { enforceAttendanceRetention } from '@/modules/hr/hr.service';

export async function runAttendanceRetention(now = new Date()): Promise<{
  photosErased: number;
  recordsDeleted: number;
}> {
  const result = await enforceAttendanceRetention(now);
  if (result.photosErased || result.recordsDeleted) {
    logger.info(
      `[AttendanceRetention] Erased ${result.photosErased} photo(s), ` +
        `deleted ${result.recordsDeleted} record(s) past their window`
    );
  }
  return result;
}
