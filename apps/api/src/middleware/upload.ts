import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '@/lib/jwt';
import { tokenFromRequest } from './auth';
import { Errors } from './error';
import { prisma } from '@/lib/prisma';

// Ensure upload directory exists
const uploadDir = path.join(process.cwd(), 'public/uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Allowed types: client-declared MIME → { stored extension, magic-byte check }.
// The extension comes from this table (never from the client's filename), and
// the magic-byte check runs against the stored file's first bytes, so a
// renamed executable or script cannot enter the uploads directory just by
// lying about its Content-Type.
// Audio formats exist for E-Simaan recitation uploads (MediaRecorder produces
// audio/webm on Chromium/Firefox and audio/mp4 on WebKit).
interface AllowedType {
  extension: string;
  matches: (buf: Buffer) => boolean;
}

const ascii = (s: string) => Buffer.from(s, 'ascii');

const isRiff = (buf: Buffer, format: string) =>
  buf.length >= 12 &&
  buf.subarray(0, 4).equals(ascii('RIFF')) &&
  buf.subarray(8, 12).equals(ascii(format));

// ISO-BMFF (MP4/M4A): box size (4 bytes) then 'ftyp'.
const isIsoBmff = (buf: Buffer) => buf.length >= 8 && buf.subarray(4, 8).equals(ascii('ftyp'));

// EBML header — WebM and Matroska containers.
const isEbml = (buf: Buffer) =>
  buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3;

const ALLOWED_TYPES: Record<string, AllowedType> = {
  'image/jpeg': {
    extension: '.jpg',
    matches: (buf) => buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff,
  },
  'image/png': {
    extension: '.png',
    matches: (buf) =>
      buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
  },
  'image/webp': {
    extension: '.webp',
    matches: (buf) => isRiff(buf, 'WEBP'),
  },
  'application/pdf': {
    extension: '.pdf',
    matches: (buf) => buf.length >= 4 && buf.subarray(0, 4).equals(ascii('%PDF')),
  },
  'video/mp4': { extension: '.mp4', matches: isIsoBmff },
  'audio/mp4': { extension: '.m4a', matches: isIsoBmff },
  'audio/webm': { extension: '.webm', matches: isEbml },
  'audio/ogg': {
    extension: '.ogg',
    matches: (buf) => buf.length >= 4 && buf.subarray(0, 4).equals(ascii('OggS')),
  },
  'audio/mpeg': {
    extension: '.mp3',
    // ID3v2 tag, or a bare MPEG frame sync (11 set bits).
    matches: (buf) =>
      (buf.length >= 3 && buf.subarray(0, 3).equals(ascii('ID3'))) ||
      (buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0),
  },
  'audio/wav': {
    extension: '.wav',
    matches: (buf) => isRiff(buf, 'WAVE'),
  },
};

/** True when the buffer's leading bytes are plausible for the declared MIME type. */
export function matchesMagicBytes(mimetype: string, buf: Buffer): boolean {
  const allowed = ALLOWED_TYPES[mimetype];
  return allowed ? allowed.matches(buf) : false;
}

// Configure storage
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    // Extension comes from the MIME table above, never from the client-supplied
    // filename (which could smuggle .php, .html, ...).
    //
    // The name itself is crypto-random rather than `Date.now()` plus
    // `Math.random()`. uploadsAuth below proves *that* a caller is signed in but
    // not *which* files they may read, so until that gap is closed the filename
    // is the only thing standing between one santri's documents and another
    // parent's browser. A timestamp plus a non-cryptographic PRNG is guessable:
    // the upload minute is often known, and Math.random() is not seeded for
    // unpredictability. This is defence in depth, not authorisation.
    const extension = ALLOWED_TYPES[file.mimetype]?.extension ?? '.bin';
    cb(null, `${randomUUID()}${extension}`);
  },
});

// Configure file filter
const fileFilter = (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  if (ALLOWED_TYPES[file.mimetype]) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Allowed: JPG, PNG, WebP, PDF, MP4, audio'));
  }
};

export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
});

/**
 * Read the stored file's first bytes and verify they match the declared MIME
 * type. Deletes the file and returns false on mismatch, so nothing that fails
 * the check survives on disk.
 *
 * Containment is enforced twice, inline so the check is not lost behind a
 * helper. The lexical check rejects `..` traversal, a sibling directory sharing
 * the path prefix, and the upload directory itself; the `realpath` check then
 * rejects a symlink inside the upload directory that points outside it, which
 * the lexical check cannot see. A path that fails either is never opened or
 * unlinked.
 */
