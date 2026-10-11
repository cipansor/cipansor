import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { Errors } from '@/middleware/error';
import {
  generateLetterPdfBuffer,
  stampRevoked,
  stampSignatureVisualisation,
  LetterPdfError,
  type LetterPdfInput,
} from '@/utils/generate-letter-pdf';
import { readUploadedPdfBytes } from '@/utils/letter-uploaded-file';

/**
 * Dari mana byte yang disajikan berasal.
 *
 * `archive` adalah keadaan yang benar untuk setiap naskah yang ditandatangani
 * sejak arsip ada. `uploaded` adalah berkas penyusun apa adanya — pratinjau
 * naskah `UPLOADED` yang belum ditandatangani. `regenerated` hanya tersisa
 * untuk dua hal: konsep yang belum ditandatangani, dan surat lama yang
 * ditandatangani sebelum arsip ada.
 */
export type LetterPdfSource = 'archive' | 'regenerated' | 'uploaded';

export interface LetterPdfResult {
  buffer: Buffer;
  source: LetterPdfSource;
}

/**
 * Kolom tanda tangan yang dibaca di sini, di luar yang dibutuhkan penghasil PDF.
 *
 * `getLetterById` memang memilihnya; tipe ini yang membuat pilihan itu terbaca
 * sebagai syarat, bukan sebagai kebetulan.
 */
interface SignatureRow {
  id?: string | null;
  pdfHash?: string | null;
  revokedReason?: string | null;
  /**
   * Nama pencabut **saat mencabut**, bukan `revokedBy.name` hari ini. Cap
   * DICABUT mencetak nama ini, jadi membacanya dari akun yang bisa berganti
   * nama akan mengubah byte salinan bercap dan memutus hashnya.
   */
  revokedByName?: string | null;
  revokedBy?: { name?: string | null } | null;
}

type PdfSignature = NonNullable<LetterPdfInput['signatures']>[number];

type LetterWithSignatures = Omit<LetterPdfInput, 'signatures'> & {
  signatures?: Array<PdfSignature & SignatureRow> | null;
};

const sha256 = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

/**
 * Berkas PDF sebuah surat, diambil dari arsip bila ada.
 *
 * **Naskah yang sudah ditandatangani tidak dirender ulang.** Sampai PR-3 setiap
 * unduhan membuat ulang naskahnya dari data, sehingga verifikasi publik —
 * yang bekerja dengan menghitung ulang hash berkas yang diunggah — bertumpu
 * pada janji bahwa penghasil PDF akan mengeluarkan byte identik selamanya.
 * Janji itu tidak dapat ditepati: satu kenaikan versi `pdf-lib` membatalkan
 * seluruh surat yang pernah ditandatangani sekaligus, dan yang dibaca publik
 * bukan "sistem berubah" melainkan tuduhan bahwa naskahnya telah diubah.
 *
 * Jalur lama tetap ada, tetapi hanya sebagai cadangan untuk surat yang
 * ditandatangani sebelum arsip ada — dan di situ penjagaannya tetap berlaku:
 * salinan bercap DICABUT hanya dicetak bila hasil render ulang terbukti masih
 * sama persis dengan yang di-hash saat penandatanganan.
 */
