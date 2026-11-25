import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { RoleCode } from '@prisma/client';
import {
  parseDocumentSchema,
  createPublicRegistrantDocumentSchema,
  replaceAdmissionFeesSchema,
} from '@cipansor/shared';
import { config } from '../../config';
import * as controller from './admissions.controller';
import { authenticate, authorize } from '../../middleware/auth';
import { validateQuery } from '../../middleware/error';
import { validate } from '../../middleware/validate';
import { queryAdmissionPeriodSchema, queryRegistrantSchema } from './admissions.schema';
import waveRoutes from './ppdb-wave.routes';
import { viewAdmissions } from './admissions.access';
import { requireTurnstile } from '@/middleware/turnstile';

const router = Router();

// Dedicated stricter rate limiter for the unauthenticated public registrant
// creation endpoint. The global `defaultLimiter` in `apps/api/src/app.ts` is
// disabled in `test` and `development` and otherwise allows ~100 req/min,
// which is too permissive for an endpoint that creates DB rows and triggers
// transactional logic (PaymentType upsert, registrant creation). Mirroring
// the pattern used for `/auth` (see `authLimiter` in `middleware/rate-limit.ts`),
// we cap public registrations at a small number per minute per IP and skip
// the limiter entirely in `test` / `development` so test suites and local
// dev aren't throttled.
const publicRegistrantLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 public registration attempts per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many registration attempts, please try again later.',
    },
  },
  skip: () => config.env === 'test' || config.env === 'development',
});

const documentUploadLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // 5 document uploads per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Batas unggah dokumen terlampaui. Silakan tunggu 1 menit.',
    },
  },
  skip: () => config.env === 'test' || config.env === 'development',
});

// Dedicated, tighter limiter for `POST /public/parse-document`. While the OCR
// engine is off this endpoint is cheap (metadata only); once `SPMB_OCR_ENABLED`
// turns the Tesseract.js engine on, each request costs ~0.4–0.6 s of CPU and
// ~205 MB RSS (spike, 2026-11-25). 6/min per IP keeps a single client from
// stacking workers while still letting an applicant scan their KTP, KK and
// akta in one session. Turnstile is deliberately NOT added here — see the
// gating comment on the route and `public-routes-gated.test.ts`.
const documentOcrLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 6, // 6 document scans per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Batas pemindaian dokumen terlampaui. Silakan tunggu 1 menit.',
    },
  },
  skip: () => config.env === 'test' || config.env === 'development',
});

// Mount wave sub-router. `ppdb-wave.routes.ts` applies its own `authenticate`
// middleware (and exposes a public `/active/:periodId` route), so we mount it
// BEFORE the admissions-wide `authenticate` below.
router.use('/waves', waveRoutes);

// ==================== PUBLIC ENDPOINTS ====================
// Mounted BEFORE `authenticate` so the unauthenticated public SPMB page
// (`apps/web/src/app/public/spmb/page.tsx`) can show each unit's intake and
// submit a new registrant without a session. The handlers return a
// deliberately trimmed projection of the underlying records — see the JSDoc
// on `findPublicIntakes` and on the registrant controllers for the whitelist.
router.get('/public/intakes', controller.getPublicIntakes);
router.post(
  '/public/registrants',
  publicRegistrantLimiter,
  // Pendaftaran SPMB terbuka bagi siapa pun tanpa kredensial, dan setiap
  // kiriman menjadi baris calon santri yang harus dibaca manusia. Pembatas
  // laju menahan satu mesin; Turnstile menahan yang tersebar.
  requireTurnstile('spmb-daftar'),
  controller.createPublicRegistrant
);
router.post(
  '/public/registrants/:registrantId/documents',
  documentUploadLimiter,
  validate(createPublicRegistrantDocumentSchema),
  controller.createPublicRegistrantDocument
);
router.get('/public/track', publicRegistrantLimiter, controller.trackPublicRegistrantStatus);
// DOCUMENT-OCR GATING (assumption review 2026-09-09, re-reviewed 2026-11-25 when
// the Tesseract.js engine landed behind `SPMB_OCR_ENABLED`):
// `parse-document` stays OPEN (no Turnstile). The engine is LOCAL ONLY — Tesseract.js
// compiled to WebAssembly with traineddata bundled in `@tesseract.js-data/eng`, so no
// image and no request leaves this deployment and there is no per-request fee. A
// Turnstile would gate a page whose registration step already requires one, and would
// fail-closed for applicants whose network filters challenges.cloudflare.com (the
// reasoning pinned in `public-routes-gated.test.ts`). What DID change is the abuse
// boundary: the heavy path is bounded by `documentOcrLimiter` (6 req/min/IP), the
// payload by `parseDocumentSchema` (2.8MB), and the engine is off until
// `SPMB_OCR_ENABLED=true`. Re-review this again before adding a paid/third-party
// vision service or raising the upload cap.
router.post(
  '/public/parse-document',
  documentOcrLimiter,
  validate(parseDocumentSchema),
  controller.parsePublicDocument
);

router.use(authenticate);

