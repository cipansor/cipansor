import { Request, Response } from 'express';
import { asyncHandler } from '@/middleware/error';
import { requireUser } from '@/middleware/auth';
import { ApiResponse } from '@/utils/response';
import * as service from './data-subject-requests.service';
import {
  createGuardianDataSubjectRequestSchema,
  createPublicDataSubjectRequestSchema,
  verifyPublicDataSubjectRequestSchema,
  updateDataSubjectRequestStatusSchema,
  listDataSubjectRequestsQuerySchema,
  dataSubjectRequestIdParamSchema,
} from './data-subject-requests.schema';
import { PERMISSIONS } from '@/modules/roles/permissions';

/**
 * Permintaan hak subjek data (UU 27/2022 Pasal 30, 35, 40, 43).
 *
 * Tiga permukaan berbeda, dan perbedaan itulah yang membentuk berkas ini:
 *
 * 1. **Publik** — pendaftar SPMB yang belum punya akun. Dua langkah, dan
 *    langkah pertama tidak mengembalikan data apa pun.
 * 2. **Portal** — wali dan santri yang sudah masuk, untuk dirinya atau anak
 *    tanggungannya. Otorisasinya hubungan, bukan jabatan.
 * 3. **Petugas** — pemegang izin `PDP_MANAGE`, yang menindaklanjuti.
 *
 * Tidak ada satu pun endpoint yang membuka data subjek kepada pihak ketiga
 * yang tidak membuktikan dirinya; verifikasi identitas adalah bagian dari
 * alurnya, bukan langkah opsional (Pasal 33).
 */

/** Permukaan publik: ajukan permintaan tanpa sesi. */
export const submitPublic = asyncHandler(async (req: Request, res: Response) => {
  const data = createPublicDataSubjectRequestSchema.parse(req.body);
  const created = await service.submitPublicRequest(data);
  // 202, bukan 201: barisnya memang dibuat, tetapi permintaannya BELUM selesai
  // — ia menunggu verifikasi identitas. 201 akan menyiratkan selesai.
  res
    .status(202)
    .json(
      ApiResponse.success(
        created,
        'Permintaan diterima. Kode verifikasi dikirim ke kontak yang terdaftar pada data pendaftaran.'
      )
    );
});

/** Permukaan publik: verifikasi kode. Tidak membuka data subjek. */
export const verifyPublic = asyncHandler(async (req: Request, res: Response) => {
  const data = verifyPublicDataSubjectRequestSchema.parse(req.body);
  const verified = await service.verifyPublicRequest(data);
  res.json(
    ApiResponse.success(
      verified,
      'Identitas terverifikasi. Petugas pelindungan data pribadi akan menghubungi Anda.'
    )
  );
});

/** Permukaan portal: ajukan permintaan sebagai pemohon yang sudah masuk. */
export const submit = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const data = createGuardianDataSubjectRequestSchema.parse(req.body);
  const created = await service.submitGuardianRequest(data, {
    userId: user.sub,
    name: await service.resolveActorName(user.sub),
    hasPdpPermission: (user.permissions ?? []).includes(PERMISSIONS.PDP_MANAGE),
  });
  res.status(201).json(ApiResponse.success(created, 'Permintaan Anda tercatat'));
});

/** Permukaan portal: permintaan yang diajukan oleh pemohon sendiri. */
export const listMine = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const rows = await service.listMyRequests(user.sub);
  res.json(ApiResponse.success(rows));
});

/** Permukaan petugas: daftar kerja. */
export const list = asyncHandler(async (req: Request, res: Response) => {
  const query = listDataSubjectRequestsQuerySchema.parse(req.query);
  const result = await service.listRequests(query);
  res.json(
    ApiResponse.success(result.data, undefined, {
      page: query.page,
      limit: query.limit,
      total: result.total,
      totalPages: Math.max(1, Math.ceil(result.total / query.limit)),
    })
  );
});

/** Permukaan petugas: satu permintaan lengkap dengan riwayat tindakannya. */
export const findOne = asyncHandler(async (req: Request, res: Response) => {
  const { id } = dataSubjectRequestIdParamSchema.parse(req.params);
  const found = await service.getRequest(id);
  res.json(ApiResponse.success(found));
});

/** Permukaan petugas: pindahkan status, jalankan tindakannya bila menutup. */
export const updateStatus = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const { id } = dataSubjectRequestIdParamSchema.parse(req.params);
  const data = updateDataSubjectRequestStatusSchema.parse(req.body);
  const result = await service.updateStatus(id, data, {
    userId: user.sub,
    name: await service.resolveActorName(user.sub),
  });
  // Salinan data untuk permintaan akses ikut dikembalikan sekali di sini, ke
  // petugas yang menutupnya — bukan disimpan di mana pun.
  res.json(
    ApiResponse.success(
      result.exportPayload
        ? { ...result.request, exportPayload: result.exportPayload }
        : result.request,
      'Status permintaan diperbarui'
    )
  );
});
