import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../../lib/prisma';
import { EsignService } from '../esign.service';

/**
 * Rantai identitas → pengajuan → keputusan, diuji sebagai satu jalan.
 *
 * Berkas ini ada karena rantai itu pernah putus di tengah sementara setiap
 * ujungnya hijau. `requestKey` menuntut identitas yang **sudah** diverifikasi;
 * verifikasi hanya terjadi di `decideRequest`, atas sebuah pengajuan. Keduanya
 * benar sendiri-sendiri dan saling meniadakan: di produksi 2026-09-03 tidak
 * seorang pun dapat memperoleh kunci tanda tangan, dan seluruh fitur naskah
 * dinas bertanda tangan tidak dapat dijangkau.
 *
 * Uji satuan tidak menangkapnya sebab masing-masing mengunci separuh rantai
 * terhadap harapannya sendiri. Yang menangkapnya adalah menelusuri rantainya di
 * sistem yang berjalan. Maka uji ini sengaja **tidak** memeriksa satu fungsi;
 * ia berjalan dari satu ujung ke ujung lain, dan akan merah lagi bila salah
 * satu ujung digeser tanpa ujung yang lain.
 */

vi.mock('../../../lib/prisma', () => ({
  prisma: {
    signingKeyRequest: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    userSigningKey: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
    userIdentity: { findUnique: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
    user: { findUnique: vi.fn() },
    $transaction: vi.fn((cb: any) => cb(prisma)),
  },
}));
vi.mock('../../../lib/event-bus', () => ({ eventBus: { emit: vi.fn() } }));
vi.mock('@/lib/event-bus', () => ({ eventBus: { emit: vi.fn() } }));

/** Keadaan pemohon tepat sesudah mengisi formulir dan mengunggah KTP-nya. */
function freshlyDocumentedIdentity() {
  return {
    id: 'identity-1',
    userId: 'ketua',
    legalName: 'Haji Endang Suryana',
    nik: '3206051205750001',
    birthPlace: 'Tasikmalaya',
    birthDate: new Date('1975-05-12T00:00:00.000Z'),
    // Belum ada yang mencocokkannya — justru itu yang diminta pengajuan ini.
    verifiedAt: null,
    verifiedById: null,
    verificationNote: null,
    ktpFileName: 'b3c1.png',
    ktpSha256: 'f'.repeat(64),
    ktpUploadedAt: new Date('2026-09-03T05:40:00.000Z'),
    ktpRetainUntil: null,
    ktpDeletedAt: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.signingKeyRequest.findFirst).mockResolvedValue(null as any);
  vi.mocked(prisma.userSigningKey.findUnique).mockResolvedValue(null as any);
  vi.mocked(prisma.userIdentity.findUnique).mockResolvedValue(freshlyDocumentedIdentity() as any);
});

describe('dari mengisi identitas sampai kunci disetujui', () => {
  /**
   * Langkah yang dahulu mustahil. Kalau uji ini merah dengan "belum
   * diverifikasi", rantainya putus lagi di tempat yang sama.
   */
  it('pemohon yang identitasnya lengkap + ada KTP dapat mengajukan', async () => {
    vi.mocked(prisma.signingKeyRequest.create).mockResolvedValue({ id: 'req-1' } as any);

    await EsignService.requestKey('ketua');

    expect(prisma.signingKeyRequest.create).toHaveBeenCalled();
  });

  /**
   * Ujung yang lain: keputusan menerima keadaan yang persis dihasilkan langkah
   * di atas — belum diverifikasi, tetapi ada berkas untuk dicocokkan — lalu
   * menuliskan verifikasinya. Kalau `decideRequest` kelak menuntut identitas
   * yang sudah terverifikasi, uji ini merah, dan itu memang keputusan yang
   * harus disengaja.
   */
  it('Super Admin menyetujuinya sambil menyatakan kecocokan KTP-nya', async () => {
    vi.mocked(prisma.signingKeyRequest.findUnique).mockResolvedValue({
      id: 'req-1',
      userId: 'ketua',
      status: 'PENDING',
      kind: 'ENROLLMENT',
    } as any);
    vi.mocked(prisma.signingKeyRequest.update).mockResolvedValue({ id: 'req-1' } as any);

    await EsignService.decideRequest('req-1', 'superadmin', true, 365, undefined, {
      note: 'Cocok dengan KTP yang diunggah.',
    });

    expect(prisma.userIdentity.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'ketua' },
        data: expect.objectContaining({ verifiedById: 'superadmin' }),
      })
    );
  });

  /**
   * Dan penjaganya tetap berdiri: menyetujui tanpa menyatakan kecocokan apa pun
   * ditolak, sebab persetujuan yang tidak memeriksa berkasnya hanyalah satu
   * klik.
   */
  it('menolak persetujuan yang tidak menyatakan kecocokan identitas', async () => {
    vi.mocked(prisma.signingKeyRequest.findUnique).mockResolvedValue({
      id: 'req-1',
      userId: 'ketua',
      status: 'PENDING',
      kind: 'ENROLLMENT',
    } as any);

    await expect(EsignService.decideRequest('req-1', 'superadmin', true, 365)).rejects.toThrow(
      /belum diverifikasi/
    );
  });
});
