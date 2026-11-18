/**
 * Pengingat tenggat permintaan hak subjek data (UU 27/2022 Pasal 30, 32, 40, 43).
 *
 * Halaman daftar punya `overdueOnly`, tetapi itu hanya penyaring BACAAN: tenggat
 * tidak pernah memicu apa pun dengan sendirinya, sehingga permintaan yang lewat
 * 3×24 jam hanya terlihat kalau kebetulan ada petugas membuka daftarnya.
 *
 * Pekerjaan ini menutup celah itu: setiap pagi ia mencari permintaan yang belum
 * selesai dan tenggatnya sudah lewat, lalu mengingatkan petugas pelindungan data
 * pribadi — yaitu pemegang izin `PDP_MANAGE`, yang penunjukannya tidak mengikuti
 * jabatan (Pasal 53). Satu pengingat per permintaan per hari, dijaga `dedupeKey`,
 * supaya daftar yang menumpuk selama seminggu tidak menjadi tujuh kali pesan.
 */

import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { pdpOfficerUserIds } from '@/lib/pdp-officers';
import { createNotification } from '@/modules/notifications';

/** Status yang mengakhiri alur; pengingat tidak berlaku lagi setelahnya. */
const CLOSED = ['COMPLETED', 'REJECTED'] as const;

/** Tautan yang dibuka petugas dari notifikasi. */
export const DSR_LIST_LINK = '/settings/permintaan-data';

export { pdpOfficerUserIds };

export async function runDataSubjectOverdueReminder(
  now = new Date()
): Promise<{ overdue: number; reminded: number }> {
  const overdue = await prisma.dataSubjectRequest.findMany({
    where: {
      status: { notIn: [...CLOSED] },
      dueAt: { lt: now },
    },
    select: { id: true, requestNo: true, dueAt: true },
  });
  if (overdue.length === 0) return { overdue: 0, reminded: 0 };

  const officerIds = await pdpOfficerUserIds(now);
  if (officerIds.length === 0) {
    logger.warn('[PDP] Permintaan lewat tenggat tanpa petugas pemegang PDP_MANAGE', {
      overdue: overdue.length,
    });
    return { overdue: overdue.length, reminded: 0 };
  }

  const day = now.toISOString().slice(0, 10);
  const dueLabel = (dueAt: Date) =>
    dueAt.toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Asia/Jakarta',
    });
  const sends = overdue.flatMap((request) =>
    officerIds.map((userId) =>
      createNotification({
        userId,
        type: 'REMINDER',
        priority: 'HIGH',
        title: `Permintaan data pribadi ${request.requestNo} lewat tenggat`,
        message:
          `Permintaan ${request.requestNo} melewati tenggat ${dueLabel(request.dueAt)} ` +
          'dan belum selesai. Buka daftar permintaan data pribadi untuk menindaklanjutinya.',
        channels: ['IN_APP', 'EMAIL'],
        link: DSR_LIST_LINK,
        data: { requestNo: request.requestNo },
        // Satu pengingat per permintaan per petugas per hari.
        dedupeKey: `dsr-overdue:${request.id}:${userId}:${day}`,
      })
    )
  );

  const results = await Promise.allSettled(sends);
  const failed = results.filter((r) => r.status === 'rejected').length;
  if (failed) logger.warn('[PDP] Sebagian pengingat tenggat gagal dikirim', { failed });
  return { overdue: overdue.length, reminded: results.length - failed };
}