export async function verifyStoredFile(file: Express.Multer.File): Promise<boolean> {
  const resolvedUploadDir = path.resolve(uploadDir);
  const resolvedFilePath = path.resolve(file.path);
  const relativePath = path.relative(resolvedUploadDir, resolvedFilePath);

  // Enforce that the lexical path stays inside the upload directory.
  if (relativePath.length === 0 || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return false;
  }

  let realFilePath: string;
  try {
    realFilePath = await fs.promises.realpath(resolvedFilePath);
  } catch {
    return false;
  }
  const realRelativePath = path.relative(resolvedUploadDir, realFilePath);
  // Enforce the same containment on the canonical path, which resolves symlinks.
  if (
    realRelativePath.length === 0 ||
    realRelativePath.startsWith('..') ||
    path.isAbsolute(realRelativePath)
  ) {
    return false;
  }

  const head = Buffer.alloc(16);
  const fd = await fs.promises.open(realFilePath, 'r');
  try {
    const { bytesRead } = await fd.read(head, 0, head.length, 0);
    if (matchesMagicBytes(file.mimetype, head.subarray(0, bytesRead))) {
      return true;
    }
  } finally {
    await fd.close();
  }
  await fs.promises.unlink(realFilePath).catch(() => undefined);
  return false;
}

/**
 * Catat pemilik berkas unggahan, dan hapus berkasnya bila pencatatannya gagal.
 *
 * `Letter.fileUrl` dapat menunjuk URL unggahan siapa pun, jadi penandatanganan
 * memeriksa `LetterUpload` (`assertLetterUploadOwnedBy`). Baris tanpa catatan
 * pasti ditolak di sana — sehingga unggahan yang pencatatannya gagal adalah
 * unggahan yang tidak dapat ditandatangani. Mengembalikan sukses untuk berkas
 * seperti itu berarti pengguna menyimpan surat yang baru ketahuan tak dapat
 * ditandatangani di langkah terakhir.
 *
 * Karena itu kegagalannya disampaikan, dan berkasnya dihapus supaya tidak ada
 * unggahan yatim yang menempati ruang tanpa pernah dapat dipakai.
 *
 * @returns `true` bila tercatat; `false` bila gagal — berkasnya sudah dihapus.
 */
export async function recordUploadOwnership(
  file: { filename: string; path: string },
  userId: string
): Promise<boolean> {
  try {
    await prisma.letterUpload.upsert({
      where: { filename: file.filename },
      create: { filename: file.filename, userId },
      update: {},
    });
    return true;
  } catch (e) {
    console.error('[upload] gagal mencatat kepemilikan berkas:', e);
    // Hapus berkasnya, tetapi **hanya** bila ia benar-benar berada di direktori
    // unggahan.
    //
    // `path.basename` saja tidak cukup, dan justru berbahaya: sebuah `path` di
    // luar direktori (atau path buatan pemanggil) yang kebetulan berbagi nama
    // dasar dengan unggahan milik permintaan lain akan menunjuk berkas orang
    // lain itu, sehingga kegagalan pencatatan di sini menghapus unggahan yang
    // tidak ada hubungannya (CWE-73). Karena itu kecocokannya diperiksa lebih
    // dahulu, dan bila tidak cocok tidak ada yang dihapus.
    //
    // Pemeriksaan ini sekaligus yang memenuhi CodeQL `js/path-injection`: nilai
    // dari permintaan tidak pernah sampai ke `unlink`, karena `safePath`
    // disusun dari nama berkas yang sudah dipastikan berada di dalam direktori.
    const resolved = path.resolve(file.path);
    // Susun ulang dari nama berkas, lalu pastikan hasilnya memang berkas yang
    // sama. Bila `path` menunjuk ke luar direktori — atau sekadar berbagi nama
    // dasar dengan unggahan permintaan lain — keduanya tidak sama dan tidak ada
    // yang dihapus.
    const safePath = path.join(uploadDir, path.basename(file.path));
    if (resolved === path.resolve(safePath)) {
      await fs.promises.unlink(safePath).catch(() => undefined);
    }
    return false;
  }
}

