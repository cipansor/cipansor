import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../../lib/prisma';
import { EsignService } from '../esign.service';
import {
  createKeyMaterial,
  signPayload,
  signPdfHash,
  verifyRevocation,
  type SignablePayload,
} from '@/utils/esign';
import crypto from 'crypto';
import { readUploadedPdfBytes } from '@/utils/letter-uploaded-file';
import { stampRevoked } from '@/utils/generate-letter-pdf';
import { PDFDocument, StandardFonts } from 'pdf-lib';

/** PDF kecil yang sah, cukup untuk dapat dicap ulang. */
async function tinyPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  doc.addPage().drawText('Naskah dinas', { x: 40, y: 700, size: 12, font });
  doc.setCreationDate(new Date(0));
  doc.setModificationDate(new Date(0));
  return Buffer.from(await doc.save());
}

const { emitMock, compareMock } = vi.hoisted(() => ({
  emitMock: vi.fn(),
  compareMock: vi.fn(),
}));

vi.mock('../../../lib/prisma', () => ({
  prisma: {
    $executeRaw: vi.fn(),
    userSigningKey: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    signingKeyStatusRecord: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    signingKeyRequest: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    letter: { findUnique: vi.fn(), update: vi.fn() },
    letterReviewer: { update: vi.fn() },
    letterSignature: {
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    letterFlowEvent: { create: vi.fn() },
    letterSignedDocument: { create: vi.fn(), findUnique: vi.fn() },
    letterUpload: { findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
    user: { findUnique: vi.fn() },
    userIdentity: { findUnique: vi.fn(), findFirst: vi.fn(), upsert: vi.fn(), update: vi.fn() },
    $transaction: vi.fn((cb: any) => cb(prisma)),
  },
}));
vi.mock('../../../lib/event-bus', () => ({ eventBus: { emit: emitMock } }));
vi.mock('@/lib/event-bus', () => ({ eventBus: { emit: emitMock } }));
vi.mock('@/lib/password', () => ({ comparePassword: compareMock }));
vi.mock('@/utils/letter-uploaded-file', () => ({
  readUploadedPdfBytes: vi.fn(),
  uploadFilenameFromUrl: vi.fn((url: string | null | undefined) =>
    url ? (url.split('/uploads/')[1]?.split(/[?#]/)[0] ?? null) : null
  ),
}));

const PASS = 'kalimat-sandi-tanda-tangan-2026';
const DAY = 24 * 60 * 60 * 1000;

/**
 * Identitas yang lengkap dan sudah diverifikasi.
 *
 * Bawaan untuk hampir setiap uji di berkas ini, karena kebanyakan menguji
 * perilaku *setelah* syarat identitas terpenuhi. Yang menguji syaratnya sendiri
 * mengganti nilainya sendiri.
 */
function verifiedIdentity(over: Record<string, unknown> = {}) {
  return {
    id: 'identity-1',
    userId: 'ketua',
    legalName: 'Haji Endang Suryana',
    nik: '3206051205750001',
    birthPlace: 'Tasikmalaya',
    birthDate: new Date('1975-05-12T00:00:00.000Z'),
    verifiedAt: new Date('2026-08-01T00:00:00.000Z'),
    verifiedById: 'superadmin',
    verificationNote: null,
    ktpFileName: 'ktp-abc.jpg',
    ktpSha256: 'a'.repeat(64),
    ktpUploadedAt: new Date('2026-07-31T00:00:00.000Z'),
    ktpRetainUntil: null,
    ktpDeletedAt: null,
    ...over,
  };
}

/** Kunci aktif lengkap dengan bahan kriptografinya. */
function activeKey(over: Record<string, unknown> = {}) {
  const m = createKeyMaterial(PASS);
  return {
    id: 'key-1',
    userId: 'ketua',
    ...m,
    kdfParams: m.kdfParams as unknown,
    failedAttempts: 0,
    lockedUntil: null,
    approvedAt: new Date(Date.now() - 10 * DAY),
    expiresAt: new Date(Date.now() + 200 * DAY),
    revokedAt: null,
    revokedReason: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Identitas terverifikasi adalah keadaan bawaan: syarat identitas diuji
  // tersendiri di bawah, dan menuntut setiap uji lain menyiapkannya hanya
  // membuat semuanya menguji dua hal sekaligus.
  vi.mocked(prisma.userIdentity.findUnique).mockResolvedValue(verifiedIdentity() as any);
});

/**
 * Gerbang identitas.
 *
 * Sebuah tanda tangan elektronik mengikat kepada orang, dan ia mengikat hanya
 * sejauh penerbitnya tahu siapa orang itu. Kunci yang terbit untuk akun tanpa
 * identitas menghasilkan tanda tangan yang membuktikan pengetahuan passphrase
 * dan tidak lebih.
 */
describe('identitas sebagai syarat kunci', () => {
  it('menolak pengajuan bila datanya belum lengkap, sambil menyebut apa yang kurang', async () => {
    vi.mocked(prisma.signingKeyRequest.findFirst).mockResolvedValue(null as any);
    vi.mocked(prisma.userIdentity.findUnique).mockResolvedValue(
      verifiedIdentity({ birthPlace: null }) as any
    );

    await expect(EsignService.requestKey('ketua')).rejects.toThrow(/tempat lahir/);
    expect(prisma.signingKeyRequest.create).not.toHaveBeenCalled();
  });

  /**
   * **Uji ini dahulu menegaskan kebalikannya, dan kebalikannya adalah bug.**
   *
   * Ia menuntut `requestKey` menolak identitas yang belum diverifikasi. Tetapi
   * verifikasi hanya terjadi di `decideRequest`, atas sebuah pengajuan — jadi
   * aturan itu menutup satu-satunya pintu menuju verifikasi, dan di produksi
   * 2026-09-03 tidak seorang pun dapat memperoleh kunci: setiap pengajuan
   * dijawab "sudah lengkap tetapi belum diverifikasi", selamanya.
   *
   * Uji lama hijau karena ia menguji separuh rantai terhadap dirinya sendiri.
   * Yang menemukannya adalah menelusuri rantainya di sistem yang berjalan.
   */
  it('MENERIMA pengajuan yang datanya lengkap dan ada KTP walau belum diverifikasi', async () => {
    vi.mocked(prisma.signingKeyRequest.findFirst).mockResolvedValue(null as any);
    vi.mocked(prisma.userSigningKey.findUnique).mockResolvedValue(null as any);
    vi.mocked(prisma.userIdentity.findUnique).mockResolvedValue(
      verifiedIdentity({ verifiedAt: null, verifiedById: null }) as any
    );
    vi.mocked(prisma.signingKeyRequest.create).mockResolvedValue({ id: 'req-1' } as any);

    await EsignService.requestKey('ketua');
    expect(prisma.signingKeyRequest.create).toHaveBeenCalled();
  });

  /**
   * Yang tetap ditolak: tanpa foto KTP, Super Admin tidak punya apa pun untuk
   * dicocokkan, jadi pengajuannya akan tergeletak tidak dapat diputuskan.
   */
  it('menolak pengajuan bila foto KTP-nya belum diunggah', async () => {
    vi.mocked(prisma.signingKeyRequest.findFirst).mockResolvedValue(null as any);
    vi.mocked(prisma.userIdentity.findUnique).mockResolvedValue(
      verifiedIdentity({ verifiedAt: null, ktpFileName: null }) as any
    );

    await expect(EsignService.requestKey('ketua')).rejects.toThrow(/foto KTP/);
    expect(prisma.signingKeyRequest.create).not.toHaveBeenCalled();
  });

  it('menolak pengajuan dari akun yang belum punya identitas sama sekali', async () => {
    vi.mocked(prisma.signingKeyRequest.findFirst).mockResolvedValue(null as any);
    vi.mocked(prisma.userIdentity.findUnique).mockResolvedValue(null as any);

    await expect(EsignService.requestKey('ketua')).rejects.toThrow(/Lengkapi dulu/);
  });

  /**
   * Verifikasi menyatakan bahwa data *yang itu* sudah dicocokkan. Tanpa aturan
   * ini, seseorang dapat lolos verifikasi dengan datanya sendiri lalu
   * menggantinya menjadi milik orang lain, dan kunci berikutnya terbit atas nama
   * yang tidak pernah diperiksa.
   */
  it('mengubah data identitas menggugurkan verifikasinya', async () => {
    vi.mocked(prisma.userSigningKey.findUnique).mockResolvedValue(null as any);
    vi.mocked(prisma.userIdentity.findFirst).mockResolvedValue(null as any);
    vi.mocked(prisma.userIdentity.upsert).mockResolvedValue(verifiedIdentity() as any);

    await EsignService.saveMyIdentity('ketua', {
      legalName: 'Haji Endang Suryana',
      nik: '3206.0512.0575.0001',
      birthPlace: 'Tasikmalaya',
      birthDate: '1975-05-12',
    });

    const call = vi.mocked(prisma.userIdentity.upsert).mock.calls.at(-1)![0] as any;
    expect(call.update.verifiedAt).toBeNull();
    expect(call.update.verifiedById).toBeNull();
    // NIK dinormalkan: orang menyalinnya dari KTP berikut titiknya.
    expect(call.update.nik).toBe('3206051205750001');
  });

  it('tidak mengembalikan NIK kepada pemiliknya sendiri — ia sudah mengetahuinya', async () => {
    vi.mocked(prisma.userSigningKey.findUnique).mockResolvedValue(null as any);
    vi.mocked(prisma.userIdentity.findFirst).mockResolvedValue(null as any);
    vi.mocked(prisma.userIdentity.upsert).mockResolvedValue(verifiedIdentity() as any);

    const result = await EsignService.saveMyIdentity('ketua', {
      legalName: 'Haji Endang Suryana',
      nik: '3206051205750001',
      birthPlace: 'Tasikmalaya',
      birthDate: '1975-05-12',
    });
    expect(result.nik).toBeUndefined();
  });

  /**
   * Melaporkan, bukan menolak: NIK menyandikan tanggal lahir, jadi
   * ketidakcocokan berarti salah satunya salah ketik — tetapi kekeliruan
   * pencatatan kependudukan juga ada.
   */
  it('melaporkan ketidakcocokan tanggal lahir dengan NIK tanpa menolaknya', async () => {
    vi.mocked(prisma.userSigningKey.findUnique).mockResolvedValue(null as any);
    vi.mocked(prisma.userIdentity.findFirst).mockResolvedValue(null as any);
    vi.mocked(prisma.userIdentity.upsert).mockResolvedValue(verifiedIdentity() as any);

    const result = await EsignService.saveMyIdentity('ketua', {
      legalName: 'Haji Endang Suryana',
      nik: '3206051205750001',
      birthPlace: 'Tasikmalaya',
      birthDate: '1975-05-21',
    });
    expect(result.warning).toMatch(/tidak sama/);
    expect(prisma.userIdentity.upsert).toHaveBeenCalled();
  });

  it('menolak NIK yang sudah mendasari akun lain', async () => {
    vi.mocked(prisma.userSigningKey.findUnique).mockResolvedValue(null as any);
    vi.mocked(prisma.userIdentity.findFirst).mockResolvedValue({ id: 'lain' } as any);

    await expect(
      EsignService.saveMyIdentity('ketua', {
        legalName: 'Haji Endang Suryana',
        nik: '3206051205750001',
        birthPlace: 'Tasikmalaya',
        birthDate: '1975-05-12',
      })
    ).rejects.toThrow(/akun lain/);
  });

  /**
   * Identitas itulah yang mendasari kunci yang sedang hidup; mengubahnya
   * diam-diam membuat surat yang sudah ditandatangani merujuk kepada orang yang
   * berbeda dari yang pernah diperiksa.
   */
  it('menolak mengubah identitas selagi kuncinya masih berlaku', async () => {
    vi.mocked(prisma.userSigningKey.findUnique).mockResolvedValue({
      revokedAt: null,
      expiresAt: new Date(Date.now() + 30 * DAY),
    } as any);

    await expect(
      EsignService.saveMyIdentity('ketua', {
        legalName: 'Haji Endang Suryana',
        nik: '3206051205750001',
        birthPlace: 'Tasikmalaya',
        birthDate: '1975-05-12',
      })
    ).rejects.toThrow(/masih berlaku/);
  });
});

describe('persetujuan menyatakan siapa orangnya', () => {
  const pending = {
    id: 'req-1',
    userId: 'ketua',
    kind: 'ENROLLMENT',
    status: 'PENDING',
  };

  it('menolak menyetujui bila identitas pemohon belum lengkap', async () => {
    vi.mocked(prisma.signingKeyRequest.findUnique).mockResolvedValue(pending as any);
    vi.mocked(prisma.userIdentity.findUnique).mockResolvedValue(
      verifiedIdentity({ nik: null }) as any
    );

    await expect(EsignService.decideRequest('req-1', 'superadmin', true, 30)).rejects.toThrow(
      /belum lengkap/
    );
    expect(prisma.signingKeyRequest.update).not.toHaveBeenCalled();
  });

  it('menolak menyetujui identitas yang belum diverifikasi tanpa menyebut caranya', async () => {
    vi.mocked(prisma.signingKeyRequest.findUnique).mockResolvedValue(pending as any);
    vi.mocked(prisma.userIdentity.findUnique).mockResolvedValue(
      verifiedIdentity({ verifiedAt: null }) as any
    );

    await expect(EsignService.decideRequest('req-1', 'superadmin', true, 30)).rejects.toThrow(
      /nyatakan kecocokannya/
    );
  });

  it('mencatat siapa yang memverifikasi, kapan, dan dengan cara apa', async () => {
    vi.mocked(prisma.signingKeyRequest.findUnique).mockResolvedValue(pending as any);
    vi.mocked(prisma.userIdentity.findUnique).mockResolvedValue(
      verifiedIdentity({ verifiedAt: null }) as any
    );
    vi.mocked(prisma.signingKeyRequest.update).mockResolvedValue({ id: 'req-1' } as any);
    vi.mocked(prisma.userSigningKey.deleteMany).mockResolvedValue({ count: 0 } as any);

    await EsignService.decideRequest('req-1', 'superadmin', true, 30, undefined, {
      note: 'Foto KTP dibuka dan cocok dengan data yang diisi.',
    });

    expect(prisma.userIdentity.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'ketua' },
        data: expect.objectContaining({
          verifiedById: 'superadmin',
          verificationNote: 'Foto KTP dibuka dan cocok dengan data yang diisi.',
        }),
      })
    );
  });

  /**
   * Satu-satunya jalur pembuktian. Pilihan "kartu ditunjukkan langsung" dan
   * "dikenali pribadi" pernah ada dan keduanya tidak meninggalkan apa pun yang
   * dapat diperiksa — seorang penyetuju dapat memilihnya tanpa melakukan apa
   * pun.
   */
  it('menolak menyetujui bila pemohon belum mengunggah foto KTP', async () => {
    vi.mocked(prisma.signingKeyRequest.findUnique).mockResolvedValue(pending as any);
    vi.mocked(prisma.userIdentity.findUnique).mockResolvedValue(
      verifiedIdentity({ verifiedAt: null, ktpFileName: null }) as any
    );

    await expect(
      EsignService.decideRequest('req-1', 'superadmin', true, 30, undefined, {
        note: 'cocok',
      })
    ).rejects.toThrow(/belum mengunggah foto KTP/);
    expect(prisma.signingKeyRequest.update).not.toHaveBeenCalled();
  });

  /**
   * Disetujui berarti ada kunci yang terbit, dan dasar penerbitannya dapat
   * dipersoalkan selama kunci itu masih dapat menandatangani. Karena itu
   * berkasnya **disimpan**, bukan dihapus — dengan batas waktu yang dihitung
   * dari akhir masa berlaku kuncinya, bukan dari hari keputusan.
   */
  it('menyimpan foto KTP setelah disetujui, dengan batas waktu dari akhir masa kunci', async () => {
    vi.mocked(prisma.signingKeyRequest.findUnique).mockResolvedValue(pending as any);
    vi.mocked(prisma.userIdentity.findUnique).mockResolvedValue(verifiedIdentity() as any);
    vi.mocked(prisma.signingKeyRequest.update).mockResolvedValue({ id: 'req-1' } as any);
    vi.mocked(prisma.userSigningKey.deleteMany).mockResolvedValue({ count: 0 } as any);

    await EsignService.decideRequest('req-1', 'superadmin', true, 30);

    const call = vi.mocked(prisma.userIdentity.update).mock.calls.at(-1)![0] as any;
    expect(call.data.ktpRetainUntil).toBeInstanceOf(Date);
    // Jauh di depan: 30 hari masa kunci ditambah masa retensi bertahun-tahun.
    expect(call.data.ktpRetainUntil.getTime()).toBeGreaterThan(Date.now() + 365 * DAY);
    // Dan berkasnya tidak dibuang.
    expect(call.data.ktpFileName).toBeUndefined();
  });

  /** Ditolak berarti tidak ada kunci — berkasnya tidak membuktikan apa pun lagi. */
  it('menghapus foto KTP setelah pengajuan ditolak', async () => {
    vi.mocked(prisma.signingKeyRequest.findUnique).mockResolvedValue(pending as any);
    vi.mocked(prisma.userIdentity.findUnique).mockResolvedValue(verifiedIdentity() as any);
    vi.mocked(prisma.signingKeyRequest.update).mockResolvedValue({ id: 'req-1' } as any);

    await EsignService.decideRequest('req-1', 'superadmin', false, undefined, 'Belum perlu.');

    expect(prisma.userIdentity.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ktpFileName: null }),
      })
    );
  });

  it('tidak menuntut verifikasi ulang untuk identitas yang sudah terverifikasi', async () => {
    vi.mocked(prisma.signingKeyRequest.findUnique).mockResolvedValue(pending as any);
    vi.mocked(prisma.signingKeyRequest.update).mockResolvedValue({ id: 'req-1' } as any);
    vi.mocked(prisma.userSigningKey.deleteMany).mockResolvedValue({ count: 0 } as any);

    await expect(EsignService.decideRequest('req-1', 'superadmin', true, 30)).resolves.toBeTruthy();

    // Barisnya memang tetap disentuh — batas simpan berkasnya ditetapkan di
    // sini. Yang diuji adalah verifikasinya tidak ditimpa ulang, bukan bahwa
    // tidak ada penulisan sama sekali: menegaskan "update tidak dipanggil"
    // mengukur mekanismenya, bukan akibatnya.
    for (const [call] of vi.mocked(prisma.userIdentity.update).mock.calls) {
      expect((call as any).data.verifiedById).toBeUndefined();
      expect((call as any).data.verificationNote).toBeUndefined();
    }
  });

  /** Menolak tidak menuntut apa pun: yang ditolak tidak menerbitkan kunci. */
  it('menolak pengajuan tanpa memeriksa identitas', async () => {
    vi.mocked(prisma.signingKeyRequest.findUnique).mockResolvedValue(pending as any);
    vi.mocked(prisma.userIdentity.findUnique).mockResolvedValue(null as any);
    vi.mocked(prisma.userSigningKey.findUnique).mockResolvedValue(null as any);
    vi.mocked(prisma.signingKeyRequest.update).mockResolvedValue({ id: 'req-1' } as any);

    await expect(
      EsignService.decideRequest('req-1', 'superadmin', false, undefined, 'Belum diperlukan.')
    ).resolves.toBeTruthy();
  });
});