export async function resolveLetterPdf(letter: LetterWithSignatures): Promise<LetterPdfResult> {
  const latest = letter.signatures?.at(-1) ?? null;
  const revoked = latest?.revokedAt ? latest : null;
  const isUploadedTrack = letter.authoringTrack === 'UPLOADED';

  let buffer: Buffer | null = null;
  let source: LetterPdfSource = 'regenerated';

  if (latest?.id) {
    const archived = await prisma.letterSignedDocument.findUnique({
      where: { signatureId: latest.id },
      select: { bytes: true, sha256: true },
    });
    if (archived) {
      const bytes = Buffer.from(archived.bytes);
      const hash = sha256(bytes);
      /**
       * Arsip memeriksa dirinya sendiri sebelum disajikan.
       *
       * Berkas yang rusak di penyimpanan tidak boleh keluar diam-diam sebagai
       * naskah resmi: yang menerimanya akan mengunggahnya ke halaman verifikasi
       * dan dijawab bahwa dokumennya palsu. Lebih baik gagal di sini, dengan
       * kalimat yang menyebut sebabnya.
       */
      if (hash !== archived.sha256 || (latest.pdfHash && hash !== latest.pdfHash)) {
        throw Errors.internal(
          'Arsip naskah ini tidak lagi utuh: berkas yang tersimpan tidak cocok dengan hash yang ' +
            'ditandatangani. Laporkan kepada administrator; jangan edarkan salinan apa pun dari surat ini.'
        );
      }
      buffer = bytes;
      source = 'archive';
    }
  }

  if (!buffer) {
    /**
     * Naskah `UPLOADED` yang sudah ditandatangani tidak boleh dirender ulang.
     *
     * Byte naskahnya berasal dari berkas yang diunggah penyusunnya, ditambah
     * cap visualisasi TTE. Tanpa arsipnya, byte itu tidak dapat dihasilkan lagi
     * — dan mencoba menghasilkannya dari tata letak sistem akan mengeluarkan
     * dokumen yang berbeda dari yang ditandatangani, lalu verifikasi publik
     * menjawab bahwa surat yang sah telah diubah. Lebih baik gagal dengan
     * jujur. Keadaan ini hanya mungkin untuk surat yang ditandatangani sebelum
     * jalur `UPLOADED` benar-benar menandatangani byte unggahan, dan arsipnya
     * belum ada.
     */
    if (isUploadedTrack && latest) {
      throw Errors.internal(
        'Arsip naskah unggahan ini tidak ditemukan, dan byte yang ditandatangani tidak dapat ' +
          'dihasilkan ulang. Laporkan kepada administrator.'
      );
    }

    try {
      if (isUploadedTrack) {
        /**
         * Pratinjau naskah `UPLOADED` yang belum ditandatangani: byte penyusun
         * apa adanya, tanpa cap TTE. Inilah yang dibaca pemeriksa sebelum
         * menandatangani — sama persis dengan yang akan mereka tandatangani,
         * kecuali cap yang baru ditambahkan saat ditandatangani.
         */
        buffer = await readUploadedPdfBytes(letter.fileUrl);
        source = 'uploaded';
      } else {
        buffer = await generateLetterPdfBuffer(
          revoked
            ? {
                ...letter,
                signatures: (letter.signatures ?? []).map((s) => ({ ...s, revokedAt: null })),
              }
            : letter
        );
      }
    } catch (e) {
      if (e instanceof LetterPdfError) throw Errors.badRequest(e.message);
      throw e;
    }

    if (revoked) {
      const hash = sha256(buffer);
      if (!latest?.pdfHash || hash !== latest.pdfHash) {
        throw Errors.badRequest(
          'Naskah ini tidak dapat dicetak ulang: berkas yang dihasilkan tidak lagi sama persis ' +
            'dengan yang ditandatangani, sehingga salinan bercap pun tidak dapat dipertanggungjawabkan.'
        );
      }
    }
  }

  if (revoked) {
    buffer = await stampRevoked(buffer, {
      reason: revoked.revokedReason ?? 'Dicabut oleh pejabat yang berwenang.',
      revokedAt: new Date(revoked.revokedAt as unknown as string),
      /**
       * Nama yang membeku di baris tanda tangan lebih dulu; `revokedBy.name`
       * hanya untuk pencabutan yang tercatat sebelum kolom nama ada. Membaca
       * dari akun hari ini akan mengubah byte salinan setiap kali nama
       * pencabutnya disunting, dan hash yang tersimpan tak lagi cocok.
       */
      revokedByName: revoked.revokedByName ?? revoked.revokedBy?.name ?? null,
    });
  }

  return { buffer, source };
}
