import { describe, it, expect, vi, beforeEach } from 'vitest';

const { deleteMock, listMock } = vi.hoisted(() => ({
  deleteMock: vi.fn(),
  listMock: vi.fn(),
}));

vi.mock('@/utils/identity-document-store', async () => {
  // `orphanedIdentityDocuments` sengaja TIDAK dipalsukan: aturan yatimnya —
  // termasuk masa tenggang sehari — adalah bagian dari yang diuji di sini,
  // bukan latar yang boleh diganti.
  const actual = await vi.importActual<typeof import('@/utils/identity-document-store')>(
    '@/utils/identity-document-store'
  );
  return {
    ...actual,
    deleteIdentityDocument: deleteMock,
    listIdentityDocuments: listMock,
  };
});

import { purgeIdentityDocuments, IDENTITY_PURGE_AUDIT_ACTION } from './identity-purge.job';

const DAY = 24 * 60 * 60 * 1000;
const lama = () => new Date(Date.now() - 3 * DAY);

/**
 * Disk tiruan yang benar-benar kehilangan berkas ketika berkas itu dihapus.
 *
 * Bukan kerapian. Uji urutan di bawah bergantung padanya: kalau `listMock`
 * mengembalikan daftar tetap, berkas yang baru saja dihapus tahap satu tetap
 * muncul di sana dan uji itu akan gagal atas sebab yang salah — atau, lebih
 * buruk, lulus atas sebab yang salah ketika kodenya kelak diubah.
 */
function fakeDisk(files: Array<{ fileName: string; modifiedAt: Date }>) {
  const disk = new Map(files.map((f) => [f.fileName, f]));
  listMock.mockImplementation(async () => [...disk.values()]);
  deleteMock.mockImplementation(async (fileName: string) => {
    disk.delete(fileName);
  });
  return disk;
}

/**
 * Prisma tiruan yang cukup untuk pekerjaan ini, dan tidak lebih.
 *
 * `userIdentity.findMany` dipanggil dua kali dengan maksud yang berbeda —
 * pertama untuk baris kedaluwarsa, lalu untuk seluruh baris yang masih merujuk
 * berkas — jadi tiruannya menjawab menurut `where`-nya, bukan menurut urutan
 * panggilan. Menjawab menurut urutan akan tetap lulus walaupun kedua kueri itu
 * tertukar.
 */
function fakePrisma(opts: {
  expired?: any[];
  /** Baris lama: berkasnya ada, batas simpannya kosong. */
  backfill?: any[];
  referenced?: string[];
  auditThrows?: boolean;
}) {
  const referenced = new Set(opts.referenced ?? []);
  const auditCreate = vi.fn(async (_args: { data: Record<string, unknown> }) => {
    if (opts.auditThrows) throw new Error('audit_logs tidak dapat ditulis');
    return { id: 'a1' };
  });
  const update = vi.fn(async ({ where }: any) => {
    for (const row of opts.expired ?? []) {
      if (row.userId === where.userId) referenced.delete(row.ktpFileName);
    }
    return {};
  });
  return {
    prisma: {
      userIdentity: {
        findMany: vi.fn(async ({ where }: any) => {
          if (where.ktpRetainUntil?.lte) return opts.expired ?? [];
          // `ktpRetainUntil: null` — baris lama yang belum punya batas simpan.
          if (where.ktpRetainUntil === null) return opts.backfill ?? [];
          return [...referenced].map((ktpFileName) => ({ ktpFileName }));
        }),
        update,
      },
      auditLog: { create: auditCreate },
    } as any,
    auditCreate,
    update,
  };
}

function expiredRow(fileName: string, name = 'H. Ramram') {
  return {
    userId: `u-${fileName}`,
    ktpFileName: fileName,
    ktpRetainUntil: new Date('2020-01-01'),
    user: { name },
  };
}

beforeEach(() => {
  deleteMock.mockReset();
  listMock.mockReset();
  fakeDisk([]);
});