describe('pengajuan kunci', () => {
  it('memilih ENROLLMENT bila belum punya kunci', async () => {
    vi.mocked(prisma.signingKeyRequest.findFirst).mockResolvedValue(null as any);
    vi.mocked(prisma.userSigningKey.findUnique).mockResolvedValue(null as any);
    vi.mocked(prisma.signingKeyRequest.create).mockResolvedValue({ id: 'r1' } as any);

    await EsignService.requestKey('ketua');

    expect(prisma.signingKeyRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: 'ENROLLMENT' }),
    });
  });

  it('memilih RENEWAL hanya ketika sudah dekat masa habis', async () => {
    vi.mocked(prisma.signingKeyRequest.findFirst).mockResolvedValue(null as any);
    vi.mocked(prisma.userSigningKey.findUnique).mockResolvedValue(
      activeKey({ expiresAt: new Date(Date.now() + 5 * DAY) }) as any
    );
    vi.mocked(prisma.signingKeyRequest.create).mockResolvedValue({ id: 'r1' } as any);

    await EsignService.requestKey('ketua');

    expect(prisma.signingKeyRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: 'RENEWAL' }),
    });
  });

  it('menolak bila kunci masih lama berlakunya', async () => {
    vi.mocked(prisma.signingKeyRequest.findFirst).mockResolvedValue(null as any);
    vi.mocked(prisma.userSigningKey.findUnique).mockResolvedValue(activeKey() as any);

    await expect(EsignService.requestKey('ketua')).rejects.toThrow(/masih berlaku/i);
  });

  it('menolak pengajuan ganda selagi satu masih menunggu', async () => {
    vi.mocked(prisma.signingKeyRequest.findFirst).mockResolvedValue({ id: 'r0' } as any);
    await expect(EsignService.requestKey('ketua')).rejects.toThrow(/masih menunggu/i);
  });
});

