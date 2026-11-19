import type { PrismaClient } from '@prisma/client';
import type { AppPrismaClient } from '@/lib/prisma';
import {
  deleteIdentityDocument,
  identityDocumentRetainUntil,
  listIdentityDocuments,
  orphanedIdentityDocuments,
  type IdentityDocumentOnDisk,
} from '@/utils/identity-document-store';
import { DEFAULT_VALIDITY_DAYS, expiryFrom } from '@/utils/esign-lifecycle';

/**
 * Menghapus foto KTP yang tidak boleh lagi disimpan.
 *
 * Dua tahap, dan tahap kedua ada justru karena tahap pertama tidak dapat
 * melihatnya. Tahap satu berangkat dari basis data: baris yang masa simpannya
 * lewat, berkas yang disebutnya, dihapus. Tahap dua berangkat dari disk, dan
 * hanya arah itu yang dapat menemukan berkas yang barisnya sudah tidak ada —
 * sesuatu yang tidak disebut baris mana pun tidak akan muncul dalam kueri mana
 * pun.
 *
 * **Kenapa di sini, bukan di crontab host.** Berkasnya hidup di volume
 * `api_identity` yang terpasang ke kontainer API, dan basis datanya hanya dapat
 * dijangkau lewat jaringan bridge Compose. Penjadwal di luar kontainer harus
 * meminjam keduanya lewat `docker compose exec` — artinya ia terikat pada satu
 * host tertentu, tidak ikut berpindah ketika penerapannya berpindah, dan tidak
 * ada dalam repo sehingga tidak ada yang meninjaunya. Yang di dalam proses ikut
 * ke mana pun image-nya dibawa.
 *
 * Alasan lama menolak penjadwal dalam proses adalah "perintah yang tidak
 * dijalankan meninggalkan jejak di crontab yang dapat diperiksa". Alasan itu
 * terbukti salah dengan cara yang paling telak: pada 2026-09-03 crontab-nya
 * diperiksa dan kosong. Yang membuat sebuah pekerjaan dapat diperiksa bukan
 * tempat penjadwalnya, melainkan apakah ia meninggalkan catatan setiap kali
 * berjalan — yang di bawah ini kerjakan.
 *
 * Satu proses saja yang menjalankannya: `docker-compose.yml` mematok
 * `container_name`, jadi layanan ini tidak dapat diperbanyak. Seandainya kelak
 * bisa, tabrakannya pun tidak berbahaya — menghapus berkas yang sudah lenyap
 * bukan galat (lihat `deleteIdentityDocument`), dan menulis ulang kolom yang
 * sudah null tidak mengubah apa pun. Karena itu tidak ada kunci di sini; yang
 * ada adalah alasan tertulis mengapa tidak diperlukan.
 */

/** Baris yang masa simpannya lewat, cukup untuk dilaporkan pemanggilnya. */
export interface ExpiredIdentityDocument {
  userId: string;
  fileName: string;
  retainUntil: Date | null;
  ownerName: string;
}

export interface IdentityPurgeSummary {
  dryRun: boolean;
  expired: ExpiredIdentityDocument[];
  /** Baris ber-`ktpRetainUntil` kosong yang baru saja diberi batas simpan. */
  backfilled: number;
  onDiskCount: number;
  referencedCount: number;
  orphans: IdentityDocumentOnDisk[];
}

/**
 * Nama tindakan pada `audit_logs`, dipakai kembali oleh kueri yang menanyakan
 * kapan terakhir kali penyapuan ini berjalan.
 */
export const IDENTITY_PURGE_AUDIT_ACTION = 'PURGE_IDENTITY_DOCUMENTS';

/**
 * Fungsi ini tidak mencetak apa pun.
 *
 * Ia dipanggil dari dua tempat yang melaporkan dengan cara berbeda — penjadwal
 * lewat `logger`, perintah lewat `console` dalam bahasa Indonesia — jadi yang
 * dikembalikannya adalah fakta, bukan kalimat. Menaruh presentasi di sini akan
 * memaksa salah satu pemanggil memformat ulang keluaran pemanggil yang lain.
 */
