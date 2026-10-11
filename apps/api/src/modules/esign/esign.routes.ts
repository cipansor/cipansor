import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { EsignController } from './esign.controller';
import { authenticate, isSuperAdmin } from '@/middleware/auth';
import { requireTurnstile } from '@/middleware/turnstile';
import { validate, validateQuery } from '@/middleware/validate';
import { Errors } from '@/middleware/error';
import {
  activateKeySchema,
  changePassphraseSchema,
  decideRequestSchema,
  keyStatusQuerySchema,
  requestKeySchema,
  saveIdentitySchema,
  decideRevocationSchema,
  requestRevocationSchema,
  revokeKeySchema,
  revokeSignatureSchema,
  signLetterSchema,
} from './esign.schema';
import {
  isAcceptedIdentityDocument,
  MAX_IDENTITY_DOCUMENT_BYTES,
} from '@/utils/identity-document-store';

const router = Router();

const passphraseLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.ESIGN_RATE_LIMIT_MAX) || 20,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Terlalu banyak percobaan tanda tangan elektronik. Coba lagi beberapa saat lagi.',
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter publik khusus verifikasi dokumen.
 */
const publicVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.PUBLIC_VERIFY_RATE_LIMIT_MAX) || 30,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Terlalu banyak permintaan verifikasi dokumen. Coba lagi beberapa saat lagi.',
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Multer memory storage untuk mengunggah file PDF sementara.
 * File tidak disimpan di disk dan dibuang dari memori setelah endpoint merespons.
 */
/**
 * Foto KTP, ditahan di memori sampai disimpan ke direktori privat.
 *
 * Storage memori, bukan disk: multer dengan disk storage menulis ke direktori
 * unggahan umum lebih dahulu, dan berkas ini tidak boleh pernah singgah di
 * sana — walau sesaat, itu direktori yang dilayani peladen statis.
 */
const identityUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IDENTITY_DOCUMENT_BYTES },
  fileFilter: (_req, file, cb) => {
    if (isAcceptedIdentityDocument(file.mimetype)) {
      cb(null, true);
    } else {
      cb(Errors.badRequest('Berkas harus berupa gambar (JPG, PNG, WebP) atau PDF.'));
    }
  },
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // Maksimal 10MB
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
      cb(null, true);
    } else {
      cb(Errors.badRequest('File yang diunggah harus berformat PDF.'));
    }
  },
});

/**
 * Verifikasi publik — SENGAJA di luar `authenticate`.
 *
 * Didaftarkan sebelum `router.use(authenticate)`.
 *
 * **Tidak ada rute berbasis token di sini, dan itu disengaja.** Sebuah token
 * hanya membuktikan "ada surat bernomor token ini yang ditandatangani", bukan
 * "dokumen yang Anda pegang adalah surat itu" — sehingga pemalsu cukup
 * mempertahankan QR aslinya lalu mengubah isi naskah, dan endpoint token akan
 * tetap menjawab sah. Keabsahan hanya dijawab lewat unggahan berkas, yang
 * terikat pada hash byte dokumennya.
 */
//
// Gerbang anti-botnya Turnstile, dan letaknya SESUDAH `upload.single` karena
// permintaannya multipart: sebelum multer berjalan, `req.body` masih kosong
// dan tokennya belum ada di mana pun untuk dibaca.
router.post(
  '/verify-pdf',
  publicVerifyLimiter,
  upload.single('file'),
  requireTurnstile('verify-letter'),
  EsignController.verifyPdf
);

/**
 * Layanan status kunci publik (AATL ICA7) — juga di luar `authenticate`.
 *
 * Menjawab keadaan sebuah **kunci** dari sidik jarinya: aktif, kedaluwarsa,
 * dicabut beserta sebabnya, atau tidak dikenal. Bedanya dengan endpoint
 * verifikasi: yang terakhir membuktikan sebuah *dokumen*, yang ini menjawab
 * tentang sebuah *kunci* — jadi penerima arsip lama dapat memeriksanya tanpa
 * memegang dokumennya.
 *
 * Tidak dijaga Turnstile: permintaan ini tidak menulis apa pun, masukannya
 * sudah menjadi pengenal publik (sidik jari tampil di halaman verifikasi), dan
 * lajunya dibatasi `publicVerifyLimiter`. Menambahkan tantangan di sini akan
 * menghalangi persis pemakaian yang dimaksudkan — verifikasi programatis.
 */
