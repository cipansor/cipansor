import fs from 'fs/promises';
import path from 'path';
import { Errors } from '@/middleware/error';

/**
 * Berkas naskah yang diunggah penyusun, dibaca dari penyimpanan unggahan.
 *
 * Surat dengan jalur penyusunan `UPLOADED` menjadikan berkas inilah naskahnya:
 * yang ditandatangani, di-hash, diarsipkan, dan dicocokkan pada verifikasi
 * publik adalah byte yang diunggah penyusunnya — bukan hasil render sistem.
 * Karena itu pembacanya harus menolak berkas yang tidak ada atau bukan PDF,
 * dengan kalimat yang menyebut sebabnya, bukan dengan hash atas byte kosong.
 */

/** Akar penyimpanan unggahan, sama dengan yang disajikan `express.static`. */
const UPLOAD_ROOT = path.join(process.cwd(), 'public', 'uploads');

/**
 * Nama berkas yang sah, apa adanya.
 *
 * Nama unggahan selalu dihasilkan server (`randomUUID` + ekstensi dari tabel
 * MIME), jadi apa pun yang tidak cocok dengan pola ini bukan berkas yang
 * pernah ditulis sistem — dan `..`, pemisah jalur, atau spasi tidak boleh
 * sampai ke `path.join` di bawah.
 */
const SAFE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Nama berkas dari sebuah URL unggahan, atau `null` bila bentuknya tidak dikenal. */
export function uploadFilenameFromUrl(fileUrl: string | null | undefined): string | null {
  if (!fileUrl) return null;
  let pathname: string;
  try {
    // `fileUrl` disimpan sebagai URL absolut; pathname-nya yang kita pakai,
    // sehingga host (yang bisa berubah antar lingkungan) tidak pernah ikut.
    pathname = new URL(fileUrl).pathname;
  } catch {
    return null;
  }
  const marker = '/uploads/';
  const at = pathname.lastIndexOf(marker);
  if (at === -1) return null;
  const filename = pathname.slice(at + marker.length);
  return SAFE_FILENAME.test(filename) ? filename : null;
}

/** Alamat absolut berkas unggahan, atau `null` bila `fileUrl` tidak sah. */
export function uploadPathFromUrl(fileUrl: string | null | undefined): string | null {
  const filename = uploadFilenameFromUrl(fileUrl);
  if (!filename) return null;
  const resolved = path.resolve(UPLOAD_ROOT, filename);
  // Sabuk kedua setelah pola nama: hasil resolve harus tetap di dalam akar.
  if (resolved !== path.join(UPLOAD_ROOT, filename)) return null;
  return resolved;
}

/**
 * Byte sebuah unggahan PDF.
 *
 * `Errors.badRequest` dipakai untuk berkas yang hilang atau bukan PDF karena
 * itu keadaan yang dapat diperbaiki penyusunnya — unggah ulang — bukan galat
 * peladen. Yang tidak boleh terjadi adalah menandatangani sesuatu yang bukan
 * naskahnya.
 */
export async function readUploadedPdfBytes(fileUrl: string | null | undefined): Promise<Buffer> {
  const filePath = uploadPathFromUrl(fileUrl);
  if (!filePath) {
    throw Errors.badRequest(
      'Berkas naskah yang diunggah tidak dapat ditemukan. Unggah ulang berkas PDF-nya sebelum menandatangani.'
    );
  }

  let bytes: Buffer;
  try {
    bytes = await fs.readFile(filePath);
  } catch {
    throw Errors.badRequest(
      'Berkas naskah yang diunggah sudah tidak ada di penyimpanan. Unggah ulang berkas PDF-nya sebelum menandatangani.'
    );
  }

  // Magic-byte, bukan hanya ekstensi: yang diunggah bisa saja apa pun.
  if (bytes.length < 4 || !bytes.subarray(0, 4).equals(Buffer.from('%PDF', 'ascii'))) {
    throw Errors.badRequest(
      'Berkas naskah yang diunggah bukan PDF. Naskah yang ditandatangani harus berupa PDF.'
    );
  }

  return bytes;
}
