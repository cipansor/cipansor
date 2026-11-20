import { describe, it, expect, vi, beforeEach } from 'vitest';

const { deleteRegistrantMock } = vi.hoisted(() => ({ deleteRegistrantMock: vi.fn() }));

// `deleteRegistrant` sengaja dipalsukan, dan **hanya** itu: pekerjaan ini
// memang harus memakai jalur hapus yang sudah ada supaya `registeredCount`
// gelombang tetap seimbang dan dokumennya ikut terhapus lewat cascade. Aturan
// keseimbangan itu sendiri diuji di `admissions.service.test.ts`.
vi.mock('@/modules/admissions', () => ({ deleteRegistrant: deleteRegistrantMock }));

import {
  cutoffCloseDayFor,
  purgeExpiredRegistrants,
  retentionStartFor,
  REGISTRANT_RETENTION_AUDIT_ACTION,
  REGISTRANT_RETENTION_DAYS,
} from './registrant-retention.job';

/**
 * Hari tutup gelombang yang dipakai hampir semua uji: 31 Januari 2026.
 *
 * D+90 = 1 Mei 2026, jadi batasnya 2026-05-01 00.00 WIB = 2026-04-30T17:00Z.
 * Tanggal ini dipilih karena tengah malam UTC-nya (2026-05-01T00:00Z) adalah
 * 07.00 WIB — tujuh jam sesudah batas yang benar — sehingga uji batas di bawah
 * membedakan aritmetika WIB dari aritmetika UTC yang salah.
 */
const CLOSE_DAY = '2026-01-31';
const RETENTION_START = new Date('2026-04-30T17:00:00.000Z');
/** D+89 23.59 WIB — satu menit sebelum masa simpannya berakhir. */
const JUST_BEFORE = new Date('2026-04-30T16:59:00.000Z');

function wave(close: { reRegistrationEndDate?: Date | null; resultsEndDate?: Date | null }) {
  return {
    // Kolom `@db.Date` dibaca Prisma sebagai tengah malam UTC.
    reRegistrationEndDate: close.reRegistrationEndDate ?? null,
    resultsEndDate: close.resultsEndDate ?? null,
    endDate: new Date(`${CLOSE_DAY}T00:00:00.000Z`),
  };
}

function registrant(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'reg-1',
    registrationNo: 'SPMB-2026-0001',
    status: 'REJECTED',
    waveId: 'wave-1',
    studentId: null,
    wave: wave({ reRegistrationEndDate: new Date(`${CLOSE_DAY}T00:00:00.000Z`) }),
    admissionPeriod: { endDate: new Date('2026-08-31T00:00:00.000Z') },
    registrationFeePaidAt: null,
    ...over,
  };
}

/**
 * Prisma tiruan yang **menghormati `where`**, bukan mengembalikan daftar tetap.
 *
 * Pekerjaan ini menyaring `studentId: null` dan `status != ENROLLED` di basis
 * data, bukan hanya di JS. Tiruan yang mengabaikan `where` akan lulus walaupun
 * saringan itu hilang dari kuerinya — dan saringan itulah yang menjamin
 * pendaftar yang sudah menjadi santri tidak pernah tersentuh.
 */
function fakePrisma(
  rows: ReturnType<typeof registrant>[],
  { auditThrows = false, openRequests = [] as string[] } = {}
) {
  const auditCreate = vi.fn(async (_args: { data: Record<string, unknown> }) => {
    if (auditThrows) throw new Error('audit_logs tidak dapat ditulis');
    return { id: 'a1' };
  });
  const prisma = {
    registrant: {
      findMany: vi.fn(async ({ where }: any) => {
        const banned: string[] =
          where.status?.notIn ?? (where.status?.not ? [where.status.not] : []);
        // Batas yang didorong ke `where` (cabang pertama `expiryFilter`).
        const cutoff: Date | null = where.OR?.[0]?.wave?.reRegistrationEndDate?.lte ?? null;
        return rows.filter((row) => {
          if (where.studentId === null && row.studentId !== null) return false;
          if (banned.includes(row.status)) return false;
          // Pendaftar yang sudah membayar daftar ulang adalah satu-satunya
          // catatan uang itu; sapuan tidak boleh menyentuhnya.
          if (where.registrationFeePaidAt === null && row.registrationFeePaidAt != null)
            return false;
          if (cutoff) {
            const w = row.wave as any;
            const close = w
              ? (w.reRegistrationEndDate ?? w.resultsEndDate ?? w.endDate)
              : row.admissionPeriod.endDate;
            if (close > cutoff) return false;
          }
          return true;
        });
      }),
    },
    dataSubjectRequest: {
      findMany: vi.fn(async ({ where }: any) =>
        openRequests
          .filter((id) => where.subjectRegistrantId.in.includes(id))
          .map((id) => ({ subjectRegistrantId: id }))
      ),
    },
    auditLog: { create: auditCreate },
  } as any;
  return { prisma, auditCreate };
}

