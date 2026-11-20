import type { AdmissionStatus, PrismaClient } from '@prisma/client';
import type { AppPrismaClient } from '@/lib/prisma';
import { deleteRegistrant } from '@/modules/admissions';
import { shiftWibDay, wibDayOf, wibDayStart } from '@/utils/wib';

/**
 * Retensi data pendaftar SPMB — 90 hari sesudah gelombangnya ditutup.
 *
 * Kebijakan Privasi yang diterbitkan yayasan menjanjikan bahwa data pendaftar
 * yang tidak diterima **dihapus setelah proses seleksi selesai**
 * (`prisma/seed.ts`), dan keputusan pemilik pada #842 menetapkan patokannya: 90
 * hari sesudah gelombang ditutup, kalender WIB. Sebelum pekerjaan ini janji itu
 * hanya kalimat: tidak ada satu pun job yang menyentuh pendaftar, sehingga data
 * pribadi anak (KK, akta, KTP wali, foto) tersimpan melewati janji itu — UU
 * 27/2022 Pasal 43 ayat (1).
 *
 * Dua keputusan bentuk yang menentukan jawabannya:
 *
 * **Kapan boleh dihapus.** Patokannya `reRegistrationEndDate` (akhir daftar
 * ulang), lalu `resultsEndDate`, lalu `endDate`; pendaftar tanpa gelombang
 * memakai `AdmissionPeriod.endDate`. 90 hari itu masa daftar ulang, pengisian
 * kuota cadangan, dan pengaduan sesudah pengumuman (tahap pasca-SPMB,
 * Permendikdasmen 3/2025), jadi penghapusan baru boleh berjalan mulai 00.00 WIB
 * hari D+90 — bukan D+90 00.00 UTC, yang di WIB masih pukul 07.00 hari D+90 dan
 * memberi 90 hari lebih 7 jam.
 *
 * **Siapa yang dihapus.** Status `ENROLLED` atau baris ber-`studentId` tidak
 * pernah disentuh: pendaftar itu sudah menjadi santri, dan dokumennya pindah ke
 * berkas santri (#1009). Selain itu — `REJECTED`, `CANCELLED`, dan yang tidak
 * pernah menjadi santri — dihapus.
 *
 * **Lewat `deleteRegistrant`, bukan `deleteMany`.** Jalur itu menjaga
 * `registeredCount`/`acceptedCount` gelombang tetap seimbang dengan baris yang
 * benar-benar ada, dan `RegistrantDocument` ikut terhapus lewat cascade.
 * Menghapus baris langsung akan meninggalkan gelombang yang menghitung
 * pendaftar yang sudah tidak ada.
 *
 * **Satu baris audit setiap kali berjalan.** Log kontainer diputar 10 MB × 3
 * berkas, jadi bukti bahwa retensi berjalan pekan lalu sudah tergilas sebelum
 * ada yang menanyakannya. Baris `audit_logs` bertahan, dan mengubah "apakah
 * janji 90 hari itu benar-benar ditepati" menjadi satu kueri. Namanya tidak
 * dicatat — hanya jumlahnya: tabel audit jauh lebih banyak pembacanya daripada
 * baris pendaftar itu sendiri.
 */

/** Masa simpan sesudah gelombang ditutup, diputuskan pemilik 2026-11-20 (#842). */
export const REGISTRANT_RETENTION_DAYS = 90;

/** Nama tindakan pada `audit_logs`, dipakai kembali oleh kueri riwayat penyapuan. */
export const REGISTRANT_RETENTION_AUDIT_ACTION = 'PURGE_EXPIRED_REGISTRANTS';

/** Satu pendaftar yang masa simpannya sudah lewat, cukup untuk dilaporkan. */
export interface ExpiredRegistrant {
  registrantId: string;
  registrationNo: string;
  status: AdmissionStatus;
  waveId: string | null;
  /** Hari gelombangnya ditutup (WIB), patokan 90 hari. */
  closeDay: string;
  /** 00.00 WIB hari D+90 — saat penghapusan boleh berjalan. */
  retentionStart: Date;
}

/** Pendaftar yang gagal dihapus, beserta sebabnya, supaya kegagalannya terbaca. */
export interface FailedRegistrant {
  registrantId: string;
  registrationNo: string;
  reason: string;
}

export interface RegistrantRetentionSummary {
  dryRun: boolean;
  expired: ExpiredRegistrant[];
  deleted: ExpiredRegistrant[];
  failed: FailedRegistrant[];
}

/**
 * Saat penghapusan boleh berjalan untuk sebuah hari tutup gelombang.
 *
 * `wibDayStart` + `shiftWibDay` dipakai, bukan `+90 * 24 jam` pada instan:
 * kolom `@db.Date` menyimpan hari kalender di tengah malam UTC, dan menambah
 * 90 hari pada instan itu menghasilkan 07.00 WIB — tujuh jam terlalu cepat,
 * serta bergeser bagi instan mana pun yang bukan tengah malam.
 */