describe('putusan Super Admin', () => {
  it('menolak masa berlaku di luar batas', async () => {
    vi.mocked(prisma.signingKeyRequest.findUnique).mockResolvedValue({
      id: 'r1',
      userId: 'ketua',
      kind: 'ENROLLMENT',
      status: 'PENDING',
    } as any);

    await expect(EsignService.decideRequest('r1', 'admin', true, 5000)).rejects.toThrow(
      /Masa berlaku/i
    );
  });

  it('perpanjangan memperpanjang kunci yang ada, tidak menggantinya', async () => {
    const key = activeKey({ expiresAt: new Date(Date.now() + 5 * DAY) });
    vi.mocked(prisma.signingKeyRequest.findUnique).mockResolvedValue({
      id: 'r1',
      userId: 'ketua',
      kind: 'RENEWAL',
      status: 'PENDING',
    } as any);
    vi.mocked(prisma.signingKeyRequest.update).mockResolvedValue({ id: 'r1' } as any);
    vi.mocked(prisma.userSigningKey.findUnique).mockResolvedValue(key as any);

    await EsignService.decideRequest('r1', 'admin', true, 365);

    expect(prisma.userSigningKey.deleteMany).not.toHaveBeenCalled();
    expect(prisma.userSigningKey.update).toHaveBeenCalledWith({
      where: { id: key.id },
      data: expect.objectContaining({ expiresAt: expect.any(Date) }),
    });
  });

  /**
   * Penerbitan ulang menghapus baris kunci aktifnya, sehingga sidik jari pada
   * surat-surat lama kehilangan sumbernya. Statusnya harus diarsipkan lebih
   * dahulu, kalau tidak layanan status publik menjawab UNKNOWN untuk kunci yang
   * sebenarnya sekadar kedaluwarsa.
   */
  it('menerbitkan ulang mengarsipkan status kunci lama sebelum menghapusnya', async () => {
    const base = activeKey({
      revokedAt: new Date(Date.now() - 5 * DAY),
      revocationCode: 'SUPERSEDED',
    });
    const key = { ...base, fingerprint: base.fingerprint };
    vi.mocked(prisma.signingKeyRequest.findUnique).mockResolvedValue({
      id: 'r1',
      userId: 'ketua',
      kind: 'ENROLLMENT',
      status: 'PENDING',
    } as any);
    vi.mocked(prisma.signingKeyRequest.update).mockResolvedValue({ id: 'r1' } as any);
    vi.mocked(prisma.userSigningKey.findUnique).mockResolvedValue(key as any);
    vi.mocked(prisma.signingKeyStatusRecord.upsert).mockResolvedValue({} as any);
    vi.mocked(prisma.userSigningKey.deleteMany).mockResolvedValue({ count: 1 } as any);

    await EsignService.decideRequest('r1', 'admin', true, 365);

    const upsert = vi.mocked(prisma.signingKeyStatusRecord.upsert).mock.calls.at(-1)![0] as any;
    expect(upsert.where).toEqual({ fingerprint: key.fingerprint });
    expect(upsert.create).toMatchObject({
      userId: 'ketua',
      revocationCode: 'SUPERSEDED',
      // Metadata publik saja — bahan kunci privat tidak boleh ikut tersalin.
    });
    expect(JSON.stringify(upsert.create)).not.toContain(key.encryptedPrivateKey);
    // Arsip ditulis dahulu, baru baris aktifnya dihapus.
    expect(prisma.signingKeyStatusRecord.upsert).toHaveBeenCalled();
    expect(prisma.userSigningKey.deleteMany).toHaveBeenCalledTimes(1);
  });

  it('tidak memutus pengajuan yang sudah diputus', async () => {
    vi.mocked(prisma.signingKeyRequest.findUnique).mockResolvedValue({
      id: 'r1',
      userId: 'ketua',
      kind: 'ENROLLMENT',
      status: 'APPROVED',
    } as any);
    await expect(EsignService.decideRequest('r1', 'admin', true)).rejects.toThrow(
      /sudah diputuskan/i
    );
  });
});

describe('ganti passphrase', () => {
  it('menolak bila password akun salah — passphrase saja tidak cukup', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ passwordHash: 'h' } as any);
    compareMock.mockResolvedValue(false);

    await expect(
      EsignService.changePassphrase('ketua', PASS, 'password-salah', 'passphrase-baru-2026')
    ).rejects.toThrow(/Password akun salah/i);

    expect(prisma.userSigningKey.update).not.toHaveBeenCalled();
  });

  it('mencatat percobaan gagal bila passphrase lama salah', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ passwordHash: 'h' } as any);
    compareMock.mockResolvedValue(true);
    vi.mocked(prisma.userSigningKey.findUnique).mockResolvedValue(activeKey() as any);

    await expect(
      EsignService.changePassphrase(
        'ketua',
        'passphrase-salah-sekali',
        'pw',
        'passphrase-baru-2026'
      )
    ).rejects.toThrow();

    expect(prisma.userSigningKey.update).toHaveBeenCalledWith({
      where: { id: 'key-1' },
      data: expect.objectContaining({ failedAttempts: 1 }),
    });
  });
});

