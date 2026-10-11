import { Router } from 'express';
import { CorrespondenceController } from './correspondence.controller';
import { authenticate } from '@/middleware/auth';
import { validate, validateQuery } from '@/middleware/error';
import {
  createLetterSchema,
  reviewLetterSchema,
  createDispositionSchema,
  updateDispositionStatusSchema,
  letterNoteSchema,
  submitLetterSchema,
  listParticipantsQuerySchema,
  dispatchLetterSchema,
  updateLetterCcSchema,
  updateLetterSchema,
  exportAgendaQuerySchema,
} from './correspondence.schema';

const router = Router();

// Public route for letter verification
// Note: defaultLimiter is already applied globally in app.ts for non-dev/test environments.
// Omitting local defaultLimiter prevents double-counting against rate limit counters in production.
// Verifikasi publik surat kini hanya lewat unggahan PDF di modul esign
// (POST /api/esign/verify-pdf). Rute token di sini dihapus: ia menjawab "sah"
// hanya berdasarkan baris basis data, tanpa mengikat isi dokumen yang dipegang
// pemeriksa — celah yang justru menjadi alasan verifikasi dipindah ke unggahan.

router.use(authenticate);

router.get(
  '/participants',
  validateQuery(listParticipantsQuerySchema),
  CorrespondenceController.getParticipants
);
router.post('/letters', validate(createLetterSchema), CorrespondenceController.create);
router.patch('/letters/:id', validate(updateLetterSchema), CorrespondenceController.update);
router.get('/letters', CorrespondenceController.findAll);
// Static before parameterised: `agenda/export` must be matched before
// `letters/:id` can swallow it (route-shadowing guard).
router.get(
  '/agenda/export',
  validateQuery(exportAgendaQuerySchema),
  CorrespondenceController.exportAgenda
);
// Peninjauan retensi: daftar usul dan ekspornya. Static juga, dengan alasan
// yang sama seperti `agenda/export`.
router.get('/retention', CorrespondenceController.reviewRetention);
router.get('/retention/export', CorrespondenceController.exportRetention);
router.get('/stats', CorrespondenceController.getStats);
router.get('/letters/:id', CorrespondenceController.findOne);
router.get('/letters/:id/pdf', CorrespondenceController.getPdf);
router.post('/letters/:id/review', validate(reviewLetterSchema), CorrespondenceController.review);
router.post(
  '/letters/:id/submit',
  validate(submitLetterSchema),
  CorrespondenceController.submitForReview
);
// The way back from REVISION_NEEDED, which previously had none.
router.post('/letters/:id/resubmit', validate(letterNoteSchema), CorrespondenceController.resubmit);
// Tembusan sebuah naskah yang belum ditandatangani, diganti utuh.
router.put(
  '/letters/:id/tembusan',
  validate(updateLetterCcSchema),
  CorrespondenceController.updateCc
);
// Kapan naskah keluar benar-benar dikirim, lewat apa, dan apa tanda terimanya.
router.post(
  '/letters/:id/dispatch',
  validate(dispatchLetterSchema),
  CorrespondenceController.dispatch
);
// The end of the chain: the last official to hold the letter files it.
router.post('/letters/:id/archive', validate(letterNoteSchema), CorrespondenceController.archive);
router.post(
  '/dispositions',
  validate(createDispositionSchema),
  CorrespondenceController.createDisposition
);
router.patch(
  '/dispositions/:id/status',
  validate(updateDispositionStatusSchema),
  CorrespondenceController.updateDispositionStatus
);

export default router;