export async function purgeIdentityDocuments(
  // The API's client, or the plain one `prisma/scripts/purge-identity-documents.ts` makes.
  prisma: AppPrismaClient | PrismaClient,
  { dryRun = false }: { dryRun?: boolean } = {}
): Promise<IdentityPurgeSummary> {
  const expiredRows = await prisma.userIdentity.findMany({
    where: {
      ktpFileName: { not: null },
      ktpRetainUntil: { not: null, lte: new Date() },
    },
    select: {
      userId: true,
      ktpFileName: true,
      ktpRetainUntil: true,
      user: { select: { name: true } },
    },
  });

  // Baris yang berkasnya masih ada tetapi batas simpannya kosong tidak akan
  // pernah cocok dengan saringan di atas — dan tidak pernah menjadi yatim,
  // karena berkasnya masih dirujuk. Tanpa langkah ini ia menyimpan foto KTP
  // selamanya. Kolom itu kini diisi sejak unggah, jadi yang tersisa hanyalah
  // baris lama yang diunggah sebelum jaring pengaman itu ada; yang dilakukan
  // di sini adalah memberinya batas simpan menurut aturan yang sama, bukan
  // menghapusnya — bukti registrasi penandatangan tetap disimpan sesuai
  // kebijakannya, lalu ikut tersapu ketika batas itu lewat.
  const backfillRows = await prisma.userIdentity.findMany({
    // `user.deletedAt: null` mengecualikan baris yang subjeknya sudah dihapus
    // oleh kode sebelum jaring pengaman ini ada: baris itu juga ber-
    // `ktpRetainUntil` kosong, tetapi memberinya masa simpan baru berarti
    // menyimpan KTP orang yang sudah dinyatakan dihapus. Berkasnya justru
    // dibuang oleh `eraseUserIdentity` pada jalur penghapusan.
    where: { ktpFileName: { not: null }, ktpRetainUntil: null, user: { deletedAt: null } },
    select: { userId: true },
  });

  if (!dryRun) {
    for (const row of backfillRows) {
      await prisma.userIdentity.update({
        where: { userId: row.userId },
        data: {
          ktpRetainUntil: identityDocumentRetainUntil(
            expiryFrom(new Date(), DEFAULT_VALIDITY_DAYS)
          ),
        },
      });
    }
  }

  const expired: ExpiredIdentityDocument[] = expiredRows.map((row) => ({
    userId: row.userId,
    fileName: row.ktpFileName!,
    retainUntil: row.ktpRetainUntil,
    ownerName: row.user?.name ?? row.userId,
  }));

  if (!dryRun) {
    for (const row of expired) {
      await deleteIdentityDocument(row.fileName);
      // `ktpDeletedAt` diisi supaya penghapusannya dapat ditunjukkan: kolom
      // yang sekadar dikosongkan tidak dapat membedakan "sudah dihapus" dari
      // "tidak pernah ada".
      await prisma.userIdentity.update({
        where: { userId: row.userId },
        data: { ktpFileName: null, ktpDeletedAt: new Date() },
      });
    }
  }

  const onDisk = await listIdentityDocuments();
  // Dibandingkan terhadap **seluruh** `ktpFileName` yang bukan null, bukan
  // hanya yang kedaluwarsa: apa pun yang masih dirujuk satu baris mana pun
  // bukan yatim. Dibaca setelah tahap satu supaya berkas yang barusan dihapus
  // tidak terhitung dua kali.
  const referenced = await prisma.userIdentity.findMany({
    where: { ktpFileName: { not: null } },
    select: { ktpFileName: true },
  });
  const orphans = orphanedIdentityDocuments(
    onDisk,
    referenced.map((r) => r.ktpFileName!)
  );

  if (!dryRun) {
    for (const orphan of orphans) {
      await deleteIdentityDocument(orphan.fileName);
    }
  }

  const summary: IdentityPurgeSummary = {
    dryRun,
    expired,
    backfilled: backfillRows.length,
    onDiskCount: onDisk.length,
    referencedCount: referenced.length,
    orphans,
  };

  if (!dryRun) await recordRun(prisma, summary);
  return summary;
}

/**
 * Satu baris audit setiap kali penyapuan benar-benar berjalan.
 *
 * Ini bagian yang membuat penjadwal dalam proses lebih dapat diperiksa
 * daripada crontab, bukan sekadar setara dengannya. Baris log tidak menjawab
 * pertanyaannya: `docker-compose.yml` memutar log pada 10 MB × 3 berkas
 * sementara pekerjaan metrik menulis satu baris tiap menit, jadi bukti bahwa
 * penyapuan berjalan pekan lalu sudah tergilas jauh sebelum ada yang
 * menanyakannya. Sebuah baris di `audit_logs` bertahan, dan mengubah "apakah
 * retensi tujuh tahun itu benar-benar dijalankan" menjadi satu kueri.
 *
 * Nama berkas tidak dicatat — hanya jumlahnya. Nama itu dibuat acak justru agar
 * tidak menyebut siapa pun, dan menuliskannya ke tabel audit yang jauh lebih
 * banyak pembacanya akan membatalkan gunanya.
 *
 * Gagal mencatat tidak boleh menggagalkan penghapusan yang sudah terjadi:
 * berkasnya sudah lenyap, dan melempar galat di sini hanya akan membuat
 * penjadwal melaporkan kegagalan atas pekerjaan yang berhasil.
 */
async function recordRun(prisma: AppPrismaClient | PrismaClient, summary: IdentityPurgeSummary) {
  try {
    await prisma.auditLog.create({
      data: {
        action: IDENTITY_PURGE_AUDIT_ACTION,
        entity: 'UserIdentity',
        newValues: {
          expired: summary.expired.length,
          backfilled: summary.backfilled,
          orphans: summary.orphans.length,
          onDisk: summary.onDiskCount,
          referenced: summary.referencedCount,
        },
      },
    });
  } catch {
    // Sengaja ditelan; pemanggil sudah punya ringkasannya untuk dicatat.
  }
}
