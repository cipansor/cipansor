import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EsignService } from '../esign.service';
import { prisma } from '@/lib/prisma';
import { createKeyMaterial, normaliseFingerprint } from '@/utils/esign';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    userSigningKey: {
      findUnique: vi.fn(),
    },
    signingKeyStatusRecord: {
      findUnique: vi.fn(),
    },
  },
}));

const findUnique = vi.mocked(prisma.userSigningKey.findUnique);
const findHistory = vi.mocked(prisma.signingKeyStatusRecord.findUnique);

const MATERIAL = createKeyMaterial('kalimat-sandi-status-2026');
const FP = MATERIAL.fingerprint;
const DAY = 24 * 60 * 60 * 1000;

/**
 * Layanan status kunci publik (AATL ICA7).
 *
 * Yang diuji di sini adalah tiga hal yang membuat layanan ini berguna dan aman
 * sekaligus: ia menjawab tentang **kunci**, ia menerima sidik jari dalam bentuk
 * apa pun yang wajar, dan ia tidak membocorkan apa pun lebih dari keadaan
 * kunci itu.
 */
describe('EsignService.publicKeyStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('menjawab ACTIVE untuk kunci yang masih dalam masa berlaku', async () => {
    findUnique.mockResolvedValue({
      algorithm: 'Ed25519',
      approvedAt: new Date(Date.now() - 10 * DAY),
      expiresAt: new Date(Date.now() + 100 * DAY),
      revokedAt: null,
      revokedReason: null,
      revocationCode: null,
    } as never);

    const result = await EsignService.publicKeyStatus(FP);

    expect(result.found).toBe(true);
    expect(result.status).toBe('ACTIVE');
    expect(result.algorithm).toBe('Ed25519');
    // Kunci yang hidup tidak membawa jejak pencabutan sama sekali.
    expect(result.revocationCode).toBeNull();
    expect(result).not.toHaveProperty('revokedReason');
    expect(result.revokedAt).toBeNull();
  });

  it('mencari berdasarkan bentuk kanonik sidik jari', async () => {
    findUnique.mockResolvedValue({
      algorithm: 'Ed25519',
      approvedAt: new Date(Date.now() - DAY),
      expiresAt: new Date(Date.now() + 100 * DAY),
      revokedAt: null,
      revokedReason: null,
      revocationCode: null,
    } as never);

    await EsignService.publicKeyStatus(FP);

    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { fingerprint: FP } })
    );
  });

  it('menerima sidik jari tanpa titik dua dan berhuruf kecil', async () => {
    findUnique.mockResolvedValue({
      algorithm: 'Ed25519',
      approvedAt: new Date(Date.now() - DAY),
      expiresAt: new Date(Date.now() + 100 * DAY),
      revokedAt: null,
      revokedReason: null,
      revocationCode: null,
    } as never);

    const messy = FP.replace(/:/g, '').toLowerCase();
    const result = await EsignService.publicKeyStatus(messy);

    expect(result.status).toBe('ACTIVE');
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { fingerprint: FP } })
    );
  });

  it('melaporkan EXPIRED untuk kunci yang lewat masa berlaku', async () => {
    findUnique.mockResolvedValue({
      algorithm: 'Ed25519',
      approvedAt: new Date(Date.now() - 400 * DAY),
      expiresAt: new Date(Date.now() - 10 * DAY),
      revokedAt: null,
      revokedReason: null,
      revocationCode: null,
    } as never);

    const result = await EsignService.publicKeyStatus(FP);
    expect(result.status).toBe('EXPIRED');
  });

  it('melaporkan REVOKED beserta sebabnya, dan tidak menyamarkan sebab kebocoran', async () => {
    findUnique.mockResolvedValue({
      algorithm: 'Ed25519',
      approvedAt: new Date(Date.now() - 400 * DAY),
      expiresAt: new Date(Date.now() + 100 * DAY),
      revokedAt: new Date(Date.now() - DAY),
      revokedReason: 'Kunci diduga bocor dari komputer bersama.',
      revocationCode: 'KEY_COMPROMISE',
    } as never);

    const result = await EsignService.publicKeyStatus(FP);

    expect(result.status).toBe('REVOKED');
    // Inilah satu-satunya sebab yang membuat naskah lama meragukan — kode itu
    // harus sampai ke pembaca, bukan disamakan dengan "DICABUT" belaka.
    expect(result.revocationCode).toBe('KEY_COMPROMISE');
    // Catatan bebasnya internal: jawaban publik hanya membawa kode sebabnya.
    expect(result).not.toHaveProperty('revokedReason');
    expect(JSON.stringify(result)).not.toContain('komputer bersama');
  });

  it('tidak menyertakan sebab pencabutan untuk kunci yang tidak dicabut', async () => {
    findUnique.mockResolvedValue({
      algorithm: 'Ed25519',
      approvedAt: new Date(Date.now() - DAY),
      expiresAt: new Date(Date.now() - 10 * DAY), // kedaluwarsa, bukan dicabut
      revokedAt: null,
      revokedReason: null,
      revocationCode: null,
    } as never);

    const result = await EsignService.publicKeyStatus(FP);
    expect(result.status).toBe('EXPIRED');
    expect(result.revocationCode).toBeNull();
    expect(result).not.toHaveProperty('revokedReason');
  });

  it('menjawab UNKNOWN — bukan galat — untuk sidik jari yang tidak terdaftar', async () => {
    findUnique.mockResolvedValue(null);

    const result = await EsignService.publicKeyStatus('AB:CD:EF');

    expect(result).toEqual({ found: false, status: 'UNKNOWN' });
  });

  it('menormalkan masukan kosong menjadi UNKNOWN', async () => {
    findUnique.mockResolvedValue(null);
    findHistory.mockResolvedValue(null);

    const result = await EsignService.publicKeyStatus('   ');

    expect(result.status).toBe('UNKNOWN');
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { fingerprint: '' } })
    );
  });

  /**
   * Penerbitan ulang menghapus baris `UserSigningKey`-nya, tetapi surat yang
   * ditandatangani dengannya masih menyimpan kunci publik itu. Tanpa riwayat,
   * pemegang arsip mendapat UNKNOWN untuk kunci yang sekadar kedaluwarsa — dan
   * kehilangan sebab serta tanggal pencabutannya.
   */
  it('menjawab dari riwayat saat kunci sudah digantikan (bukan UNKNOWN)', async () => {
    findUnique.mockResolvedValue(null);
    findHistory.mockResolvedValue({
      algorithm: 'Ed25519',
      approvedAt: new Date(Date.now() - 500 * DAY),
      expiresAt: new Date(Date.now() - 100 * DAY),
      revokedAt: null,
      revokedReason: null,
      revocationCode: null,
    } as never);

    const result = await EsignService.publicKeyStatus(FP);

    expect(result.found).toBe(true);
    expect(result.status).toBe('EXPIRED');
  });

  it('menjaga sebab pencabutan pada kunci yang sudah digantikan', async () => {
    findUnique.mockResolvedValue(null);
    findHistory.mockResolvedValue({
      algorithm: 'Ed25519',
      approvedAt: new Date(Date.now() - 500 * DAY),
      expiresAt: new Date(Date.now() - 100 * DAY),
      revokedAt: new Date(Date.now() - 200 * DAY),
      revokedReason: 'Kunci diduga bocor dari komputer bersama.',
      revocationCode: 'KEY_COMPROMISE',
    } as never);

    const result = await EsignService.publicKeyStatus(FP);

    expect(result.status).toBe('REVOKED');
    expect(result.revocationCode).toBe('KEY_COMPROMISE');
    // Catatan bebasnya internal: jawaban publik hanya membawa kode sebabnya.
    expect(result).not.toHaveProperty('revokedReason');
    expect(JSON.stringify(result)).not.toContain('komputer bersama');
  });

  it('tidak pernah melaporkan ACTIVE untuk kunci yang sudah digantikan', async () => {
    // Riwayat dengan masa berlaku yang masih panjang, tetapi kunci privatnya
    // sudah dihapus — karena itu tidak boleh tampak aktif.
    findUnique.mockResolvedValue(null);
    findHistory.mockResolvedValue({
      algorithm: 'Ed25519',
      approvedAt: new Date(Date.now() - 10 * DAY),
      expiresAt: new Date(Date.now() + 300 * DAY),
      revokedAt: null,
      revokedReason: null,
      revocationCode: null,
    } as never);

    const result = await EsignService.publicKeyStatus(FP);

    expect(result.status).toBe('EXPIRED');
  });

  it('mendahulukan kunci aktif atas riwayat', async () => {
    findUnique.mockResolvedValue({
      algorithm: 'Ed25519',
      approvedAt: new Date(Date.now() - DAY),
      expiresAt: new Date(Date.now() + 100 * DAY),
      revokedAt: null,
      revokedReason: null,
      revocationCode: null,
    } as never);

    const result = await EsignService.publicKeyStatus(FP);

    expect(result.status).toBe('ACTIVE');
    expect(findHistory).not.toHaveBeenCalled();
  });
});

describe('normaliseFingerprint', () => {
  it('menambahkan pemisah titik dua dan menaikkan ke huruf besar', () => {
    expect(normaliseFingerprint('abcd')).toBe('AB:CD');
  });

  it('membuang pemisah yang sudah ada sebelum menormalkan', () => {
    expect(normaliseFingerprint('ab:cd:ef')).toBe('AB:CD:EF');
  });

  it('membuang karakter yang bukan heksadesimal', () => {
    expect(normaliseFingerprint('AB CD-EF')).toBe('AB:CD:EF');
  });

  it('bulat terhadap masukan kosong', () => {
    expect(normaliseFingerprint('')).toBe('');
  });
});