router.get(
  '/public/key-status',
  publicVerifyLimiter,
  validateQuery(keyStatusQuerySchema),
  EsignController.keyStatus
);

router.use(authenticate);

// Milik sendiri, di halaman pengaturan.
router.get('/me', EsignController.myStatus);
// Identitas dulu: rutenya berada sebelum pengajuan, seperti urutan yang harus
// dijalani pemohon.
router.put('/me/identity', validate(saveIdentitySchema), EsignController.saveIdentity);
router.post(
  '/me/identity/ktp',
  identityUpload.single('file'),
  EsignController.uploadIdentityDocument
);
router.post('/me/request', validate(requestKeySchema), EsignController.requestKey);
router.post(
  '/me/activate',
  passphraseLimiter,
  validate(activateKeySchema),
  EsignController.activate
);
router.post(
  '/me/passphrase',
  passphraseLimiter,
  validate(changePassphraseSchema),
  EsignController.changePassphrase
);

// Menandatangani surat.
router.post(
  '/letters/:letterId/sign',
  passphraseLimiter,
  validate(signLetterSchema),
  EsignController.signLetter
);

/**
 * Mencabut naskah dinas.
 *
 * Sengaja tidak dijaga `isSuperAdmin` — dan justru karena Super Admin **tidak**
 * boleh. Kewenangan mencabut melekat pada jabatan yang menerbitkan, jadi ia
 * diperiksa di layanan terhadap baris tanda tangannya
 * (`@cipansor/shared/letter-revocation-authority`), bukan di sini: rutenya
 * tidak mengetahui siapa yang menandatangani naskah ini.
 *
 * Menuntut passphrase, dan karena itu dibatasi lajunya: pencabutan adalah
 * pernyataan kriptografis yang ditandatangani pencabutnya, sebagaimana CRL
 * ditandatangani penerbitnya (RFC 5280).
 */
router.post(
  '/letters/:letterId/revoke',
  passphraseLimiter,
  validate(revokeSignatureSchema),
  EsignController.revokeSignature
);

/**
 * Permohonan pencabutan — mengajukan, bukan memutuskan.
 *
 * Terbuka bagi siapa pun yang boleh membaca suratnya, karena yang paling
 * mungkin lebih dulu menemukan nomor surat ganda adalah petugas tata usaha,
 * bukan pejabat yang berwenang mencabutnya. Tidak menuntut passphrase: tidak
 * ada yang berubah pada suratnya sampai permohonannya diputuskan.
 */
router.post(
  '/letters/:letterId/revocation-requests',
  validate(requestRevocationSchema),
  EsignController.requestRevocation
);
router.get('/revocation-requests', EsignController.listRevocationRequests);
router.post(
  '/revocation-requests/:id/decide',
  passphraseLimiter,
  validate(decideRevocationSchema),
  EsignController.decideRevocation
);
router.post('/revocation-requests/:id/withdraw', EsignController.withdrawRevocationRequest);

// Kewenangan Super Admin: menyetujui, menolak, mencabut.
router.get('/requests', isSuperAdmin, EsignController.listRequests);
/**
 * Foto KTP pemohon. Super Admin saja — dan pembacaannya dicatat di layanan.
 *
 * Berkasnya **tidak** berada di `public/uploads`: direktori itu disajikan di
 * balik `uploadsAuth`, yang membuktikan pemanggilnya sudah masuk dan bukan
 * bahwa ia berhak atas berkas itu. Ini satu-satunya jalan membacanya.
 */
router.get('/identities/:userId/ktp', isSuperAdmin, EsignController.readIdentityDocument);
router.get('/keys', isSuperAdmin, EsignController.listKeys);
router.post(
  '/requests/:id/decide',
  isSuperAdmin,
  validate(decideRequestSchema),
  EsignController.decide
);
router.post(
  '/keys/:userId/revoke',
  isSuperAdmin,
  validate(revokeKeySchema),
  EsignController.revoke
);

export default router;