export function retentionStartFor(closeDay: string): Date {
  return wibDayStart(shiftWibDay(closeDay, REGISTRANT_RETENTION_DAYS));
}

/** Bentuk baris yang dibaca pekerjaan ini; hanya kolom yang menentukan. */
interface CandidateRow {
  id: string;
  registrationNo: string;
  status: AdmissionStatus;
  waveId: string | null;
  wave: {
    reRegistrationEndDate: Date | null;
    resultsEndDate: Date | null;
    endDate: Date;
  } | null;
  admissionPeriod: { endDate: Date };
}

/**
 * Hari tutup gelombang menurut urutan yang diputuskan pemilik: akhir daftar
 * ulang, lalu akhir pengumuman, lalu akhir pendaftaran. Pendaftar tanpa
 * gelombang memakai akhir periode unitnya.
 */
function closeDayOf(row: CandidateRow): string {
  const wave = row.wave;
  const closeInstant =
    wave?.reRegistrationEndDate ??
    wave?.resultsEndDate ??
    wave?.endDate ??
    row.admissionPeriod.endDate;
  return wibDayOf(closeInstant);
}

/**
 * Menghapus pendaftar yang tidak menjadi santri 90 hari sesudah gelombangnya
 * ditutup. Fungsi ini tidak mencetak apa pun: penjadwal melaporkan lewat
 * `logger`, perintah lewat `console` — yang dikembalikan adalah fakta.
 */
export async function purgeExpiredRegistrants(
  // Klien API, atau klien biasa yang dibuat `prisma/scripts/purge-expired-registrants.ts`.
  prisma: AppPrismaClient | PrismaClient,
  { dryRun = false, now = new Date() }: { dryRun?: boolean; now?: Date } = {}
): Promise<RegistrantRetentionSummary> {
  // `studentId: null` dan `status != ENROLLED` adalah dua saringan yang tidak
  // boleh saling menggantikan: pendaftar yang sudah menjadi santri selalu
  // punya `studentId`, tetapi baris lama bisa saja berstatus ENROLLED dengan
  // tautan yang belum terisi. Keduanya disaring di sini, bukan hanya di JS,
  // supaya baris yang tidak boleh disentuh tidak pernah masuk daftar kandidat.
  const rows = (await prisma.registrant.findMany({
    where: {
      studentId: null,
      status: { not: 'ENROLLED' },
    },
    select: {
      id: true,
      registrationNo: true,
      status: true,
      waveId: true,
      wave: {
        select: { reRegistrationEndDate: true, resultsEndDate: true, endDate: true },
      },
      admissionPeriod: { select: { endDate: true } },
    },
  })) as CandidateRow[];

  const expired: ExpiredRegistrant[] = [];
  for (const row of rows) {
    const closeDay = closeDayOf(row);
    const retentionStart = retentionStartFor(closeDay);
    // D+89 23.59 WIB belum lewat, D+90 00.00 WIB sudah: batasnya instan 00.00
    // WIB hari D+90, bukan "90 × 24 jam" pada tengah malam UTC (yang di WIB
    // berarti 07.00 dan memberi tujuh jam tambahan).
    if (now.getTime() < retentionStart.getTime()) continue;
    expired.push({
      registrantId: row.id,
      registrationNo: row.registrationNo,
      status: row.status,
      waveId: row.waveId,
      closeDay,
      retentionStart,
    });
  }

  const deleted: ExpiredRegistrant[] = [];
  const failed: FailedRegistrant[] = [];

  if (!dryRun) {
    for (const row of expired) {
      try {
        await deleteRegistrant(row.registrantId);
        deleted.push(row);
      } catch (error) {
        // Satu baris yang gagal tidak boleh menghentikan sisanya: kegagalan
        // satu pendaftar (misalnya status berubah menjadi ENROLLED di antara
        // pembacaan dan penghapusan) bukan alasan menyimpan sembilan puluh
        // pendaftar lain melewati masa simpannya.
        failed.push({
          registrantId: row.registrantId,
          registrationNo: row.registrationNo,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const summary: RegistrantRetentionSummary = { dryRun, expired, deleted, failed };
  if (!dryRun) await recordRun(prisma, summary);
  return summary;
}

/**
 * Satu baris audit setiap kali penyapuan benar-benar berjalan.
 *
 * Gagal mencatat tidak boleh menggagalkan penghapusan yang sudah terjadi:
 * barisnya sudah lenyap, dan melempar galat di sini hanya membuat penjadwal
 * melaporkan kegagalan atas pekerjaan yang berhasil.
 */
async function recordRun(
  prisma: AppPrismaClient | PrismaClient,
  summary: RegistrantRetentionSummary
) {
  try {
    await prisma.auditLog.create({
      data: {
        action: REGISTRANT_RETENTION_AUDIT_ACTION,
        entity: 'Registrant',
        newValues: {
          expired: summary.expired.length,
          deleted: summary.deleted.length,
          failed: summary.failed.length,
        },
      },
    });
  } catch {
    // Sengaja ditelan; pemanggil sudah punya ringkasannya.
  }
}