describe('menandatangani surat', () => {
  const letter = (over: Record<string, unknown> = {}) => ({
    id: 'letter-1',
    letterNumber: '434/Sket/Y-CPS/VII/2026',
    date: new Date('2026-07-13T00:00:00Z'),
    type: 'SURAT_KETERANGAN',
    nature: 'PUBLIC',
    subject: 'Keterangan',
    content: 'Isi.',
    unitId: 'unit-1',
    status: 'READY_TO_SIGN',
    reviewers: [{ id: 'rev-1', reviewerId: 'ketua', isSigner: true, order: 1, status: 'PENDING' }],
    ...over,
  });

  it('menolak bukan penandatangan', async () => {
    vi.mocked(prisma.letter.findUnique).mockResolvedValue(
      letter({ reviewers: [{ id: 'r', reviewerId: 'orang-lain', isSigner: true }] }) as any
    );
    await expect(EsignService.signLetter('letter-1', 'ketua', PASS)).rejects.toThrow(
      /bukan penandatangan/i
    );
  });

  it('menolak bila surat belum sampai giliran tanda tangan', async () => {
    vi.mocked(prisma.letter.findUnique).mockResolvedValue(
      letter({ status: 'PENDING_REVIEW' }) as any
    );
    await expect(EsignService.signLetter('letter-1', 'ketua', PASS)).rejects.toThrow(
      /belum siap ditandatangani/i
    );
  });

  it('menolak bila kunci kedaluwarsa', async () => {
    vi.mocked(prisma.letter.findUnique).mockResolvedValue(letter() as any);
    vi.mocked(prisma.userSigningKey.findUnique).mockResolvedValue(
      activeKey({ expiresAt: new Date(Date.now() - DAY) }) as any
    );
    await expect(EsignService.signLetter('letter-1', 'ketua', PASS)).rejects.toThrow(
      /Masa berlaku/i
    );
  });

  it('passphrase salah dicatat dan tidak menandatangani apa pun', async () => {
    vi.mocked(prisma.letter.findUnique).mockResolvedValue(letter() as any);
    vi.mocked(prisma.userSigningKey.findUnique).mockResolvedValue(activeKey() as any);

    await expect(
      EsignService.signLetter('letter-1', 'ketua', 'passphrase-yang-salah')
    ).rejects.toThrow(/Passphrase.*salah/i);

    expect(prisma.letterSignature.create).not.toHaveBeenCalled();
    expect(prisma.letter.update).not.toHaveBeenCalled();
    expect(prisma.userSigningKey.update).toHaveBeenCalledWith({
      where: { id: 'key-1' },
      data: expect.objectContaining({ failedAttempts: 1 }),
    });
  });

  it('menandatangani, menandai surat SIGNED, dan mencatat riwayat', async () => {
    vi.mocked(prisma.letter.findUnique).mockResolvedValue(letter() as any);
    vi.mocked(prisma.userSigningKey.findUnique).mockResolvedValue(activeKey() as any);
    vi.mocked(prisma.letterSignature.create).mockResolvedValue({
      id: 'sig-1',
      verificationToken: 'tok',
      signedAt: new Date(),
    } as any);
    vi.mocked(prisma.letterSignature.update).mockResolvedValue({
      id: 'sig-1',
      verificationToken: 'tok',
      signedAt: new Date(),
    } as any);

    const out = await EsignService.signLetter('letter-1', 'ketua', PASS);

    expect(out.verificationToken).toBe('tok');
    expect(prisma.letter.update).toHaveBeenCalledWith({
      where: { id: 'letter-1' },
      data: { status: 'SIGNED' },
    });
    expect(prisma.letterFlowEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'SIGNED', actorId: 'ketua' }),
    });
    // Hash PDF ditulis sebagai bagian dari penandatanganan, bukan sesudahnya.
    expect(prisma.letterSignature.update).toHaveBeenCalledWith({
      where: { id: 'sig-1' },
      data: expect.objectContaining({
        pdfHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        pdfSignature: expect.any(String),
      }),
    });
  });

  /**
   * Garis kewenangan (a.n./u.b./Plt./Plh.) adalah pernyataan yang dipublikasikan.
   *
   * Ia tercetak pada naskah dan ikut ditandatangani, jadi ia harus tiba utuh di
   * baris tanda tangan — dan bentuk yang menuntut jabatan yang diwakili harus
   * ditolak bila jabatan itu kosong, bukan diterima lalu dicetak setengah.
   */
  it('menolak bentuk a.n. tanpa jabatan yang diwakili', async () => {
    vi.mocked(prisma.letter.findUnique).mockResolvedValue(letter() as any);
    vi.mocked(prisma.userSigningKey.findUnique).mockResolvedValue(activeKey() as any);

    await expect(
      EsignService.signLetter('letter-1', 'ketua', PASS, 'YAYASAN_KETUA', {
        form: 'ATAS_NAMA' as any,
      })
    ).rejects.toThrow(/jabatan yang diwakili wajib diisi/i);

    expect(prisma.letterSignature.create).not.toHaveBeenCalled();
  });

  it('menyimpan garis kewenangan pada baris tanda tangan', async () => {
    vi.mocked(prisma.letter.findUnique).mockResolvedValue(letter() as any);
    vi.mocked(prisma.userSigningKey.findUnique).mockResolvedValue(activeKey() as any);
    vi.mocked(prisma.letterSignature.create).mockResolvedValue({
      id: 'sig-1',
      verificationToken: 'tok',
      signedAt: new Date(),
    } as any);
    vi.mocked(prisma.letterSignature.update).mockResolvedValue({
      id: 'sig-1',
      verificationToken: 'tok',
      signedAt: new Date(),
    } as any);

    await EsignService.signLetter('letter-1', 'ketua', PASS, 'YAYASAN_KETUA', {
      form: 'ATAS_NAMA' as any,
      representedOffice: "Kepala SMA Qur'an Cipansor",
    });

    expect(prisma.letterSignature.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        signingAuthorityForm: 'ATAS_NAMA',
        representedOffice: "Kepala SMA Qur'an Cipansor",
      }),
    });
  });

  it('bawaan NONE: tanpa jabatan yang diwakili pun diterima', async () => {
    vi.mocked(prisma.letter.findUnique).mockResolvedValue(letter() as any);
    vi.mocked(prisma.userSigningKey.findUnique).mockResolvedValue(activeKey() as any);
    vi.mocked(prisma.letterSignature.create).mockResolvedValue({
      id: 'sig-1',
      verificationToken: 'tok',
      signedAt: new Date(),
    } as any);
    vi.mocked(prisma.letterSignature.update).mockResolvedValue({
      id: 'sig-1',
      verificationToken: 'tok',
      signedAt: new Date(),
    } as any);

    await EsignService.signLetter('letter-1', 'ketua', PASS);

    expect(prisma.letterSignature.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        signingAuthorityForm: 'NONE',
        representedOffice: null,
      }),
    });
  });

  /**
   * Byte-nya diarsipkan, bukan dijanjikan dapat dibuat ulang.
   *
   * Selama unduhan membuat ulang naskahnya, verifikasi publik bertumpu pada
   * janji bahwa penghasil PDF akan mengeluarkan byte identik selamanya — dan
   * satu kenaikan versi `pdf-lib` cukup untuk membatalkan seluruh surat yang
   * pernah ditandatangani sekaligus.
   */
  it('mengarsipkan byte naskah yang ditandatangani, dengan hash yang sama', async () => {
    vi.mocked(prisma.letter.findUnique).mockResolvedValue(letter() as any);
    vi.mocked(prisma.userSigningKey.findUnique).mockResolvedValue(activeKey() as any);
    vi.mocked(prisma.letterSignature.create).mockResolvedValue({
      id: 'sig-1',
      verificationToken: 'tok',
      signedAt: new Date(),
    } as any);
    vi.mocked(prisma.letterSignature.update).mockResolvedValue({
      id: 'sig-1',
      verificationToken: 'tok',
      signedAt: new Date(),
    } as any);

    await EsignService.signLetter('letter-1', 'ketua', PASS);

    const signedHash = vi.mocked(prisma.letterSignature.update).mock.calls[0][0].data
      .pdfHash as string;
    const archived = vi.mocked(prisma.letterSignedDocument.create).mock.calls[0][0].data as any;

    expect(archived.signatureId).toBe('sig-1');
    expect(archived.sha256).toBe(signedHash);
    expect(archived.byteSize).toBe(archived.bytes.length);
    expect(crypto.createHash('sha256').update(archived.bytes).digest('hex')).toBe(signedHash);
    expect(archived.generator).toMatch(/^cipansor-naskah\//);
  });

  /**
   * Sebuah surat SIGNED yang arsipnya gagal ditulis adalah surat yang tidak
   * dapat dicetak sesuai aslinya. Itu bukan keadaan yang boleh lolos diam-diam,
   * jadi kegagalannya membatalkan penandatanganan seperti kegagalan lain.
   */
  it('tidak menandatangani bila arsipnya gagal ditulis', async () => {
    vi.mocked(prisma.letter.findUnique).mockResolvedValue(letter() as any);
    vi.mocked(prisma.userSigningKey.findUnique).mockResolvedValue(activeKey() as any);
    vi.mocked(prisma.letterSignature.create).mockResolvedValue({
      id: 'sig-1',
      verificationToken: 'tok',
      signedAt: new Date(),
    } as any);
    vi.mocked(prisma.letterSignature.update).mockResolvedValue({ id: 'sig-1' } as any);
    vi.mocked(prisma.letterSignedDocument.create).mockRejectedValue(
      new Error('bytea write failed')
    );

    await expect(EsignService.signLetter('letter-1', 'ketua', PASS)).rejects.toThrow(
      /bytea write failed/
    );
  });

  /**
   * Naskah yang tidak dapat dirender tidak boleh menghasilkan surat SIGNED.
   *
   * Sebelumnya pembuatan PDF berada di luar transaksi, dibungkus `try/catch`
   * yang hanya mencetak ke konsol. Setiap kegagalan meninggalkan surat berstatus
   * SIGNED dengan `pdfHash` kosong — dan karena unggah berkas adalah satu-satunya
   * cara memverifikasi, surat itu selamanya tidak bisa dibuktikan asli. Yang
   * dilihat publik pun bukan "sistem bermasalah", melainkan tuduhan bahwa
   * dokumennya telah diubah.
   */
  it('menolak menandatangani bila naskahnya tidak dapat dirender', async () => {
    vi.mocked(prisma.letter.findUnique).mockResolvedValue(
      letter({ content: 'Kutipan: \u0628\u0633\u0645 \u0627\u0644\u0644\u0647' }) as any
    );
    vi.mocked(prisma.userSigningKey.findUnique).mockResolvedValue(activeKey() as any);
    vi.mocked(prisma.letterSignature.create).mockResolvedValue({
      id: 'sig-1',
      verificationToken: 'tok',
      signedAt: new Date(),
    } as any);

    await expect(EsignService.signLetter('letter-1', 'ketua', PASS)).rejects.toThrow(
      /belum didukung/i
    );
  });

  /**
   * Naskah `UPLOADED` ditandatangani atas byte unggahan penyusunnya.
   *
   * Sebelum ini jalur itu ada tetapi tidak pernah membaca berkasnya: yang
   * di-hash adalah naskah hasil render sistem, sementara berkas penyusun
   * menempel sebagai lampiran. Dua dokumen berbeda dengan bobot yang sama, dan
   * hanya satu yang dapat diverifikasi publik. Di sini yang diperiksa adalah
   * yang di-hash, diarsipkan, dan ditandai asalnya memang byte unggahan itu,
   * ditambah cap visualisasi.
   */
  it('menandatangani byte berkas unggahan, bukan naskah hasil render sistem', async () => {
    const { generateLetterPdfBuffer } = await import('@/utils/generate-letter-pdf');
    const uploadedBytes = await generateLetterPdfBuffer(
      letter({ content: 'Naskah yang disusun penyusun.' }) as any
    );
    vi.mocked(readUploadedPdfBytes).mockResolvedValue(uploadedBytes);
    vi.mocked(prisma.letterUpload.findUnique).mockResolvedValue({ userId: 'ketua' } as any);
    vi.mocked(prisma.letter.findUnique).mockResolvedValue(
      letter({
        authoringTrack: 'UPLOADED',
        fileUrl: 'https://portal.cipansor.or.id/uploads/naskah-1.pdf',
      }) as any
    );
    vi.mocked(prisma.userSigningKey.findUnique).mockResolvedValue(activeKey() as any);
    vi.mocked(prisma.letterSignature.create).mockResolvedValue({
      id: 'sig-1',
      verificationToken: 'tok',
      signedAt: new Date(),
    } as any);
    vi.mocked(prisma.letterSignature.update).mockResolvedValue({ id: 'sig-1' } as any);
    vi.mocked(prisma.letterSignedDocument.create).mockResolvedValue({ id: 'doc-1' } as any);

    await EsignService.signLetter('letter-1', 'ketua', PASS);

    expect(readUploadedPdfBytes).toHaveBeenCalledWith(
      'https://portal.cipansor.or.id/uploads/naskah-1.pdf'
    );

    const signedHash = vi.mocked(prisma.letterSignature.update).mock.calls[0][0].data
      .pdfHash as string;
    const archived = vi.mocked(prisma.letterSignedDocument.create).mock.calls[0][0].data as any;

    // Byte yang diarsipkan bukan berkas unggahan apa adanya: cap TTE-nya sudah
    // menjadi bagian dari yang ditandatangani.
    expect(Buffer.from(archived.bytes).equals(uploadedBytes)).toBe(false);
    expect(crypto.createHash('sha256').update(archived.bytes).digest('hex')).toBe(signedHash);
    // Asalnya tercatat supaya sebuah naskah dapat dibedakan tanpa dibuka.
    expect(archived.generator).toContain('unggahan');
  });

  /**
   * Naskah unggahan yang berkasnya sudah tidak ada adalah naskah yang tidak
   * dapat ditandatangani. Menandatanganinya dengan byte lain akan menerbitkan
   * surat yang tidak pernah dilihat penanda tangannya.
   */
  it('tidak menandatangani naskah UPLOADED bila berkasnya tidak dapat dibaca', async () => {
    vi.mocked(readUploadedPdfBytes).mockRejectedValue(new Error('tidak ada di penyimpanan'));
    vi.mocked(prisma.letterUpload.findUnique).mockResolvedValue({ userId: 'ketua' } as any);
    vi.mocked(prisma.letter.findUnique).mockResolvedValue(
      letter({
        authoringTrack: 'UPLOADED',
        fileUrl: 'https://portal.cipansor.or.id/uploads/hilang.pdf',
      }) as any
    );
    vi.mocked(prisma.userSigningKey.findUnique).mockResolvedValue(activeKey() as any);
    vi.mocked(prisma.letterSignature.create).mockResolvedValue({
      id: 'sig-1',
      verificationToken: 'tok',
      signedAt: new Date(),
    } as any);

    await expect(EsignService.signLetter('letter-1', 'ketua', PASS)).rejects.toThrow(
      /tidak ada di penyimpanan/i
    );
    expect(prisma.letterSignedDocument.create).not.toHaveBeenCalled();
  });

  /**
   * Berkas unggahan milik orang lain tidak dapat dijadikan naskah surat ini
   * (CWE-639).
   *
   * `fileUrl` dapat menunjuk URL unggahan siapa pun. Tanpa pemeriksaan
   * kepemilikan, penanda tangan menandatangani, meng-hash, dan mengarsipkan
   * berkas milik orang lain sebagai naskahnya sendiri — sebuah akses
   * lintas-pemilik yang tidak terdeteksi.
   */
  it('menolak menandatangani berkas unggahan milik orang lain', async () => {
    vi.mocked(readUploadedPdfBytes).mockResolvedValue(Buffer.from('%PDF-1.7'));
    vi.mocked(prisma.letterUpload.findUnique).mockResolvedValue({ userId: 'orang-lain' } as any);
    vi.mocked(prisma.letter.findUnique).mockResolvedValue(
      letter({
        authoringTrack: 'UPLOADED',
        fileUrl: 'https://portal.cipansor.or.id/uploads/milik-orang-lain.pdf',
      }) as any
    );
    vi.mocked(prisma.userSigningKey.findUnique).mockResolvedValue(activeKey() as any);

    await expect(EsignService.signLetter('letter-1', 'ketua', PASS)).rejects.toThrow(
      /diunggah oleh pihak lain/i
    );
    expect(prisma.letterSignature.create).not.toHaveBeenCalled();
    expect(readUploadedPdfBytes).not.toHaveBeenCalled();
  });

  /**
   * Berkas yang kepemilikannya tidak tercatat ditolak, bukan dilewatkan.
   *
   * Unggahan yang dibuat sebelum tabel kepemilikan ada tidak dapat dibuktikan
   * pemiliknya; menebaknya akan mengembalikan celah yang ditutup di sini.
   */
  it('menolak menandatangani berkas unggahan yang tidak tercatat pemiliknya', async () => {
    vi.mocked(readUploadedPdfBytes).mockResolvedValue(Buffer.from('%PDF-1.7'));
    vi.mocked(prisma.letterUpload.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.letter.findUnique).mockResolvedValue(
      letter({
        authoringTrack: 'UPLOADED',
        fileUrl: 'https://portal.cipansor.or.id/uploads/tak-tercatat.pdf',
      }) as any
    );
    vi.mocked(prisma.userSigningKey.findUnique).mockResolvedValue(activeKey() as any);

    await expect(EsignService.signLetter('letter-1', 'ketua', PASS)).rejects.toThrow(
      /tidak tercatat sebagai unggahan/i
    );
    expect(prisma.letterSignature.create).not.toHaveBeenCalled();
  });
});