// Lead scoring / priority leads.
// `controller.getPriorityLeads` exempts SUPER_ADMIN from unit-level scoping
// (it may query any/all units). Route-level `authorize` and the controller's
// scoping branch must stay in agreement: a role allowed through here but not
// exempted below sees 403s instead of the intended cross-unit view.
router.get(
  '/leads/priority',
  authorize(RoleCode.SUPER_ADMIN, 'UNIT_ADMIN', 'STAFF'),
  controller.getPriorityLeads
);

// ==================== ADMISSION PERIODS ====================

/**
 * @swagger
 * /api/admissions/periods:
 *   get:
 *     summary: List admission periods
 *     tags: [Admissions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: unitId
 *         schema:
 *           type: string
 *       - in: query
 *         name: isActive
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of admission periods
 */
// Read-only listing/detail routes are open to unit admins for cross-unit
// oversight; foundation-level access is SUPER_ADMIN. Write routes
// (POST/PUT/DELETE and the enroll/score/status mutations below) remain
// restricted to SUPER_ADMIN/UNIT_ADMIN — foundation-level admins are
// expected to read but not directly mutate admissions records.
router.get(
  '/periods',
  viewAdmissions(RoleCode.SUPER_ADMIN, 'UNIT_ADMIN'),
  validateQuery(queryAdmissionPeriodSchema),
  controller.getAdmissionPeriods
);

/**
 * @swagger
 * /api/admissions/periods:
 *   post:
 *     summary: Create admission period
 *     tags: [Admissions]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - unitId
 *               - startDate
 *               - endDate
 *             properties:
 *               name:
 *                 type: string
 *               unitId:
 *                 type: string
 *               startDate:
 *                 type: string
 *                 format: date
 *               endDate:
 *                 type: string
 *                 format: date
 *               quota:
 *                 type: integer
 *     responses:
 *       201:
 *         description: Admission period created
 */
router.post(
  '/periods',
  authorize(RoleCode.SUPER_ADMIN, 'UNIT_ADMIN'),
  controller.createAdmissionPeriod
);

/**
 * @swagger
 * /api/admissions/periods/{id}:
 *   get:
 *     summary: Get admission period by ID
 *     tags: [Admissions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Admission period details
 */
router.get(
  '/periods/:id',
  viewAdmissions(RoleCode.SUPER_ADMIN, 'UNIT_ADMIN'),
  controller.getAdmissionPeriodById
);

/**
 * @swagger
 * /api/admissions/periods/{id}/stats:
 *   get:
 *     summary: Get admission period statistics
 *     tags: [Admissions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Admission period statistics (registrants, accepted, etc.)
 */
router.get(
  '/periods/:id/stats',
  viewAdmissions(RoleCode.SUPER_ADMIN, 'UNIT_ADMIN'),
  controller.getAdmissionPeriodStats
);

/**
 * @swagger
 * /api/admissions/periods/{id}/fees:
 *   put:
 *     summary: Replace an intake's fee table (the brochure's Rincian Biaya)
 *     tags: [Admissions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: The fee lines, in order
 */
router.put(
  '/periods/:id/fees',
  authorize(RoleCode.SUPER_ADMIN, 'UNIT_ADMIN'),
  validate(replaceAdmissionFeesSchema),
  controller.replaceAdmissionFees
);

/**
 * @swagger
 * /api/admissions/periods/{id}:
 *   patch:
 *     summary: Update admission period
 *     tags: [Admissions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Admission period updated
 */
router.patch(
  '/periods/:id',
  authorize(RoleCode.SUPER_ADMIN, 'UNIT_ADMIN'),
  controller.updateAdmissionPeriod
);

/**
 * @swagger
 * /api/admissions/periods/{id}:
 *   delete:
 *     summary: Delete admission period
 *     tags: [Admissions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Admission period deleted
 */
router.delete(
  '/periods/:id',
  authorize(RoleCode.SUPER_ADMIN, 'UNIT_ADMIN'),
  controller.deleteAdmissionPeriod
);

// ==================== REGISTRANTS ====================

/**
 * @swagger
 * /api/admissions/registrants:
 *   get:
 *     summary: List registrants
 *     tags: [Admissions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: periodId
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [REGISTERED, VERIFIED, TESTED, ACCEPTED, REJECTED, ENROLLED]
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of registrants
 */
router.get(
  '/registrants',
  viewAdmissions(RoleCode.SUPER_ADMIN, 'UNIT_ADMIN', 'STAFF'),
  validateQuery(queryRegistrantSchema),
  controller.getRegistrants
);

/**
 * @swagger
 * /api/admissions/registrants:
 *   post:
 *     summary: Create registrant
 *     tags: [Admissions]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - periodId
 *               - name
 *               - birthDate
 *               - gender
 *             properties:
 *               periodId:
 *                 type: string
 *               name:
 *                 type: string
 *               birthDate:
 *                 type: string
 *                 format: date
 *               gender:
 *                 type: string
 *                 enum: [MALE, FEMALE]
 *               parentName:
 *                 type: string
 *               phone:
 *                 type: string
 *               address:
 *                 type: string
 *     responses:
 *       201:
 *         description: Registrant created
 */
