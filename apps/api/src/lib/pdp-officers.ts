import { prisma } from '@/lib/prisma';

/**
 * Siapa yang berwenang atas pelindungan data pribadi (`PDP_MANAGE`).
 *
 * Penunjukan itu tidak mengikuti jabatan (Pasal 53): izin hidup pada baris
 * `Role.permissions` dan diberikan lewat `UserRoleAssignment`, jadi
 * keanggotaannya dibaca dari peran yang memuatnya — bukan dari daftar kode
 * peran yang ditulis ulang di setiap pemanggil.
 *
 * Berkas ini satu-satunya rumah pertanyaan "siapa petugas PDP". Pekerjaan
 * pengingat tenggat memakainya untuk mengirim pesan, dan alur hak subjek data
 * memakainya untuk menolak `handledById` yang bukan petugas — dua tempat yang
 * harus menjawab dengan daftar yang sama.
 */

/**
 * Penunjukan yang sudah kedaluwarsa tidak ikut.
 *
 * `isActive` saja tidak cukup: sebuah penunjukan dengan `expiresAt` yang sudah
 * lewat masih tersimpan `isActive` sampai ada yang menonaktifkannya, sedangkan
 * `auth.service` (`activeRoleWhere`) sudah mengecualikannya dari hak akses.
 * Memakai `isActive` tanpa batas masa berlaku berarti mengirim nomor permintaan
 * dan tenggatnya lewat surel kepada orang yang tidak lagi berwenang menerimanya
 * (CWE-863). Penyaringnya disamakan dengan milik autentikasi.
 */
export async function pdpOfficerUserIds(now = new Date()): Promise<string[]> {
  const roles = await prisma.role.findMany({
    where: { isActive: true, permissions: { array_contains: 'PDP_MANAGE' } },
    select: { id: true },
  });
  if (roles.length === 0) return [];
  const assignments = await prisma.userRoleAssignment.findMany({
    where: {
      roleId: { in: roles.map((r) => r.id) },
      isActive: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: { userId: true },
    distinct: ['userId'],
  });
  return assignments.map((a) => a.userId);
}

/**
 * Apakah pengguna ini memegang `PDP_MANAGE` lewat penunjukan aktif.
 *
 * Membaca penunjukan pengguna itu saja, bukan seluruh daftar petugas: pemanggil
 * yang sudah memegang satu `userId` (mis. `assertPdpOfficer` di dalam transaksi
 * yang menahan baris permintaan dengan `FOR UPDATE`) tidak perlu memuat semua
 * petugas hanya untuk memutuskan satu orang.
 */
export async function isPdpOfficer(userId: string, now = new Date()): Promise<boolean> {
  const assignment = await prisma.userRoleAssignment.findFirst({
    where: {
      userId,
      isActive: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      role: { isActive: true, permissions: { array_contains: 'PDP_MANAGE' } },
    },
    select: { id: true },
  });
  return assignment !== null;
}
