import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate, hasPermission } from '@/middleware/auth';
import { validate } from '@/middleware/validate';
import { requireTurnstile } from '@/middleware/turnstile';
import { config } from '@/config';
import { PERMISSIONS } from '@/modules/roles/permissions';
import {
  createGuardianDataSubjectRequestSchema,
  createPublicDataSubjectRequestSchema,
  verifyPublicDataSubjectRequestSchema,
} from '@cipansor/shared';
import * as controller from './data-subject-requests.controller';

/**
 * Permintaan hak subjek data (UU 27/2022 Pasal 30, 32, 33, 35, 40, 43–44).
 *
 * Urutannya mengikuti `public-routes-gated.test.ts`: rute publik diletakkan
 * SEBELUM `router.use(authenticate)`, dan setiap rute TULIS publik dijaga
 * Turnstile. Bukan pilihan gaya — berkas uji itu memindai pohon rute dan
 * menolak rute tulis publik yang tidak dijaga, atau yang tidak terdaftar
 * beserta alasannya.
 *
 * **Kenapa Turnstile di sini, padahal yang dikirim hanya nomor pendaftaran.**
 * Endpoint ini menjawab "nomor pendaftaran dan tanggal lahir cocok/tidak".
 * Tanpa gerbang, ia menjadi alat untuk menebak kedua hal itu berkali-kali,
 * dan begitu keduanya benar pemohon menerima kode verifikasi ke kontak
 * terdaftar. Tantangan di tepi membuat penebakan itu tidak lagi murah, sementara
 * pemohon yang sungguh-sungguh melewatinya sekali. Dijaga juga
 * `dataSubjectLimiter`: Turnstile menahan skrip, pembatas laju menahan
 * kesabaran.
 *
 * **Jalur statis didahulukan atas jalur berparameter** (`utils/route-shadowing.guard.test.ts`):
 * `/public` dan `/mine` didaftarkan sebelum `/:id`, kalau tidak `:id` akan
 * menelannya.
 */
const router = Router();

/**
 * Pembatas laju untuk permukaan publik alur ini.
 *
 * Terpisah dari `defaultLimiter` global karena ambangnya berbeda: satu keluarga
 * mengajukan satu permintaan, bukan seratus. `skip` pada test dan development
 * mengikuti pola `publicRegistrantLimiter` di `admissions.routes.ts` supaya uji
 * dan pengembangan lokal tidak tercekik.
 */
const dataSubjectLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Terlalu banyak permintaan. Silakan coba lagi nanti.',
    },
  },
  skip: () => config.env === 'test' || config.env === 'development',
});

// ==================== PUBLIC ====================
// Sebelum `authenticate`: pemohonnya adalah pendaftar SPMB yang belum punya
// akun, dan justru merekalah yang paling perlu memakai haknya.
router.post(
  '/public',
  dataSubjectLimiter,
  requireTurnstile('pdp-permintaan-data'),
  validate(createPublicDataSubjectRequestSchema),
  controller.submitPublic
);

router.post(
  '/public/verify',
  dataSubjectLimiter,
  validate(verifyPublicDataSubjectRequestSchema),
  controller.verifyPublic
);

router.use(authenticate);

// ==================== PORTAL (wali & santri) ====================
// Otorisasinya hubungan, bukan jabatan: layanan memeriksa tautan StudentParent
// atau kecocokan kontak pendaftaran. Tidak dipasang `hasPermission` di sini —
// wali dan santri tidak memegang izin apa pun secara bawaan (lihat
// `SUFFIX_PERMISSIONS` untuk `_ORANG_TUA$` dan `_SISWA$`), dan memasangnya
// akan mengunci mereka dari hak yang justru milik mereka.
router.post('/', validate(createGuardianDataSubjectRequestSchema), controller.submit);
router.get('/mine', controller.listMine);

// ==================== PETUGAS PELINDUNGAN DATA PRIBADI ====================
// `PDP_MANAGE` diberikan lewat penunjukan, bukan lewat jabatan: yayasan
// menunjuk petugas beserta penggantinya (Pasal 53), dan penunjukan itu
// berpindah orang tanpa berpindah jabatan struktural.
const onlyPdpOfficer = hasPermission(PERMISSIONS.PDP_MANAGE);

router.get('/', onlyPdpOfficer, controller.list);
router.get('/:id', onlyPdpOfficer, controller.findOne);
router.patch('/:id/status', onlyPdpOfficer, controller.updateStatus);

export default router;
