import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth';
import * as controller from './organisasi.controller';

const router = Router();

// Org Units
router.get('/units', authenticate, controller.getOrgUnits);
router.get('/tree', authenticate, controller.getOrgTree);
router.get('/units/:id', authenticate, controller.getOrgUnit);
router.post(
  '/units',
  authenticate,
  authorize('UNIT_ADMIN', 'SUPER_ADMIN'),
  controller.createOrgUnit
);
router.put(
  '/units/:id',
  authenticate,
  authorize('UNIT_ADMIN', 'SUPER_ADMIN'),
  controller.updateOrgUnit
);
router.delete(
  '/units/:id',
  authenticate,
  authorize('UNIT_ADMIN', 'SUPER_ADMIN'),
  controller.deleteOrgUnit
);

// Positions
router.get('/positions', authenticate, controller.getAllPositions);
router.get('/units/:orgUnitId/positions', authenticate, controller.getPositions);
router.get('/positions/:id', authenticate, controller.getPositionById);
router.post(
  '/positions',
  authenticate,
  authorize('UNIT_ADMIN', 'SUPER_ADMIN'),
  controller.createPosition
);
router.put(
  '/positions/:id',
  authenticate,
  authorize('UNIT_ADMIN', 'SUPER_ADMIN'),
  controller.updatePosition
);
router.delete(
  '/positions/:id',
  authenticate,
  authorize('UNIT_ADMIN', 'SUPER_ADMIN'),
  controller.deletePosition
);

export default router;