describe('verifikasi publik', () => {
  function signedFixture(
    nature: string,
    content = 'Isi rahasia yang tidak boleh bocor.',
    authoringTrack: 'GENERATED' | 'UPLOADED' = 'GENERATED'
  ) {
    const m = createKeyMaterial(PASS);
    const signedAt = new Date('2026-07-13T04:00:00Z');
    const payload: SignablePayload = {
      letterId: 'letter-1',
      letterNumber: '434/Sket/Y-CPS/VII/2026',
      date: new Date('2026-07-13T00:00:00Z'),
      type: 'SURAT_KETERANGAN',
      nature,
      subject: 'Perihal yang sensitif',
      content,
      unitId: 'unit-1',
      signerId: 'ketua',
      signedAt,
    };
    const s = signPayload(m, PASS, payload);
    return {
      material: m,
      fixture: {
        signerId: 'ketua',
        publicKey: s.publicKey,
        signature: s.signature,
        signedAt,
        // Bentuk kanonik yang dipakai saat menandatangani. Verifikasi membacanya
        // agar tanda tangan lama (v1) tetap sah; tanpa ini fixture ditandatangani
        // v2 tetapi diverifikasi sebagai v1 dan selalu dinyatakan berubah.
        canonicalVersion: s.canonicalVersion,
        // Dibiarkan nullable secara eksplisit: beberapa tes mengisi keduanya
        // untuk menguji surat yang dicabut, dan inferensi `null` akan menolaknya.
        revokedAt: null as Date | null,
        revokedReason: null as string | null,
        signer: { name: 'H. Ramram Mansur Ramdani' },
        letter: {
          id: 'letter-1',
          letterNumber: payload.letterNumber,
          date: payload.date,
          type: payload.type,
          nature,
          subject: payload.subject,
          content,
          status: 'SIGNED',
          authoringTrack,
          unitId: 'unit-1',
          unit: { name: 'Yayasan' },
        },
      },
    };
  }

  it('token tak dikenal tidak membocorkan apa pun', async () => {
    vi.mocked(prisma.letterSignature.findUnique).mockResolvedValue(null as any);
    const r = await EsignService.verifyByToken('entah');
    expect(r).toEqual({ found: false });
  });

  it('surat asli terverifikasi', async () => {
    vi.mocked(prisma.letterSignature.findUnique).mockResolvedValue(
      signedFixture('PUBLIC').fixture as any
    );
    const r: any = await EsignService.verifyByToken('tok');
    expect(r.found).toBe(true);
    expect(r.valid).toBe(true);
    expect(r.signerName).toBe('H. Ramram Mansur Ramdani');
  });

  it('verifikasi via upload buffer PDF berhasil menemukan record berdasarkan hash SHA-256', async () => {
    const pdfBuffer = Buffer.from('PDF Content for SHA-256 hash matching test');
    const pdfHash = crypto.createHash('sha256').update(pdfBuffer).digest('hex');

    const { material, fixture } = signedFixture('PUBLIC');
    const pdfSignature = signPdfHash(material, PASS, pdfHash);

    const fullFixture = {
      ...fixture,
      verificationToken: 'tok-123',
      pdfHash,
      pdfSignature,
    };

    // Prisma mengembalikan Prisma__LetterSignatureClient — sebuah thenable yang
    // juga membawa relasi — bukan Promise biasa. Mock ini hanya perlu bagian
    // then-able-nya, jadi tipenya dilebarkan sekali di sini.
    vi.mocked(prisma.letterSignature.findUnique).mockImplementation(((args: any) => {
      if (args?.where?.pdfHash === pdfHash) {
        return Promise.resolve(fullFixture as any);
      }
      if (args?.where?.verificationToken === 'tok-123') {
        return Promise.resolve(fullFixture as any);
      }
      return Promise.resolve(null as any);
    }) as unknown as typeof prisma.letterSignature.findUnique);

    const r: any = await EsignService.verifyByPdfBuffer(pdfBuffer);

    expect(r.found).toBe(true);
    expect(r.valid).toBe(true);
  });

  /**
   * Salinan bercap DICABUT harus dijawab "dicabut", bukan "tidak terdaftar".
   *
   * Cap pencabutan mengubah byte, jadi hash berkas yang diunggah tidak sama
   * dengan `pdfHash` yang ditandatangani. Sebelum ada pengenalan salinan bercap,
   * berkas resmi keluaran sistem sendiri dijawab sebagai dokumen palsu — persis
   * jawaban yang paling tidak boleh muncul bagi naskah yang justru perlu
   * dijelaskan statusnya.
   */
  it('mengenali salinan bercap DICABUT dan menjawabnya sebagai dicabut', async () => {
    const archived = await tinyPdf();
    const revokedAt = new Date('2026-09-02T07:30:00.000Z');
    const reason = 'Nomor surat ganda dengan 433/Sket/Y-CPS/IX/2026.';
    const stamped = await stampRevoked(archived, {
      reason,
      revokedAt,
      revokedByName: 'H. Endang Suryana',
    });

    const { fixture } = signedFixture('PUBLIC');
    const revokedFixture = {
      ...fixture,
      verificationToken: 'tok-revoked',
      revokedAt,
      revokedReason: reason,
      revokedById: 'pengawas',
      revokedByRoleCode: 'PENGAWAS',
      revocationSignature: null,
      revocationPublicKey: null,
      revokedBy: { name: 'H. Endang Suryana' },
    };

    vi.mocked(prisma.letterSignature.findUnique).mockImplementation(((args: any) => {
      // Tidak ada yang cocok lewat pdfHash: cap sudah mengubah byte-nya.
      if (args?.where?.pdfHash) return Promise.resolve(null as any);
      if (args?.where?.verificationToken === 'tok-revoked') {
        return Promise.resolve(revokedFixture as any);
      }
      return Promise.resolve(null as any);
    }) as unknown as typeof prisma.letterSignature.findUnique);

    vi.mocked(prisma.letterSignature.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.letterSignature.findMany).mockResolvedValue([
      {
        verificationToken: 'tok-revoked',
        revokedAt,
        revokedReason: reason,
        revokedBy: { name: 'H. Endang Suryana' },
        document: {
          bytes: new Uint8Array(archived),
          sha256: crypto.createHash('sha256').update(archived).digest('hex'),
        },
      },
    ] as never);

    const r: any = await EsignService.verifyByPdfBuffer(stamped);

    expect(r.found).toBe(true);
    expect(r.isRevoked).toBe(true);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/dicabut/i);
  });

  it.each(['PUBLIC', 'LIMITED', 'CONFIDENTIAL', 'STRICTLY_CONFIDENTIAL'])(
    'tidak pernah mengembalikan isi surat (sifat %s)',
    async (nature) => {
      vi.mocked(prisma.letterSignature.findUnique).mockResolvedValue(
        signedFixture(nature).fixture as any
      );
      const r: any = await EsignService.verifyByToken('tok');
      expect(JSON.stringify(r)).not.toContain('Isi rahasia yang tidak boleh bocor');
      expect(r.content).toBeUndefined();
    }
  );

  it('perihal hanya ditampilkan untuk surat bersifat Biasa', async () => {
    vi.mocked(prisma.letterSignature.findUnique).mockResolvedValue(
      signedFixture('PUBLIC').fixture as any
    );
    expect(((await EsignService.verifyByToken('tok')) as any).subject).toBe(
      'Perihal yang sensitif'
    );

    for (const nature of ['LIMITED', 'CONFIDENTIAL', 'STRICTLY_CONFIDENTIAL']) {
      vi.mocked(prisma.letterSignature.findUnique).mockResolvedValue(
        signedFixture(nature).fixture as any
      );
      expect(((await EsignService.verifyByToken('tok')) as any).subject).toBeNull();
    }
  });

  /**
   * Jalur penyusunannya ikut dikembalikan, karena ia bagian dari jawabannya.
   *
   * Verifikasi membuktikan hal yang sama untuk kedua jalur — byte yang
   * diunggah adalah byte yang ditandatangani. Yang berbeda adalah apa yang
   * dapat dikatakannya tentang keterangan di buku agenda, dan halaman publik
   * tidak dapat membedakannya kalau nilai ini tidak sampai ke sana.
   */
  it.each(['GENERATED', 'UPLOADED'] as const)(
    'mengembalikan jalur penyusunan naskah (%s)',
    async (track) => {
      vi.mocked(prisma.letterSignature.findUnique).mockResolvedValue(
        signedFixture('PUBLIC', 'Isi rahasia yang tidak boleh bocor.', track).fixture as any
      );
      const r: any = await EsignService.verifyByToken('tok');
      expect(r.letter.authoringTrack).toBe(track);
    }
  );

  /**
   * Jalur penyusunan bukan isi surat, jadi kerahasiaan tidak menyembunyikannya.
   *
   * Perihal disembunyikan pada surat Terbatas ke atas karena ia mengungkap
   * perkaranya. "Disusun sistem" atau "diunggah penyusun" tidak mengungkap
   * apa pun tentang perkaranya — ia justru menerangkan seberapa jauh
   * pemeriksaan yang baru saja dilakukan berlaku, dan itu perlu diketahui
   * pembaca surat rahasia sama seperti pembaca surat biasa.
   */
  it.each(['LIMITED', 'CONFIDENTIAL', 'STRICTLY_CONFIDENTIAL'])(
    'jalur penyusunan tetap disebut walau perihalnya disembunyikan (sifat %s)',
    async (nature) => {
      vi.mocked(prisma.letterSignature.findUnique).mockResolvedValue(
        signedFixture(nature, 'Isi rahasia yang tidak boleh bocor.', 'UPLOADED').fixture as any
      );
      const r: any = await EsignService.verifyByToken('tok');
      expect(r.letter.subject).toBeNull();
      expect(r.letter.authoringTrack).toBe('UPLOADED');
    }
  );

  it('naskah yang diubah setelah ditandatangani tidak lagi sah', async () => {
    const { fixture } = signedFixture('PUBLIC');
    fixture.letter.content = 'Isi yang sudah diubah diam-diam.';
    vi.mocked(prisma.letterSignature.findUnique).mockResolvedValue(fixture as any);

    const r: any = await EsignService.verifyByToken('tok');
    expect(r.intact).toBe(false);
    expect(r.valid).toBe(false);
  });

  it('tanda tangan yang dicabut tidak sah walau naskahnya utuh', async () => {
    const { fixture } = signedFixture('PUBLIC');
    fixture.revokedAt = new Date();
    fixture.revokedReason = 'Diterbitkan keliru';
    vi.mocked(prisma.letterSignature.findUnique).mockResolvedValue(fixture as any);

    const r: any = await EsignService.verifyByToken('tok');
    expect(r.intact).toBe(true);
    expect(r.revoked).toBe(true);
    expect(r.valid).toBe(false);
  });
});