beforeEach(() => {
  deleteRegistrantMock.mockReset();
  deleteRegistrantMock.mockResolvedValue({ id: 'reg-1' });
});

describe('retentionStartFor', () => {
  it('adalah 00.00 WIB hari D+90, bukan 07.00 WIB', () => {
    // 90 hari pada tengah malam UTC menghasilkan 2026-05-01T00:00Z, yaitu
    // 07.00 WIB — tujuh jam terlalu longgar. Batas yang benar 17.00Z.
    expect(retentionStartFor(CLOSE_DAY)).toEqual(RETENTION_START);
    expect(retentionStartFor(CLOSE_DAY).toISOString()).not.toBe('2026-05-01T00:00:00.000Z');
  });

  it('memakai masa simpan 90 hari yang diputuskan pemilik', () => {
    expect(REGISTRANT_RETENTION_DAYS).toBe(90);
  });
});

describe('purgeExpiredRegistrants', () => {
  it('belum menghapus pada D+89 23.59 WIB', async () => {
    const { prisma } = fakePrisma([registrant()]);

    const summary = await purgeExpiredRegistrants(prisma, { now: JUST_BEFORE });

    expect(summary.expired).toHaveLength(0);
    expect(deleteRegistrantMock).not.toHaveBeenCalled();
  });

  it('sudah menghapus tepat pada 00.00 WIB hari D+90', async () => {
    const { prisma } = fakePrisma([registrant()]);

    const summary = await purgeExpiredRegistrants(prisma, { now: RETENTION_START });

    expect(summary.expired.map((r) => r.registrationNo)).toEqual(['SPMB-2026-0001']);
    expect(deleteRegistrantMock).toHaveBeenCalledWith('reg-1');
    expect(summary.deleted).toHaveLength(1);
  });

  it('sudah menghapus pukul 03.00 WIB hari D+90 — batas WIB, bukan UTC', async () => {
    // 2026-04-30T20:00Z = 2026-05-01 03.00 WIB. Aritmetika "tengah malam UTC +
    // 90 hari" akan menolak menghapus di sini karena batasnya 07.00 WIB.
    const { prisma } = fakePrisma([registrant()]);

    const summary = await purgeExpiredRegistrants(prisma, {
      now: new Date('2026-04-30T20:00:00.000Z'),
    });

    expect(summary.deleted).toHaveLength(1);
  });

  it('memakai akhir daftar ulang sebagai patokan, lalu pengumuman, lalu pendaftaran', async () => {
    const reReg = new Date('2026-02-28T00:00:00.000Z'); // D+90 = 2026-05-29
    const results = new Date('2026-02-10T00:00:00.000Z'); // D+90 = 2026-05-11
    const { prisma } = fakePrisma([
      registrant({
        id: 'pakai-daftar-ulang',
        registrationNo: 'RE-ULANG',
        wave: wave({ reRegistrationEndDate: reReg, resultsEndDate: results }),
      }),
      registrant({
        id: 'pakai-pengumuman',
        registrationNo: 'PENGUMUMAN',
        wave: wave({ resultsEndDate: results }),
      }),
      registrant({ id: 'pakai-pendaftaran', registrationNo: 'PENDAFTARAN', wave: wave({}) }),
    ]);

    // 2026-05-15: hanya yang patokannya pengumuman (D+90 11 Mei) dan
    // pendaftaran (D+90 1 Mei) yang sudah lewat; daftar ulang belum.
    const summary = await purgeExpiredRegistrants(prisma, {
      now: new Date('2026-05-15T00:00:00.000Z'),
    });

    expect(summary.expired.map((r) => r.registrationNo).sort()).toEqual([
      'PENDAFTARAN',
      'PENGUMUMAN',
    ]);
    expect(deleteRegistrantMock).not.toHaveBeenCalledWith('pakai-daftar-ulang');
  });

  it('pendaftar tanpa gelombang memakai akhir periode unitnya', async () => {
    const { prisma } = fakePrisma([
      registrant({
        id: 'tanpa-gelombang',
        waveId: null,
        wave: null,
        admissionPeriod: { endDate: new Date('2026-01-31T00:00:00.000Z') },
      }),
    ]);

    const summary = await purgeExpiredRegistrants(prisma, { now: RETENTION_START });

    expect(summary.deleted).toHaveLength(1);
    expect(summary.expired[0]!.closeDay).toBe(CLOSE_DAY);
  });

  /**
   * Pendaftar yang menjadi santri tidak pernah dihapus, walau gelombangnya
   * sudah lewat jauh. Dokumennya pindah ke berkas santri (#1009) dan mengikuti
   * masa simpan berkas santri — bukan 90 hari SPMB.
   */
  it('tidak menghapus pendaftar yang sudah menjadi santri', async () => {
    const { prisma } = fakePrisma([
      registrant({ id: 'santri', registrationNo: 'ENROLLED', status: 'ENROLLED' }),
      registrant({ id: 'punya-student', registrationNo: 'STUDENT', studentId: 'std-1' }),
    ]);

    const summary = await purgeExpiredRegistrants(prisma, {
      now: new Date('2030-01-01T00:00:00.000Z'),
    });

    expect(summary.expired).toHaveLength(0);
    expect(deleteRegistrantMock).not.toHaveBeenCalled();
  });

  it('menghapus lewat deleteRegistrant supaya penghitung gelombang tetap seimbang', async () => {
    const { prisma } = fakePrisma([registrant()]);

    await purgeExpiredRegistrants(prisma, { now: RETENTION_START });

    // `deleteMany` akan meninggalkan `registeredCount` menghitung pendaftar
    // yang sudah tidak ada; jalur hapus yang sudah ada juga yang menurunkan
    // `acceptedCount` dan membuka kembali gelombang yang penuh karena kuota.
    expect(deleteRegistrantMock).toHaveBeenCalledTimes(1);
    expect(prisma.registrant.deleteMany).toBeUndefined();
  });

  it('kegagalan satu pendaftar tidak menghentikan sisanya', async () => {
    deleteRegistrantMock.mockImplementation(async (id: string) => {
      if (id === 'reg-1') throw new Error('Cannot delete enrolled registrant');
      return { id };
    });
    const { prisma } = fakePrisma([
      registrant({ id: 'reg-1', registrationNo: 'GAGAL' }),
      registrant({ id: 'reg-2', registrationNo: 'LANJUT' }),
    ]);

    const summary = await purgeExpiredRegistrants(prisma, { now: RETENTION_START });

    expect(summary.failed).toEqual([
      expect.objectContaining({
        registrationNo: 'GAGAL',
        reason: expect.stringContaining('enrolled'),
      }),
    ]);
    expect(summary.deleted.map((r) => r.registrationNo)).toEqual(['LANJUT']);
  });

  it('mencatat satu baris audit berisi jumlah, bukan nama pendaftar', async () => {
    const { prisma, auditCreate } = fakePrisma([registrant()]);

    await purgeExpiredRegistrants(prisma, { now: RETENTION_START });

    expect(auditCreate).toHaveBeenCalledTimes(1);
    const data = auditCreate.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.action).toBe(REGISTRANT_RETENTION_AUDIT_ACTION);
    expect(data.entity).toBe('Registrant');
    expect(data.newValues).toMatchObject({ expired: 1, deleted: 1, failed: 0 });
    // Tabel audit jauh lebih banyak pembacanya daripada baris pendaftar itu
    // sendiri; nomor pendaftaran tidak boleh ikut tercatat di sana.
    expect(JSON.stringify(data)).not.toContain('SPMB-2026-0001');
  });

  it('dry run tidak menghapus dan tidak mencatat apa pun', async () => {
    const { prisma, auditCreate } = fakePrisma([registrant()]);

    const summary = await purgeExpiredRegistrants(prisma, {
      now: RETENTION_START,
      dryRun: true,
    });

    expect(deleteRegistrantMock).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
    // Tetap melaporkan apa yang *akan* dihapus — itulah gunanya dry run.
    expect(summary.expired).toHaveLength(1);
    expect(summary.deleted).toHaveLength(0);
  });

  /**
   * Baris pendaftar adalah **satu-satunya** catatan uang daftar ulang:
   * `recordRegistrationFee` menulis nominal, tanggal, dan verifikatornya ke
   * kolom `Registrant`, dan `roi.service.ts` membaca laporan kampanye dari sana.
   * Pendaftar yang sudah membayar lalu mengundurkan diri tidak boleh kehilangan
   * jejak uangnya karena sapuan otomatis.
   */
  it('tidak menghapus pendaftar yang sudah membayar biaya daftar ulang', async () => {
    const { prisma } = fakePrisma([
      registrant({
        id: 'bayar',
        registrationNo: 'SUDAH-BAYAR',
        registrationFeePaidAt: new Date('2026-02-01T00:00:00.000Z'),
      }),
      registrant({ id: 'belum', registrationNo: 'BELUM-BAYAR' }),
    ]);

    const summary = await purgeExpiredRegistrants(prisma, {
      now: new Date('2030-01-01T00:00:00.000Z'),
    });

    expect(summary.expired.map((r) => r.registrationNo)).toEqual(['BELUM-BAYAR']);
    expect(deleteRegistrantMock).not.toHaveBeenCalledWith('bayar');
  });

  /**
   * Permintaan hak subjek yang masih terbuka harus tetap punya subjeknya:
   * `subjectRegistrantId` memakai `onDelete: SetNull`, jadi barisnya selamat
   * tetapi objek yang diminta hilang lebih dulu.
   */
  it('menahan pendaftar yang masih punya permintaan hak subjek terbuka', async () => {
    const { prisma, auditCreate } = fakePrisma(
      [
        registrant({ id: 'minta-akses', registrationNo: 'MINTA-AKSES' }),
        registrant({ id: 'biasa', registrationNo: 'BIASA' }),
      ],
      { openRequests: ['minta-akses'] }
    );

    const summary = await purgeExpiredRegistrants(prisma, { now: RETENTION_START });

    expect(summary.withheld).toBe(1);
    expect(deleteRegistrantMock).toHaveBeenCalledWith('biasa');
    expect(deleteRegistrantMock).not.toHaveBeenCalledWith('minta-akses');
    // Jumlah yang ditahan ikut tercatat: itu satu-satunya cara melihat ada
    // subjek yang menunggu jawaban, bukan sekadar lolos dari sapuan.
    expect((auditCreate.mock.calls[0]![0].data as any).newValues).toMatchObject({ withheld: 1 });
  });

  it('permintaan hak subjek yang sudah selesai tidak menahan apa pun', async () => {
    // Hanya RECEIVED/VERIFIED/PROCESSING yang menahan; yang COMPLETED/REJECTED
    // sudah tidak butuh subjeknya lagi.
    const { prisma } = fakePrisma([registrant({ id: 'reg-1' })], { openRequests: [] });

    const summary = await purgeExpiredRegistrants(prisma, { now: RETENTION_START });

    expect(summary.withheld).toBe(0);
    expect(summary.deleted).toHaveLength(1);
  });

  it('mendorong batas D+90 ke where, bukan hanya menyaring di JS', async () => {
    // Kueri yang mengambil seluruh riwayat pendaftar setiap malam akan menyapu
    // bertahun-tahun baris; batasnya harus sampai ke `where` supaya indeks
    // `@@index([waveId])`/`@@index([admissionPeriodId])` terpakai.
    const { prisma } = fakePrisma([registrant()]);

    await purgeExpiredRegistrants(prisma, { now: RETENTION_START });

    const where = (prisma.registrant.findMany as any).mock.calls[0][0].where;
    expect(where.registrationFeePaidAt).toBeNull();
    expect(where.OR).toBeDefined();
    // Cutoff = hari tutup terlama yang masih boleh dihapus = 2026-01-31.
    expect(where.OR[0].wave.reRegistrationEndDate.lte).toEqual(
      new Date('2026-01-31T00:00:00.000Z')
    );
  });

  it('cutoffCloseDayFor mundur 90 hari pada kalender WIB', () => {
    expect(cutoffCloseDayFor(RETENTION_START)).toBe('2026-01-31');
    expect(cutoffCloseDayFor(new Date('2026-04-30T16:59:00.000Z'))).toBe('2026-01-30');
  });

  it('kegagalan mencatat audit tidak menggagalkan penghapusan yang sudah terjadi', async () => {
    const { prisma } = fakePrisma([registrant()], { auditThrows: true });

    const summary = await purgeExpiredRegistrants(prisma, { now: RETENTION_START });

    expect(deleteRegistrantMock).toHaveBeenCalledWith('reg-1');
    expect(summary.deleted).toHaveLength(1);
  });
});
