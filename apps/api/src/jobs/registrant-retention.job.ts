import type { AdmissionStatus, DataSubjectRequestStatus, PrismaClient } from '@prisma/client';
import type { AppPrismaClient } from '@/lib/prisma';
import { deleteRegistrantForRetention } from '@/modules/admissions';
import { dayOf, shiftWibDay, wibDayEnd, wibDayOf, wibDayStart } from '@/utils/wib';

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
 * memberi masa simpan 90 hari lebih 7 jam.
 *
 * **Siapa yang dihapus.** Status `ENROLLED` atau baris ber-`studentId` tidak
 * pernah disentuh: pendaftar itu sudah menjadi santri, dan dokumennya pindah ke
 * berkas santri (#1009). Selain itu — `REJECTED`, `CANCELLED`, dan yang tidak
 * pernah menjadi santri — dihapus.
 *
 * **Lewat `deleteRegistrantForRetention`, bukan `deleteMany`.** Jalur itu
 * menjaga `registeredCount`/`acceptedCount` gelombang tetap seimbang dengan
 * baris yang benar-benar ada, dan `RegistrantDocument` ikut terhapus lewat
 * cascade. Menghapus baris langsung akan meninggalkan gelombang yang menghitung
 * pendaftar yang sudah tidak ada. Jalur khusus retensi juga memeriksa ulang
 * pembayaran, onboarding, dan permintaan hak subjek di bawah kunci baris:
 * kandidat dipilih lebih dulu, dan keadaan dapat berubah sebelum gilirannya
 * dihapus.
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

/** Status permintaan hak subjek yang belum selesai — subjeknya tidak boleh hilang. */
const OPEN_REQUEST_STATUSES: DataSubjectRequestStatus[] = ['RECEIVED', 'VERIFIED', 'PROCESSING'];

export interface RegistrantRetentionSummary {
  dryRun: boolean;
  expired: ExpiredRegistrant[];
  deleted: ExpiredRegistrant[];
  failed: FailedRegistrant[];
  /** Melewati masa simpan tetapi ditahan karena masih punya permintaan hak subjek terbuka. */
  withheld: number;
}

/**
 * Hari tutup gelombang yang paling akhir yang masih boleh dihapus pada `now`.
 *
 * `closeDay + 90 <= wibDayOf(now)`, dibalik menjadi satu tanggal, supaya
 * batasnya bisa didorong ke `where` dan indeks `@@index([waveId])` /
 * `@@index([admissionPeriodId])` terpakai. Tanpa ini kueri mengambil seluruh
 * riwayat pendaftar setiap malam dan menyaring tanggalnya di memori.
 */
export function cutoffCloseDayFor(now: Date): string {
  return shiftWibDay(wibDayOf(now), -REGISTRANT_RETENTION_DAYS);
}

/**
 * Batas yang sama sebagai predikat Prisma. Sengaja **superset** dari keputusan
 * di JS: cabang-cabang ini hanya mempersempit baris yang dibaca, sedangkan
 * boleh-tidaknya dihapus tetap diputuskan `retentionStartFor` atas `closeDay`
 * yang sebenarnya — supaya batas WIB hanya punya satu tempat uji.
 *
 * Dua batas karena dua bentuk kolom: `reRegistration*`/`results*` adalah
 * `@db.Date` (tengah malam UTC), sedangkan `endDate` gelombang dan periode
 * adalah timestamp yang ditulis `wibDayEnd` (23.59.59,999 WIB = 16.59.59,999Z).
 * Memakai batas tengah malam UTC untuk yang timestamp melewatkan seluruh hari
 * cutoff dan membuat retensi terlambat sehari.
 *
 * Tiap tahap memakai tanggal selesai, atau tanggal mulai bila selesai kosong:
 * sesi satu hari disimpan dengan `endDate = null` (formulir gelombang meminta
 * petugas mengosongkan tanggal selesai), jadi mengabaikan tanggal mulai membuat
 * patokannya jatuh ke tahap sebelumnya dan data terhapus terlalu cepat.
 *
 * `endDate` gelombang (akhir pendaftaran) selalu menjadi batas bawah: validasi
 * jadwal menerima pengumuman satu hari yang mendahului penutupan pendaftaran,
 * dan dalam urutan itu pengumuman tidak boleh memulai masa simpan sebelum
 * pendaftaran benar-benar ditutup.
 */
function expiryFilter(dateCutoff: Date, timestampCutoff: Date) {
  return {
    OR: [
      {
        wave: {
          reRegistrationEndDate: { not: null, lte: dateCutoff },
          endDate: { lte: timestampCutoff },
        },
      },
      {
        wave: {
          reRegistrationEndDate: null,
          reRegistrationStartDate: { not: null, lte: dateCutoff },
          endDate: { lte: timestampCutoff },
        },
      },
      {
        wave: {
          reRegistrationEndDate: null,
          reRegistrationStartDate: null,
          resultsEndDate: { not: null, lte: dateCutoff },
          endDate: { lte: timestampCutoff },
        },
      },
      {
        wave: {
          reRegistrationEndDate: null,
          reRegistrationStartDate: null,
          resultsEndDate: null,
          resultsStartDate: { not: null, lte: dateCutoff },
          endDate: { lte: timestampCutoff },
        },
      },
      {
        wave: {
          reRegistrationEndDate: null,
          reRegistrationStartDate: null,
          resultsEndDate: null,
          resultsStartDate: null,
          endDate: { lte: timestampCutoff },
        },
      },
      { wave: null, admissionPeriod: { endDate: { lte: timestampCutoff } } },
    ],
  };
}

/**
 * Saat penghapusan boleh berjalan untuk sebuah hari tutup gelombang.
 *
 * `wibDayStart` + `shiftWibDay` dipakai, bukan `+90 * 24 jam` pada instan:
 * kolom `@db.Date` menyimpan hari kalender di tengah malam UTC, dan menambah
 * 90 hari pada instan itu menghasilkan 07.00 WIB — tujuh jam **terlambat**
 * (masa simpan jadi 90 hari lebih 7 jam), serta bergeser bagi instan mana pun
 * yang bukan tengah malam.
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
    reRegistrationStartDate: Date | null;
    reRegistrationEndDate: Date | null;
    resultsStartDate: Date | null;
    resultsEndDate: Date | null;
    endDate: Date;
  } | null;
  admissionPeriod: { endDate: Date };
}

/**
 * Hari tutup gelombang menurut urutan yang diputuskan pemilik: akhir daftar
 * ulang, lalu akhir pengumuman, lalu akhir pendaftaran. Pendaftar tanpa
 * gelombang memakai akhir periode unitnya.
 *
 * Tiap tahap memakai tanggal selesai, atau tanggal mulai bila selesai kosong —
 * sesi satu hari disimpan sebagai `endDate = null` dan hanya punya tanggal
 * mulai. Tanpa ini patokannya jatuh ke tahap sebelumnya.
 *
 * Akhir pendaftaran adalah batas bawah. Validasi jadwal menerima pengumuman
 * satu hari yang mendahului penutupan pendaftaran, dan urutan itu tidak boleh
 * memulai masa simpan sebelum pendaftaran ditutup.
 */
function closeDayOf(row: CandidateRow): string {
  const wave = row.wave;
  const stageDay = wibDayOf(
    wave?.reRegistrationEndDate ??
      wave?.reRegistrationStartDate ??
      wave?.resultsEndDate ??
      wave?.resultsStartDate ??
      wave?.endDate ??
      row.admissionPeriod.endDate
  );
  const registrationDay = wibDayOf(wave?.endDate ?? row.admissionPeriod.endDate);
  return stageDay > registrationDay ? stageDay : registrationDay;
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
  //
  // `registrationFeePaidAt` dikecualikan karena baris pendaftar adalah
  // **satu-satunya** catatan uang daftar ulang: `recordRegistrationFee` menulis
  // nominal, tanggal, dan verifikatornya ke kolom `Registrant` saja, dan
  // `roi.service.ts` membaca laporan kampanye dari sana. Sapuan otomatis tidak
  // boleh memusnahkan bukti penerimaan uang (UU KUP Ps. 28 ayat 11 menuntut
  // catatan keuangan paling singkat 10 tahun); pendaftar seperti itu diserahkan
  // ke jalur ERASURE atau tindakan petugas sesudah tutup buku.
  const cutoff = cutoffCloseDayFor(now);
  const rows = (await prisma.registrant.findMany({
    where: {
      studentId: null,
      status: { not: 'ENROLLED' },
      registrationFeePaidAt: null,
      ...expiryFilter(dayOf(cutoff), wibDayEnd(cutoff)),
    },
    select: {
      id: true,
      registrationNo: true,
      status: true,
      waveId: true,
      wave: {
        select: {
          reRegistrationStartDate: true,
          reRegistrationEndDate: true,
          resultsStartDate: true,
          resultsEndDate: true,
          endDate: true,
        },
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
  let withheld = 0;
  let held = new Set<string>();

  if (expired.length) {
    // Permintaan hak subjek yang masih terbuka harus tetap punya subjeknya:
    // `DataSubjectRequest.subjectRegistrantId` memakai `onDelete: SetNull`, jadi
    // barisnya selamat tetapi objek yang diminta hilang lebih dulu, dan ACCESS
    // atau RECTIFICATION tidak lagi dapat dijawab dalam tenggat 3×24 jam
    // (Pasal 30, 32, 40, 43). Pengecualian sempit: hanya status yang belum
    // selesai, dan hanya selama permintaannya terbuka.
    //
    // Kueri ini juga berjalan saat dry run: keluaran dry run harus sama dengan
    // yang akan terjadi sungguhan, termasuk jumlah yang ditahan.
    const openRequests = await prisma.dataSubjectRequest.findMany({
      where: {
        subjectRegistrantId: { in: expired.map((r) => r.registrantId) },
        status: { in: OPEN_REQUEST_STATUSES },
      },
      select: { subjectRegistrantId: true },
    });
    held = new Set(
      openRequests.map((r) => r.subjectRegistrantId).filter((id): id is string => id !== null)
    );
    withheld = held.size;
  }

  if (!dryRun) {
    for (const row of expired) {
      if (held.has(row.registrantId)) continue;
      try {
        // Jalur khusus retensi: memeriksa ulang seluruh syarat di bawah kunci
        // baris, karena pembayaran, permintaan hak subjek, atau onboarding
        // dapat selesai di antara pemilihan kandidat dan giliran baris ini.
        await deleteRegistrantForRetention(row.registrantId);
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

  const summary: RegistrantRetentionSummary = { dryRun, expired, deleted, failed, withheld };
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
          withheld: summary.withheld,
        },
      },
    });
  } catch {
    // Sengaja ditelan; pemanggil sudah punya ringkasannya.
  }
}