/**
 * Pencabutan.
 *
 * Dua hal yang paling mudah salah dan paling mahal akibatnya: mencabut sesuatu
 * yang sudah dicabut (menimpa catatan pertama, yang justru menjawab sejak kapan
 * ia tidak berlaku), dan mengira mencabut kunci berarti mencabut surat-suratnya
 * (tidak — dan itulah sebabnya jumlahnya dilaporkan kembali).
 */
describe('mencabut kunci tanda tangan', () => {
  const REASON = 'Passphrase bocor ke pihak lain';

  beforeEach(() => {
    vi.mocked(prisma.letterSignature.findMany).mockResolvedValue([] as any);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({ id: 'audit-1' } as any);
  });

  it('mencatat tanggal, alasan, dan siapa yang mencabut', async () => {
    vi.mocked(prisma.userSigningKey.findUnique).mockResolvedValue(activeKey() as any);

    await EsignService.revokeKey('ketua', 'admin-1', REASON);

    expect(prisma.userSigningKey.update).toHaveBeenCalledWith({
      where: { id: 'key-1' },
      data: expect.objectContaining({
        revokedAt: expect.any(Date),
        revokedReason: REASON,
        revokedById: 'admin-1',
      }),
    });
  });

  it('menolak mencabut kunci yang sudah dicabut', async () => {
    vi.mocked(prisma.userSigningKey.findUnique).mockResolvedValue(
      activeKey({ revokedAt: new Date('2026-01-01'), revokedReason: 'Sudah' }) as any
    );

    await expect(EsignService.revokeKey('ketua', 'admin-1', REASON)).rejects.toThrow(
      /sudah dicabut/i
    );
    expect(prisma.userSigningKey.update).not.toHaveBeenCalled();
  });

  it('menolak alasan yang hanya berisi spasi', async () => {
    vi.mocked(prisma.userSigningKey.findUnique).mockResolvedValue(activeKey() as any);

    await expect(EsignService.revokeKey('ketua', 'admin-1', '              ')).rejects.toThrow(
      /Alasan pencabutan/i
    );
    expect(prisma.userSigningKey.update).not.toHaveBeenCalled();
  });

  /**
   * Yang mencabut kunci karena passphrase bocor perlu tahu berapa surat yang
   * sudah telanjur ditandatangani dengannya — mencabut kuncinya tidak mencabut
   * satu pun di antaranya.
   */
  it('melaporkan surat yang sudah ditandatangani dengan kunci itu', async () => {
    const key = activeKey();
    vi.mocked(prisma.userSigningKey.findUnique).mockResolvedValue(key as any);
    vi.mocked(prisma.letterSignature.findMany).mockResolvedValue([
      {
        id: 'sig-1',
        signedAt: new Date('2026-08-01'),
        letter: {
          id: 'letter-1',
          letterNumber: '434/Sket/Y-CPS/VII/2026',
          subject: 'Keterangan',
          date: new Date('2026-08-01'),
        },
      },
    ] as any);

    const r = await EsignService.revokeKey('ketua', 'admin-1', REASON);

    expect(r.affectedLetterCount).toBe(1);
    expect(r.affectedLetters[0]).toMatchObject({ letterId: 'letter-1', signatureId: 'sig-1' });
  });

  /**
   * Dicocokkan pada salinan kunci publiknya, bukan sekadar pada
   * penandatangannya: orang yang sama bisa pernah memegang kunci lain, dan
   * surat-surat kunci lama itu tidak ada hubungannya dengan kebocoran ini.
   */
  it('mencocokkan surat pada kunci publiknya, bukan hanya pada penandatangannya', async () => {
    const key = activeKey();
    vi.mocked(prisma.userSigningKey.findUnique).mockResolvedValue(key as any);

    await EsignService.revokeKey('ketua', 'admin-1', REASON);

    expect(prisma.letterSignature.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { signerId: 'ketua', publicKey: key.publicKey, revokedAt: null },
      })
    );
  });

  /**
   * Kode sebab RFC 5280 §5.3.1: hanya KEY_COMPROMISE yang membuat surat-surat
   * yang telanjur ditandatangani menjadi meragukan. Membedakannya menghindarkan
   * petugas dari dua kekeliruan yang berlawanan — mencabut belasan naskah yang
   * sebenarnya tidak apa-apa, atau membiarkan naskah bertanda tangan kunci
   * bocor tetap berlaku.
   */
  it('menandai perlunya peninjauan hanya untuk kebocoran kunci', async () => {
    vi.mocked(prisma.userSigningKey.findUnique).mockResolvedValue(activeKey() as any);
    const bocor = await EsignService.revokeKey('ketua', 'admin-1', REASON, 'KEY_COMPROMISE' as any);
    expect(bocor.lettersNeedReview).toBe(true);

    vi.mocked(prisma.userSigningKey.findUnique).mockResolvedValue(activeKey() as any);
    const berhenti = await EsignService.revokeKey(
      'ketua',
      'admin-1',
      REASON,
      'AFFILIATION_CHANGED' as any
    );
    expect(berhenti.lettersNeedReview).toBe(false);
  });

  it('menyimpan kode sebabnya, dan memilih yang paling tidak berbahaya bila tidak disebut', async () => {
    vi.mocked(prisma.userSigningKey.findUnique).mockResolvedValue(activeKey() as any);

    await EsignService.revokeKey('ketua', 'admin-1', REASON);

    expect(prisma.userSigningKey.update).toHaveBeenCalledWith({
      where: { id: 'key-1' },
      data: expect.objectContaining({ revocationCode: 'AFFILIATION_CHANGED' }),
    });
  });

  it('memberi tahu pemilik kunci', async () => {
    vi.mocked(prisma.userSigningKey.findUnique).mockResolvedValue(activeKey() as any);

    await EsignService.revokeKey('ketua', 'admin-1', REASON);

    expect(emitMock).toHaveBeenCalledWith(
      'notification:send',
      expect.objectContaining({ userId: 'ketua', title: expect.stringMatching(/Dicabut/i) })
    );
  });
});