router.post(
  '/registrants',
  authorize(RoleCode.SUPER_ADMIN, 'UNIT_ADMIN', 'STAFF'),
  controller.createRegistrant
);

/**
 * @swagger
 * /api/admissions/registrants/{id}:
 *   get:
 *     summary: Get registrant by ID
 *     tags: [Admissions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Registrant details
 */
router.get(
  '/registrants/:id',
  viewAdmissions(RoleCode.SUPER_ADMIN, 'UNIT_ADMIN', 'STAFF'),
  controller.getRegistrantById
);

/**
 * @swagger
 * /api/admissions/registrants/{id}:
 *   put:
 *     summary: Update registrant
 *     tags: [Admissions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Registrant updated
 */
router.put(
  '/registrants/:id',
  authorize(RoleCode.SUPER_ADMIN, 'UNIT_ADMIN', 'STAFF'),
  controller.updateRegistrant
);

/**
 * @swagger
 * /api/admissions/registrants/{id}/score:
 *   patch:
 *     summary: Update registrant test score
 *     tags: [Admissions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - score
 *             properties:
 *               score:
 *                 type: number
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Score updated
 */
router.patch(
  '/registrants/:id/score',
  authorize(RoleCode.SUPER_ADMIN, 'UNIT_ADMIN'),
  controller.updateRegistrantScore
);

/**
 * @swagger
 * /api/admissions/registrants/{id}/status:
 *   patch:
 *     summary: Update registrant status (accept/reject)
 *     tags: [Admissions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [VERIFIED, TESTED, ACCEPTED, REJECTED]
 *     responses:
 *       200:
 *         description: Status updated
 */
router.patch(
  '/registrants/:id/status',
  authorize(RoleCode.SUPER_ADMIN, 'UNIT_ADMIN'),
  controller.updateRegistrantStatus
);

/**
 * @swagger
 * /api/admissions/registrants/{id}/registration-fee:
 *   patch:
 *     summary: Catat pelunasan biaya daftar ulang
 *     description: >
 *       Counterpart to the enrolment gate — a registrant cannot become an
 *       active santri until this is recorded. STAFF is included because
 *       recording a payment at the front desk is tata usaha work, not an
 *       admin-only decision.
 *     responses:
 *       200:
 *         description: Pelunasan tercatat
 */
router.patch(
  '/registrants/:id/registration-fee',
  authorize(RoleCode.SUPER_ADMIN, 'UNIT_ADMIN', 'STAFF'),
  controller.recordRegistrationFee
);

/**
 * @swagger
 * /api/admissions/registrants/{id}/enroll:
 *   post:
 *     summary: Enroll accepted registrant as student
 *     tags: [Admissions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               classId:
 *                 type: string
 *     responses:
 *       201:
 *         description: Registrant enrolled as student
 */
router.post(
  '/registrants/:id/enroll',
  authorize(RoleCode.SUPER_ADMIN, 'UNIT_ADMIN'),
  controller.enrollRegistrant
);

/**
 * @swagger
 * /api/admissions/registrants/{id}:
 *   delete:
 *     summary: Delete registrant
 *     tags: [Admissions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Registrant deleted
 */
router.delete(
  '/registrants/:id',
  authorize(RoleCode.SUPER_ADMIN, 'UNIT_ADMIN'),
  controller.deleteRegistrant
);

// ==================== DOCUMENTS ====================

/**
 * @swagger
 * /api/admissions/registrants/{registrantId}/documents:
 *   get:
 *     summary: Get registrant documents
 *     tags: [Admissions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: registrantId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of registrant documents
 */
router.get(
  '/registrants/:registrantId/documents',
  viewAdmissions(RoleCode.SUPER_ADMIN, 'UNIT_ADMIN', 'STAFF'),
  controller.getRegistrantDocuments
);

/**
 * @swagger
 * /api/admissions/registrants/{registrantId}/documents:
 *   post:
 *     summary: Upload registrant document
 *     tags: [Admissions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: registrantId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - type
 *               - url
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [BIRTH_CERTIFICATE, FAMILY_CARD, PHOTO, REPORT_CARD, OTHER]
 *               url:
 *                 type: string
 *     responses:
 *       201:
 *         description: Document uploaded
 */
router.post(
  '/registrants/:registrantId/documents',
  authorize(RoleCode.SUPER_ADMIN, 'UNIT_ADMIN', 'STAFF'),
  controller.createRegistrantDocument
);

/**
 * @swagger
 * /api/admissions/documents/{id}/verify:
 *   patch:
 *     summary: Verify document
 *     tags: [Admissions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - isVerified
 *             properties:
 *               isVerified:
 *                 type: boolean
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Document verified
 */
router.patch(
  '/documents/:id/verify',
  authorize(RoleCode.SUPER_ADMIN, 'UNIT_ADMIN'),
  controller.verifyDocument
);

/**
 * @swagger
 * /api/admissions/documents/{id}:
 *   delete:
 *     summary: Delete document
 *     tags: [Admissions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Document deleted
 */
router.delete(
  '/documents/:id',
  authorize(RoleCode.SUPER_ADMIN, 'UNIT_ADMIN'),
  controller.deleteRegistrantDocument
);

export default router;
