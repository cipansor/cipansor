import { prisma } from '@/lib/prisma';
import { Errors } from '@/middleware/error';
import { uploadFilenameFromUrl } from '@/utils/letter-uploaded-file';

/**
 * Pastikan berkas naskah unggahan benar-benar milik pihak yang berhak
 * menyerahkannya untuk surat ini (CWE-639).
 *
 * `Letter.fileUrl` dapat menunjuk URL unggahan siapa pun. Pembaca byte-nya
 * (`readUploadedPdfBytes`) hanya tahu bahwa berkas itu ada dan berformat PDF —
 * bukan siapa pemiliknya. Tanpa pemeriksaan ini, seorang penyusun yang
 * mengetahui (atau menebak) URL unggahan orang lain dapat menempelkannya
 * sebagai `fileUrl` suratnya, lalu sistem menandatangani, meng-hash, dan
 * mengarsipkan berkas milik orang lain sebagai naskah penyusun itu.
 *
 * Siapa yang boleh menjadi pemiliknya adalah **rantai surat itu sendiri**:
 * penyusun (yang mengunggah naskahnya) dan para peninjau yang ditugaskan
 * (termasuk penanda tangan). Merekalah yang secara sah memasok naskah sebuah
 * surat. Penerima, penerima tembusan, dan pejabat pencabut tidak.
 *
 * Berkas yang **tidak tercatat** pemiliknya ditolak, bukan dilewatkan. Unggahan
 * yang dibuat sebelum tabel kepemilikan ada tidak dapat dibuktikan pemiliknya;
 * menebaknya akan mengembalikan celah yang justru ditutup di sini. Penyusunnya
 * cukup mengunggah ulang.
 */
export async function assertLetterUploadOwnedBy(
  fileUrl: string | null | undefined,
  allowedUserIds: readonly string[],
  client: {
    letterUpload: {
      findUnique: (args: {
        where: { filename: string };
        select: { userId: true };
      }) => Promise<{ userId: string } | null>;
    };
  } = prisma as unknown as {
    letterUpload: {
      findUnique: (args: {
        where: { filename: string };
        select: { userId: true };
      }) => Promise<{ userId: string } | null>;
    };
  }
): Promise<void> {
  const filename = uploadFilenameFromUrl(fileUrl);
  if (!filename) {
    throw Errors.badRequest(
      'Berkas naskah yang diunggah tidak dapat dikenali. Unggah ulang berkas PDF-nya sebelum menandatangani.'
    );
  }

  const record = await client.letterUpload.findUnique({
    where: { filename },
    select: { userId: true },
  });

  if (!record) {
    throw Errors.forbidden(
      'Berkas naskah ini tidak tercatat sebagai unggahan Anda. Unggah ulang berkas PDF-nya, ' +
        'lalu simpan surat ini sebelum menandatangani.'
    );
  }

  if (!allowedUserIds.includes(record.userId)) {
    throw Errors.forbidden(
      'Berkas naskah ini diunggah oleh pihak lain dan tidak dapat dipakai sebagai naskah surat ini. ' +
        'Unggah berkas naskah Anda sendiri.'
    );
  }
}