describe('mencabut naskah dinas', () => {
  const REASON = 'Nomor surat ganda, diterbitkan ulang';
  const SIGNER = { id: 'ketua', roleCode: 'YAYASAN_KETUA' };
  const PENGAWAS = { id: 'pengawas-1', roleCode: 'YAYASAN_PENGAWAS' };
  const SUPER_ADMIN = { id: 'admin-1', roleCode: 'SUPER_ADMIN' };
  const OTHER = { id: 'guru-9', roleCode: 'TKQ_GURU' };

  function signedLetter(over: Record<string, unknown> = {}) {
    return {
      id: 'letter-1',
      status: 'SIGNED',
      letterNumber: '434/Sket/Y-CPS/VII/2026',
      subject: 'Keterangan',
      createdById: 'tata-usaha',
      signatures: [
        { id: 'sig-1', signerId: 'ketua', signerRoleCode: 'YAYASAN_KETUA', revokedAt: null },
      ],
      ...over,
    };
  }

  /** Kunci milik pencabutnya — bukan milik penandatangan. */
  function revokerKey(userId: string) {
    return activeKey({ id: `key-${userId}`, userId });
  }

  beforeEach(() => {
    vi.mocked(prisma.letterSignature.update).mockResolvedValue({
      id: 'sig-1',
      revokedAt: new Date(),
      revokedReason: REASON,
    } as any);
    vi.mocked(prisma.letterFlowEvent.create).mockResolvedValue({ id: 'ev-1' } as any);
    vi.mocked(prisma.auditLog.create).mockResolvedValue({ id: 'audit-1' } as any);
  });

  it('penandatangannya sendiri boleh mencabut', async () => {
    vi.mocked(prisma.letter.findUnique).mockResolvedValue(signedLetter() as any);
    vi.mocked(prisma.userSigningKey.findUnique).mockResolvedValue(revokerKey('ketua') as any);

    await EsignService.revokeLetterSignature('letter-1', SIGNER, REASON, PASS);

    expect(prisma.letterSignature.update).toHaveBeenCalledWith({
      where: { id: 'sig-1' },
      data: expect.objectContaining({
        revokedAt: expect.any(Date),
        revokedReason: REASON,
        revokedById: 'ketua',
        revokedByRoleCode: 'YAYASAN_KETUA',
      }),
    });
  });

  /**
   * Menganulir naskah organ pelaksana adalah perbuatan pengawasan, dan Pengawas
   * memakai kuncinya sendiri — sehingga passphrase Ketua yang bocor tidak
   * menghalangi pencabutannya.
   */
  it('Pengawas boleh mencabut naskah Pengurus, dengan kuncinya sendiri', async () => {
    vi.mocked(prisma.letter.findUnique).mockResolvedValue(signedLetter() as any);
    vi.mocked(prisma.userSigningKey.findUnique).mockResolvedValue(revokerKey('pengawas-1') as any);

    await EsignService.revokeLetterSignature('letter-1', PENGAWAS, REASON, PASS);

    expect(prisma.userSigningKey.findUnique).toHaveBeenCalledWith({
      where: { userId: 'pengawas-1' },
    });
    expect(prisma.letterSignature.update).toHaveBeenCalled();
  });

  /**
   * Pengelola sistem mengurus kunci, bukan kewenangan menandatangani atas nama
   * yayasan. Sebelumnya ia boleh mencabut naskah siapa pun.
   */
  it('Super Admin ditolak, dan tidak ada yang tertulis', async () => {
    vi.mocked(prisma.letter.findUnique).mockResolvedValue(signedLetter() as any);

    await expect(
      EsignService.revokeLetterSignature('letter-1', SUPER_ADMIN, REASON, PASS)
    ).rejects.toThrow(/Pengawas Yayasan/i);

    expect(prisma.letterSignature.update).not.toHaveBeenCalled();
  });

  it('pengguna lain ditolak', async () => {
    vi.mocked(prisma.letter.findUnique).mockResolvedValue(signedLetter() as any);

    await expect(
      EsignService.revokeLetterSignature('letter-1', OTHER, REASON, PASS)
    ).rejects.toThrow(/Pengawas Yayasan/i);

    expect(prisma.letterFlowEvent.create).not.toHaveBeenCalled();
  });

  /**
   * Pencabutan adalah pernyataan kriptografis, bukan pengubahan kolom status:
   * sebuah CRL pun ditandatangani penerbitnya (RFC 5280). Passphrase yang salah
   * berarti tidak ada pencabutan sama sekali.
   */
  it('passphrase salah tidak mencabut apa pun, dan dicatat', async () => {
    vi.mocked(prisma.letter.findUnique).mockResolvedValue(signedLetter() as any);
    vi.mocked(prisma.userSigningKey.findUnique).mockResolvedValue(revokerKey('ketua') as any);

    await expect(
      EsignService.revokeLetterSignature('letter-1', SIGNER, REASON, 'passphrase-yang-salah')
    ).rejects.toThrow(/Passphrase/i);

    expect(prisma.letterSignature.update).not.toHaveBeenCalled();
    expect(prisma.userSigningKey.update).toHaveBeenCalledWith({
      where: { id: 'key-ketua' },
      data: expect.objectContaining({ failedAttempts: 1 }),
    });
  });

  it('menyimpan tanda tangan Ed25519 atas pernyataan pencabutannya', async () => {
    vi.mocked(prisma.letter.findUnique).mockResolvedValue(signedLetter() as any);
    const key = revokerKey('ketua');
    vi.mocked(prisma.userSigningKey.findUnique).mockResolvedValue(key as any);

    await EsignService.revokeLetterSignature('letter-1', SIGNER, REASON, PASS);

    const written = vi.mocked(prisma.letterSignature.update).mock.calls[0][0] as any;
    expect(written.data.revocationSignature).toEqual(expect.any(String));
    expect(written.data.revocationDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(written.data.revocationPublicKey).toBe(key.publicKey);

    // Benar-benar dapat diverifikasi, bukan sekadar terisi.
    expect(
      verifyRevocation(
        written.data.revocationPublicKey,
        {
          signatureId: 'sig-1',
          letterId: 'letter-1',
          revokedById: 'ketua',
          revokedByRoleCode: 'YAYASAN_KETUA',
          revokedAt: written.data.revokedAt,
          reason: REASON,
        },
        written.data.revocationSignature
      )
    ).toBe(true);
  });

  it('alasan yang diubah membatalkan tanda tangan pencabutannya', async () => {
    vi.mocked(prisma.letter.findUnique).mockResolvedValue(signedLetter() as any);
    vi.mocked(prisma.userSigningKey.findUnique).mockResolvedValue(revokerKey('ketua') as any);

    await EsignService.revokeLetterSignature('letter-1', SIGNER, REASON, PASS);
    const written = vi.mocked(prisma.letterSignature.update).mock.calls[0][0] as any;

    expect(
      verifyRevocation(
        written.data.revocationPublicKey,
        {
          signatureId: 'sig-1',
          letterId: 'letter-1',
          revokedById: 'ketua',
          revokedByRoleCode: 'YAYASAN_KETUA',
          revokedAt: written.data.revokedAt,
          reason: 'Alasan yang diganti diam-diam',
        },
        written.data.revocationSignature
      )
    ).toBe(false);
  });

  it('menolak bila pencabut tidak punya kunci yang berlaku', async () => {
    vi.mocked(prisma.letter.findUnique).mockResolvedValue(signedLetter() as any);
    vi.mocked(prisma.userSigningKey.findUnique).mockResolvedValue(null as any);

    await expect(
      EsignService.revokeLetterSignature('letter-1', SIGNER, REASON, PASS)
    ).rejects.toThrow(/kunci tanda tangan elektronik/i);
  });

  /**
   * Statusnya sengaja tetap. Surat ini memang pernah ditandatangani dan memang
   * pernah beredar; mengembalikannya ke DRAFT menghapus kenyataan itu dari buku
   * agenda.
   */
  it('tidak mengubah status surat', async () => {
    vi.mocked(prisma.letter.findUnique).mockResolvedValue(signedLetter() as any);
    vi.mocked(prisma.userSigningKey.findUnique).mockResolvedValue(revokerKey('ketua') as any);

    await EsignService.revokeLetterSignature('letter-1', SIGNER, REASON, PASS);

    expect(prisma.letter.update).not.toHaveBeenCalled();
  });

  it('mencatat pencabutan pada riwayat alur surat', async () => {
    vi.mocked(prisma.letter.findUnique).mockResolvedValue(signedLetter() as any);
    vi.mocked(prisma.userSigningKey.findUnique).mockResolvedValue(revokerKey('pengawas-1') as any);

    await EsignService.revokeLetterSignature('letter-1', PENGAWAS, REASON, PASS);

    expect(prisma.letterFlowEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        letterId: 'letter-1',
        actorId: 'pengawas-1',
        action: 'SIGNATURE_REVOKED',
        note: expect.stringContaining(REASON),
      }),
    });
  });

  it('memberi tahu penandatangan dan pembuat konsep', async () => {
    vi.mocked(prisma.letter.findUnique).mockResolvedValue(signedLetter() as any);
    vi.mocked(prisma.userSigningKey.findUnique).mockResolvedValue(revokerKey('pengawas-1') as any);

    await EsignService.revokeLetterSignature('letter-1', PENGAWAS, REASON, PASS);

    const notified = emitMock.mock.calls
      .filter((c) => c[0] === 'notification:send')
      .map((c) => (c[1] as { userId: string }).userId);
    expect(notified).toContain('ketua');
    expect(notified).toContain('tata-usaha');
  });

  it('tidak memberi tahu pencabutnya sendiri', async () => {
    vi.mocked(prisma.letter.findUnique).mockResolvedValue(signedLetter() as any);
    vi.mocked(prisma.userSigningKey.findUnique).mockResolvedValue(revokerKey('ketua') as any);

    await EsignService.revokeLetterSignature('letter-1', SIGNER, REASON, PASS);

    const notified = emitMock.mock.calls
      .filter((c) => c[0] === 'notification:send')
      .map((c) => (c[1] as { userId: string }).userId);
    expect(notified).not.toContain('ketua');
  });

  it('menolak naskah yang sudah dicabut, dan mengatakannya begitu', async () => {
    vi.mocked(prisma.letter.findUnique).mockResolvedValue(
      signedLetter({
        signatures: [
          {
            id: 'sig-1',
            signerId: 'ketua',
            signerRoleCode: 'YAYASAN_KETUA',
            revokedAt: new Date('2026-08-20'),
          },
        ],
      }) as any
    );

    await expect(
      EsignService.revokeLetterSignature('letter-1', SIGNER, REASON, PASS)
    ).rejects.toThrow(/sudah dicabut/i);
    expect(prisma.letterSignature.update).not.toHaveBeenCalled();
  });

  it('menolak alasan yang terlalu pendek', async () => {
    vi.mocked(prisma.letter.findUnique).mockResolvedValue(signedLetter() as any);

    await expect(
      EsignService.revokeLetterSignature('letter-1', SIGNER, 'salah', PASS)
    ).rejects.toThrow(/Alasan pencabutan/i);
    expect(prisma.letterSignature.update).not.toHaveBeenCalled();
  });

  /**
   * Nama pencabut dibekukan bersama hash salinan bercap.
   *
   * Cap DICABUT mencetak nama pencabut, dan hash salinan dihitung atas nama
   * itu. Selama nama dibaca dari akun pada setiap unduhan, satu penggantian
   * nama mengubah byte salinan sehingga hashnya tak lagi cocok. Karena itu
   * pencabutan menyimpan nama **saat mencabut** dan hash yang diturunkan
   * darinya pada baris tanda tangan yang sama.
   */
  it('membekukan nama pencabut dan hash salinan bercap pada baris tanda tangan', async () => {
    const archived = await tinyPdf();
    vi.mocked(prisma.letter.findUnique).mockResolvedValue(signedLetter() as any);
    vi.mocked(prisma.userSigningKey.findUnique).mockResolvedValue(revokerKey('ketua') as any);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ name: 'Ani' } as any);
    vi.mocked(prisma.letterSignedDocument.findUnique).mockResolvedValue({
      bytes: new Uint8Array(archived),
      sha256: crypto.createHash('sha256').update(archived).digest('hex'),
    } as any);

    await EsignService.revokeLetterSignature('letter-1', SIGNER, REASON, PASS);

    const stampWrite = vi
      .mocked(prisma.letterSignature.update)
      .mock.calls.map((c) => c[0] as any)
      .find((c) => c.data?.revokedSha256);
    expect(stampWrite?.data.revokedByName).toBe('Ani');
    expect(stampWrite?.data.revokedSha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