// Middleware to map uploaded file to body.fileUrl
export const handleSingleUpload = (fieldName: string) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const uploadMiddleware = upload.single(fieldName);

    uploadMiddleware(req, res, (err) => {
      void (async () => {
        if (err instanceof multer.MulterError) {
          return res.status(400).json({
            success: false,
            error: {
              code: 'UPLOAD_ERROR',
              message: err.message,
            },
          });
        } else if (err) {
          return res.status(400).json({
            success: false,
            error: {
              code: 'UPLOAD_ERROR',
              message: err.message,
            },
          });
        }

        // If file uploaded, map path to fileUrl in body
        if (req.file) {
          // Content check: the declared MIME type got the file past the
          // filter; now the actual bytes have to back it up.
          if (!(await verifyStoredFile(req.file))) {
            return res.status(400).json({
              success: false,
              error: {
                code: 'UPLOAD_ERROR',
                message: 'File content does not match its declared type',
              },
            });
          }

          /**
           * Catat pemilik berkas ini (CWE-639).
           *
           * Sebuah URL unggahan dapat disalin dan dipakai sebagai `fileUrl`
           * surat orang lain, lalu ditandatangani sebagai naskah penanda
           * tangan. Baris ini memberi penandatanganan sesuatu untuk diperiksa.
           * Tanpa `req.user` (mis. unggahan anonim) tidak ada yang dicatat —
           * dan berkas tanpa catatan akan ditolak saat ditandatangani, bukan
           * diterima diam-diam.
           *
           * Bila pencatatannya gagal, unggahan itu gagal: berkasnya dihapus
           * dan galatnya dikembalikan, bukan URL yang pasti ditolak saat
           * ditandatangani. Lihat `recordUploadOwnership`.
           */
          if (req.user?.id) {
            const recorded = await recordUploadOwnership(
              { filename: req.file.filename, path: req.file.path },
              req.user.id
            );
            if (!recorded) {
              return res.status(500).json({
                success: false,
                error: {
                  code: 'UPLOAD_ERROR',
                  message:
                    'Berkas berhasil diunggah tetapi kepemilikannya gagal dicatat. ' +
                    'Coba unggah lagi sebentar lagi.',
                },
              });
            }
          }

          // Construct public URL
          const protocol = req.protocol;
          const host = req.get('host');
          const filename = req.file.filename;
          req.body.fileUrl = `${protocol}://${host}/uploads/${filename}`;

          // Also map other metadata if needed
          if (!req.body.fileName) {
            req.body.fileName = req.file.originalname;
          }
          if (!req.body.fileType) {
            if (req.file.mimetype.startsWith('image/')) req.body.fileType = 'image';
            else if (req.file.mimetype.startsWith('video/')) req.body.fileType = 'video';
            else req.body.fileType = 'document';
          }
        }

        next();
      })().catch(next);
    });
  };
};

/**
 * Authentication gate for serving stored uploads. Files contain personal data
 * (student photos, documents — UU 27/2022 PDP territory), so /uploads is no
 * longer an anonymous public directory.
 *
 * Browsers fetch these via <img src>/<a href>, which cannot send an
 * Authorization header. They *do* send cookies, so the HttpOnly session cookie
 * the API issued authenticates them with no `?token=` in the URL — which would
 * otherwise be written to the nginx access log by the default `combined`
 * format. A caller with a bearer token still may present it in the
 * `Authorization` header.
 *
 * KNOWN LIMIT — authentication, not authorisation. This proves the caller is
 * signed in. It does not check that *this* caller may read *this* file: any
 * valid access token, including a santri's or a parent's, opens every file in
 * the directory. Closing that needs an ownership index — a lookup from stored
 * filename back to the record that references it (Student.photoUrl,
 * StudentDocument.fileUrl, and the rest) — which does not exist yet. Until it
 * does, filenames are crypto-random (see the storage config above) so they
 * cannot be enumerated, and that is the only thing separating one family's
 * documents from another's. Treat it as an open item, not as done.
 *
 */
export function uploadsAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    // The browser sends the HttpOnly session cookie with an <img>/<a> fetch, so
    // no token appears in the URL. There is deliberately no `?token=` fallback:
    // nothing in the web app builds one any more, and a token in a query string
    // ends up in the nginx access log.
    const token = tokenFromRequest(req);
    if (!token) {
      throw Errors.unauthorized('Autentikasi diperlukan untuk mengakses berkas ini.');
    }

    const payload = verifyToken(token);
    if (payload.type !== 'access' || payload.isTemp) {
      throw Errors.unauthorized('Sesi tidak valid. Silakan masuk kembali.');
    }

    next();
  } catch (error) {
    next(error instanceof Error && 'statusCode' in error ? error : Errors.unauthorized());
  }
}
