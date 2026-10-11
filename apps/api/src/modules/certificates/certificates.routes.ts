import { Router } from 'express';
import { UserRole } from '@prisma/client';
import { authenticate, authorize } from '../../middleware/auth';
import { validate, validateQuery } from '../../middleware/error';
import {
  createCertificateSchema,
  queryCertificateSchema,
  updateCertificateSchema,
} from './certificates.schema';
import * as controller from './certificates.controller';

const router = Router();

// Public verification must stay reachable without a session — the QR on a
// printed certificate points here.
router.get('/verify/:code', controller.verifyCertificate);

// Public PDF delivery, keyed by the printed certificate number. Placed here,
// with the other session-free routes, so a recipient can download a public
// certificate. `/verify/:code` is a two-segment path and `/public/...` a
// distinct prefix, so neither shadows the other.
router.get('/public/:code/download', controller.downloadPublicCertificate);

router.use(authenticate);

router.get(
  '/',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER),
  validateQuery(queryCertificateSchema),
  controller.listCertificates
);
router.get(
  '/student/:studentId',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER, UserRole.PARENT),
  controller.getStudentCertificates
);
router.get(
  '/:id',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER, UserRole.PARENT),
  controller.getCertificate
);
router.get(
  '/:id/download',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER, UserRole.PARENT),
  controller.downloadCertificate
);
router.post(
  '/',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER),
  validate(createCertificateSchema),
  controller.createCertificate
);
router.put(
  '/:id',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  validate(updateCertificateSchema),
  controller.updateCertificate
);
router.patch(
  '/:id',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  validate(updateCertificateSchema),
  controller.updateCertificate
);
router.delete(
  '/:id',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  controller.deleteCertificate
);

export default router;
