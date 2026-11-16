import { Router } from 'express';
import { RoleCode } from '@prisma/client';
import { authenticate, authorize } from '@/middleware/auth';
import * as controller from './privacy-policy.controller';

/**
 * Kebijakan Privasi publik yang berversi (UU PDP 27/2022 Pasal 30, 35).
 *
 * Dua rute terbuka: `GET /privacy-policy/current` (versi yang berlaku) dan
 * `GET /privacy-policy/versions/:version` (teks satu versi). Keduanya memang
 * publik: yang pertama dibaca halaman publik dan formulir SPMB, yang kedua
 * dibaca halaman yang sama ketika formulir menautkan versi yang akan dicatat
 * (`/kebijakan-privasi?version=N`) — tautan persetujuan harus menunjuk teks
 * yang persis akan disetujui, dan teks itu pernah terbit untuk umum. Sisanya
 * Super Admin: yang menulis teks kebijakan adalah organ yang bertanggung jawab
 * atasnya, bukan sembarang admin unit.
 *
 * Jalur statis didahulukan atas jalur berparameter (`utils/route-shadowing.guard.test.ts`).
 */
const router = Router();

// ==================== PUBLIC ====================
// Diletakkan SEBELUM `authenticate` agar pengunjung tanpa sesi dapat membacanya.
router.get('/current', controller.getCurrent);
router.get('/versions/:version', controller.getVersion);

router.use(authenticate);

// ==================== SUPER ADMIN ====================
const onlySuperAdmin = authorize(RoleCode.SUPER_ADMIN);

router.get('/versions', onlySuperAdmin, controller.listVersions);
router.post('/versions', onlySuperAdmin, controller.createVersion);

export default router;
