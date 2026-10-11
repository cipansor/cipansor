import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { prisma } from '@/lib/prisma';
import { stampRevoked } from '@/utils/generate-letter-pdf';
import { matchRevokedCopy } from '@/utils/letter-revoked-copy';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    letterSignature: { findMany: vi.fn(), findFirst: vi.fn() },
  },
}));

const sha256 = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

/** PDF kecil yang sah, cukup untuk dapat dicap ulang. */
async function tinyPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  doc.addPage().drawText('Naskah dinas', { x: 40, y: 700, size: 12, font });
  doc.setCreationDate(new Date(0));
  doc.setModificationDate(new Date(0));
  return Buffer.from(await doc.save());
}

const revokedAt = new Date('2026-09-02T07:30:00.000Z');
const reason = 'Nomor surat ganda dengan 433/Sket/Y-CPS/IX/2026.';

const stamp = (archived: Buffer) =>
  stampRevoked(archived, { reason, revokedAt, revokedByName: 'H. Endang Suryana' });

/** Satu baris kandidat tercabut, dengan arsip yang utuh. */
function candidate(archived: Buffer, over: Record<string, unknown> = {}) {
  return {
    verificationToken: 'tok-tercabut',
    revokedAt,
    revokedReason: reason,
    revokedBy: { name: 'H. Endang Suryana' },
    document: { bytes: new Uint8Array(archived), sha256: sha256(archived) },
    ...over,
  };
}

beforeEach(() => {
  vi.mocked(prisma.letterSignature.findMany).mockReset();
  vi.mocked(prisma.letterSignature.findFirst).mockReset();
  // Bawaan jalur cepat: tidak ada hash salinan bercap yang tersimpan, sehingga
  // uji di bawah menjalankan jalur cadangan (membuat ulang cap) apa adanya.
  vi.mocked(prisma.letterSignature.findFirst).mockResolvedValue(null as never);
});

describe('matchRevokedCopy', () => {
  /**
   * Jalur cepat: hash salinan bercap yang tersimpan langsung cocok, tanpa
   * membuat ulang cap dan tanpa batas 200 kandidat.
   */
  it('cocok lewat hash salinan bercap yang tersimpan', async () => {
    vi.mocked(prisma.letterSignature.findFirst).mockResolvedValue({
      verificationToken: 'tok-tercabut',
    } as never);

    const stamped = await stamp(await tinyPdf());
    expect(await matchRevokedCopy(stamped, sha256(stamped))).toEqual({
      verificationToken: 'tok-tercabut',
    });
    // Jalur cadangan tidak dijalankan saat jalur cepat sudah menemukan.
    expect(prisma.letterSignature.findMany).not.toHaveBeenCalled();
  });

  /**
   * Inti keluhan yang berkas ini tutup: salinan bercap DICABUT — keluaran resmi
   * sistem sendiri — harus dikenali, bukan dijawab "tidak terdaftar".
   *
   * Jalur cadangan: pencabutan lama yang belum punya hash salinan bercap.
   */
  it('mengenali salinan bercap yang identik dengan arsip dicabut', async () => {
    const archived = await tinyPdf();
    const stamped = await stamp(archived);

    vi.mocked(prisma.letterSignature.findMany).mockResolvedValue([candidate(archived)] as never);

    expect(await matchRevokedCopy(stamped, sha256(stamped))).toEqual({
      verificationToken: 'tok-tercabut',
    });
  });

  /**
   * Menempelkan tulisan "DICABUT" ke PDF karangan tidak boleh menolong pemalsu.
   * Berkas dengan kata itu tetapi cap yang tidak cocok tetap tidak dikenal.
   */
  it('menolak berkas yang memuat kata DICABUT tetapi tidak cocok dengan arsip mana pun', async () => {
    const archived = await tinyPdf();
    vi.mocked(prisma.letterSignature.findMany).mockResolvedValue([candidate(archived)] as never);

    const forgedDoc = await PDFDocument.load(await tinyPdf());
    const font = await forgedDoc.embedFont(StandardFonts.HelveticaBold);
    forgedDoc.getPages()[0].drawText('DICABUT', { x: 40, y: 400, size: 40, font });
    forgedDoc.setCreationDate(new Date(0));
    forgedDoc.setModificationDate(new Date(0));
    const forged = Buffer.from(await forgedDoc.save());

    expect(await matchRevokedCopy(forged, sha256(forged))).toBeNull();
  });

  /** Arsip yang rusak tidak boleh menjadi dasar pencocokan. */
  it('melewati kandidat yang arsipnya tidak lagi utuh', async () => {
    const archived = await tinyPdf();
    const stamped = await stamp(archived);

    vi.mocked(prisma.letterSignature.findMany).mockResolvedValue([
      candidate(archived, {
        document: { bytes: new Uint8Array(archived), sha256: 'x'.repeat(64) },
      }),
    ] as never);

    expect(await matchRevokedCopy(stamped, sha256(stamped))).toBeNull();
  });

  /**
   * Pencabut yang berganti nama.
   *
   * Cap mencetak nama pencabut, dan hash salinan bercap dihitung atas nama itu.
   * Bila nama dibaca dari akun yang sudah diganti, salinan yang diunduh memuat
   * nama baru sementara hash tersimpan menghitung nama lama — salinan resmi
   * sistem sendiri dijawab "tidak terdaftar". Nama yang membeku di baris tanda
   * tangan yang dipakai, bukan nama akun hari ini.
   */
  it('memakai nama pencabut yang membeku, bukan nama akun yang sudah berganti', async () => {
    const archived = await tinyPdf();
    const stamped = await stampRevoked(archived, {
      reason,
      revokedAt,
      revokedByName: 'Ani',
    });

    vi.mocked(prisma.letterSignature.findMany).mockResolvedValue([
      candidate(archived, {
        revokedByName: 'Ani',
        revokedBy: { name: 'Anisa' },
      }),
    ] as never);

    expect(await matchRevokedCopy(stamped, sha256(stamped))).toEqual({
      verificationToken: 'tok-tercabut',
    });
  });

  /** Tanpa pencabutan (revokedAt null) kandidat dilewati, bukan dicap. */
  it('melewati baris tanpa revokedAt', async () => {
    const archived = await tinyPdf();
    vi.mocked(prisma.letterSignature.findMany).mockResolvedValue([
      candidate(archived, { revokedAt: null }),
    ] as never);

    expect(await matchRevokedCopy(await stamp(archived), 'abc')).toBeNull();
  });

  /** Tanpa kandidat sama sekali, hasilnya null — bukan galat. */
  it('mengembalikan null bila tidak ada tanda tangan tercabut', async () => {
    vi.mocked(prisma.letterSignature.findMany).mockResolvedValue([] as never);

    expect(await matchRevokedCopy(Buffer.from('%PDF-1.7'), 'abc')).toBeNull();
  });
});
