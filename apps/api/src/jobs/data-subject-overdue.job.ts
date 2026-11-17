/**
 * Pengingat tenggat permintaan hak subjek data (UU 27/2022 Pasal 30, 32, 40, 43).
 *
 * Deskripsi PR #1140 menyebut notifikasi keterlambatan kepada penangan, tetapi
 * yang ada hanyalah `overdueOnly` — sebuah penyaring BACAAN daftar. Tenggatnya
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
import { createNotification } from '@/modules/notifications';

/** Status yang mengakhiri alur; pengingat tidak berlaku lagi setelahnya. */
const CLOSED = ['COMPLETED', 'REJECTED'] as const;

/** Tautan yang dibuka petugas dari notifikasi. */
export const DSR_LIST_LINK = '/settings/permintaan-data';

/**
 * Pengguna yang memegang `PDP_MANAGE`.
 *
 * Izin hidup pada baris `Role.permissions` (JSON) dan diberikan lewat
 * penunjukan, jadi keanggotaannya dibaca dari peran yang memuatnya — bukan dari
 * daftar kode peran yang ditulis ulang di sini.
 */
export async function pdpOfficerUserIds(): Promise<string[]> {
  const roles = await prisma.role.findMany({
    where: { isActive: true, permissions: { array_contains: 'PDP_MANAGE' } },
    select: { id: true },
  });
  if (roles.length === 0) return [];
  const assignments = await prisma.userRoleAssignment.findMany({
    where: { roleId: { in: roles.map((r) => r.id) }, isActive: true },
    select: { userId: true },
    distinct: ['userId'],
  });
  return assignments.map((a) => a.userId);
}

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

  const officerIds = await pdpOfficerUserIds();
  if (officerIds.length === 0) {
    logger.warn('[PDP] Permintaan lewat tenggat tanpa petugas pemegang PDP_MANAGE', {
      overdue: overdue.length,
    });
    return { overdue: overdue.length, reminded: 0 };
  }

  const day = now.toISOString().slice(0, 10);
  const sends = overdue.flatMap((request) =>
    officerIds.map((userId) =>
      createNotification({
        userId,
        type: 'REMINDER',
        priority: 'HIGH',
        title: `Permintaan data pribadi ${request.requestNo} lewat tenggat`,
        message:
          `Permintaan ${request.requestNo} melewati tenggat ${request.dueAt.toISOString()} ` +
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
