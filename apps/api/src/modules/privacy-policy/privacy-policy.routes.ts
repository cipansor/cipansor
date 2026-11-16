import { Router } from 'express';
import { RoleCode } from '@prisma/client';
import { authenticate, authorize } from '@/middleware/auth';
import * as controller from './privacy-policy.controller';

/**
 * Kebijakan Privasi publik yang berversi (UU PDP 27/2022 Pasal 30, 35).
 *
 * Satu rute terbuka — `GET /privacy-policy/current` — supaya halaman publik dan
 * formulir SPMB membacanya tanpa sesi. Sisanya Super Admin: yang menulis teks
 * kebijakan adalah organ yang bertanggung jawab atasnya, bukan sembarang admin
 * unit (sejalan dengan persona asisten AI).
 *
 * Jalur statis didahulukan atas jalur berparameter (`utils/route-shadowing.guard.test.ts`).
 */
const router = Router();

// ==================== PUBLIC ====================
// Diletakkan SEBELUM `authenticate` agar pengunjung tanpa sesi dapat membacanya.
router.get('/current', controller.getCurrent);

router.use(authenticate);

// ==================== SUPER ADMIN ====================
const onlySuperAdmin = authorize(RoleCode.SUPER_ADMIN);

router.get('/versions', onlySuperAdmin, controller.listVersions);
router.post('/versions', onlySuperAdmin, controller.createVersion);
router.get('/versions/:version', onlySuperAdmin, controller.getVersion);

export default router;