describe('purgeIdentityDocuments', () => {
  it('menghapus berkas yang masa simpannya lewat dan menandai barisnya', async () => {
    const { prisma, update } = fakePrisma({
      expired: [expiredRow('kedaluwarsa.jpg')],
      referenced: ['kedaluwarsa.jpg'],
    });

    const summary = await purgeIdentityDocuments(prisma);

    expect(deleteMock).toHaveBeenCalledWith('kedaluwarsa.jpg');
    expect(update).toHaveBeenCalledWith({
      where: { userId: 'u-kedaluwarsa.jpg' },
      data: expect.objectContaining({ ktpFileName: null }),
    });
    expect(summary.expired).toHaveLength(1);
    expect(summary.expired[0].ownerName).toBe('H. Ramram');
  });

  it('menyapu berkas yatim yang tidak dirujuk baris mana pun', async () => {
    fakeDisk([
      { fileName: 'yatim.jpg', modifiedAt: lama() },
      { fileName: 'dirujuk.jpg', modifiedAt: lama() },
    ]);
    const { prisma } = fakePrisma({ referenced: ['dirujuk.jpg'] });

    const summary = await purgeIdentityDocuments(prisma);

    expect(summary.orphans.map((o) => o.fileName)).toEqual(['yatim.jpg']);
    expect(deleteMock).toHaveBeenCalledWith('yatim.jpg');
    expect(deleteMock).not.toHaveBeenCalledWith('dirujuk.jpg');
  });

  /**
   * Urutannya menentukan jawabannya, bukan sekadar rapi.
   *
   * Berkas yang baru saja dihapus tahap satu sudah tidak dirujuk baris mana
   * pun. Kalau daftar rujukan dibaca **sebelum** tahap satu berjalan, ia masih
   * menyebut berkas itu dan tidak ada akibatnya; kalau berkasnya masih terdaftar
   * di disk sementara barisnya sudah dikosongkan, ia akan terhitung dua kali —
   * sekali sebagai kedaluwarsa, sekali sebagai yatim — dan laporan penghapusan
   * menyebut angka yang lebih besar daripada berkas yang benar-benar ada.
   */
  it('tidak menghitung berkas kedaluwarsa sebagai yatim pada jalan yang sama', async () => {
    fakeDisk([{ fileName: 'kedaluwarsa.jpg', modifiedAt: lama() }]);
    const { prisma } = fakePrisma({
      expired: [expiredRow('kedaluwarsa.jpg')],
      referenced: ['kedaluwarsa.jpg'],
    });

    const summary = await purgeIdentityDocuments(prisma);

    expect(summary.expired).toHaveLength(1);
    expect(summary.orphans).toHaveLength(0);
    expect(deleteMock).toHaveBeenCalledTimes(1);
  });

  it('berkas yang baru ditulis tidak disapu walau tidak dirujuk', async () => {
    fakeDisk([{ fileName: 'baru-diunggah.jpg', modifiedAt: new Date() }]);
    const { prisma } = fakePrisma({ referenced: [] });

    const summary = await purgeIdentityDocuments(prisma);

    expect(summary.orphans).toHaveLength(0);
    expect(deleteMock).not.toHaveBeenCalled();
  });

  /**
   * Baris yang diunggah sebelum jaring pengaman `ktpRetainUntil` ada tidak akan
   * pernah cocok dengan saringan kedaluwarsa, dan tidak pernah menjadi yatim
   * karena berkasnya masih dirujuk. Tanpa langkah ini foto KTP-nya tersimpan
   * tanpa batas waktu — persis kelas yang ditutup `eraseUserIdentity`, hanya
   * bentuknya baris lama alih-alih penghapusan subjek.
   */
  it('memberi batas simpan pada baris lama yang belum punya, bukan menghapusnya', async () => {
    const { prisma, update } = fakePrisma({
      backfill: [{ userId: 'u-lama' }],
      referenced: ['lama.jpg'],
    });

    const summary = await purgeIdentityDocuments(prisma);

    expect(summary.backfilled).toBe(1);
    expect(update).toHaveBeenCalledWith({
      where: { userId: 'u-lama' },
      data: { ktpRetainUntil: expect.any(Date) },
    });
    // Memberi batas, bukan menghapus: bukti registrasi tetap disimpan sampai
    // batas itu lewat, dan berkasnya belum boleh dibuang pada jalan ini.
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('batas simpan hasil backfill berada di masa depan, bukan langsung kedaluwarsa', async () => {
    const { prisma, update } = fakePrisma({ backfill: [{ userId: 'u-lama' }] });

    await purgeIdentityDocuments(prisma);

    const data = update.mock.calls[0]![0].data as { ktpRetainUntil: Date };
    expect(data.ktpRetainUntil.getTime()).toBeGreaterThan(Date.now());
  });

  it('dry run tidak menulis backfill apa pun', async () => {
    const { prisma, update } = fakePrisma({ backfill: [{ userId: 'u-lama' }] });

    const summary = await purgeIdentityDocuments(prisma, { dryRun: true });

    expect(update).not.toHaveBeenCalled();
    // Tetap dilaporkan: itulah gunanya dry run.
    expect(summary.backfilled).toBe(1);
  });

  it('dry run tidak menghapus apa pun dan tidak mencatat apa pun', async () => {
    fakeDisk([{ fileName: 'yatim.jpg', modifiedAt: lama() }]);
    const { prisma, auditCreate, update } = fakePrisma({
      expired: [expiredRow('kedaluwarsa.jpg')],
      referenced: ['kedaluwarsa.jpg'],
    });

    const summary = await purgeIdentityDocuments(prisma, { dryRun: true });

    expect(deleteMock).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
    // Tetap melaporkan apa yang *akan* dihapus — itulah gunanya dry run.
    expect(summary.expired).toHaveLength(1);
    expect(summary.orphans).toHaveLength(1);
  });

  /**
   * Baris audit inilah yang membuat penjadwal dalam proses dapat diperiksa.
   *
   * Log kontainer diputar pada 10 MB × 3 berkas sementara pekerjaan metrik
   * menulis satu baris tiap menit, jadi bukti bahwa penyapuan berjalan pekan
   * lalu sudah tergilas jauh sebelum ada yang menanyakannya. Tanpa baris ini,
   * "retensi tujuh tahun" kembali menjadi kolom yang tidak pernah diuji siapa
   * pun — persis keadaan sebelum pekerjaan ini dijadwalkan.
   */
  it('mencatat satu baris audit berisi jumlah, bukan nama berkas', async () => {
    fakeDisk([{ fileName: 'yatim.jpg', modifiedAt: lama() }]);
    const { prisma, auditCreate } = fakePrisma({
      expired: [expiredRow('kedaluwarsa.jpg')],
      referenced: ['kedaluwarsa.jpg'],
    });

    await purgeIdentityDocuments(prisma);

    expect(auditCreate).toHaveBeenCalledTimes(1);
    const data = auditCreate.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.action).toBe(IDENTITY_PURGE_AUDIT_ACTION);
    expect(data.entity).toBe('UserIdentity');
    expect(data.newValues).toMatchObject({ expired: 1, orphans: 1 });
    // Namanya acak justru agar tidak menyebut siapa pun; menuliskannya ke
    // tabel yang jauh lebih banyak pembacanya membatalkan gunanya.
    expect(JSON.stringify(data)).not.toContain('yatim.jpg');
    expect(JSON.stringify(data)).not.toContain('kedaluwarsa.jpg');
  });

  /**
   * Berkasnya sudah lenyap sebelum baris audit ditulis. Melempar galat di sini
   * membuat penjadwal melaporkan kegagalan atas pekerjaan yang berhasil — dan
   * yang lebih buruk, mengundang orang menjalankannya ulang untuk "memperbaiki"
   * sesuatu yang sudah beres.
   */
  it('kegagalan mencatat tidak menggagalkan penghapusan yang sudah terjadi', async () => {
    fakeDisk([{ fileName: 'yatim.jpg', modifiedAt: lama() }]);
    const { prisma } = fakePrisma({ referenced: [], auditThrows: true });

    const summary = await purgeIdentityDocuments(prisma);

    expect(deleteMock).toHaveBeenCalledWith('yatim.jpg');
    expect(summary.orphans).toHaveLength(1);
  });
});
