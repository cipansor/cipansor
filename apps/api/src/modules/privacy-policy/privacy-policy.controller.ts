import { Request, Response } from 'express';
import { asyncHandler } from '@/middleware/error';
import { requireUser } from '@/middleware/auth';
import { ApiResponse } from '@/utils/response';
import * as service from './privacy-policy.service';
import {
  createPrivacyPolicyVersionSchema,
  listPrivacyPolicyVersionsQuerySchema,
  versionParamSchema,
} from './privacy-policy.schema';

/**
 * Kebijakan Privasi publik (UU PDP 27/2022 Pasal 30, 35).
 *
 * `getCurrent` sengaja TANPA autentikasi: halaman publik dan formulir SPMB
 * membacanya tanpa sesi. Yang tertutup hanya penerbitan versi baru dan daftar
 * riwayat — keduanya Super Admin (lihat `privacy-policy.routes.ts`).
 */

/** GET /privacy-policy/current — versi yang berlaku, untuk halaman publik. */
export const getCurrent = asyncHandler(async (_req: Request, res: Response) => {
  const current = await service.getCurrentPolicy();
  // Belum ada versi = yayasan belum menerbitkan teksnya. Bukan galat peladen:
  // halaman publik menampilkannya sebagai "belum tersedia", dan formulir SPMB
  // memang belum boleh mengumpulkan data. 200 + null menjaga keduanya.
  res.json(ApiResponse.success(current));
});

/** GET /privacy-policy/versions — daftar versi (Super Admin). */
export const listVersions = asyncHandler(async (req: Request, res: Response) => {
  const query = listPrivacyPolicyVersionsQuerySchema.parse(req.query);
  const result = await service.listVersions(query);
  res.json(ApiResponse.success(result.data, undefined, result.pagination));
});

/** GET /privacy-policy/versions/:version — satu versi lengkap (Super Admin). */
export const getVersion = asyncHandler(async (req: Request, res: Response) => {
  const { version } = versionParamSchema.parse(req.params);
  const found = await service.getVersion(version);
  if (!found) {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: `Versi kebijakan privasi ${version} tidak ditemukan` },
    });
    return;
  }
  res.json(ApiResponse.success(found));
});

/** POST /privacy-policy/versions — terbitkan versi baru (Super Admin). */
export const createVersion = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const data = createPrivacyPolicyVersionSchema.parse(req.body);
  const created = await service.createVersion(data, { sub: user.sub });
  res.status(201).json(ApiResponse.success(created, 'Versi kebijakan privasi diterbitkan'));
});
