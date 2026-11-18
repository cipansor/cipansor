import { Request, Response } from 'express';
import * as service from './rapor-pesantren.service';
import { getLegerQuerySchema, listRaporQuerySchema } from './rapor-pesantren.schema';
import { asyncHandler } from '@/middleware/error';
import { ApiResponse } from '@/utils/response';
import { requireUser } from '@/middleware/auth';
import type { WriteActor } from '@/utils/write-scope';

/** The write actor a service scopes a write on, from the verified token. */
function actorOf(req: Request): WriteActor {
  const u = requireUser(req);
  return { sub: u.sub, roleCode: u.roleCode, unitId: u.unitId };
}

/** GET /api/rapor-pesantren/config/:unitId */
export const getConfig = asyncHandler(async (req: Request, res: Response) => {
  const config = await service.getRaporConfig(req.params.unitId);
  res.json(ApiResponse.success(config));
});

/** PUT /api/rapor-pesantren/config */
export const saveConfig = asyncHandler(async (req: Request, res: Response) => {
  const config = await service.saveRaporConfig(req.body, actorOf(req));
  res.json(ApiResponse.success(config, 'Configuration saved successfully'));
});

/** POST /api/rapor-pesantren/generate */
export const generate = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.generateRaporPesantren(req.body);
  res.status(201).json(ApiResponse.success(result, 'Rapor generated successfully'));
});

/** POST /api/rapor-pesantren/generate-batch */
export const generateBatch = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.generateBatchRaporPesantren(req.body);
  res.json(ApiResponse.success(result, `Generated ${result.success}/${result.total} rapor`));
});

/** GET /api/rapor-pesantren/leger */
export const getLeger = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.getLegerPesantren(getLegerQuerySchema.parse(req.query));
  res.json(ApiResponse.success(result));
});

/** GET /api/rapor-pesantren */
export const list = asyncHandler(async (req: Request, res: Response) => {
  const query = listRaporQuerySchema.parse(req.query);
  const result = await service.listRaporPesantren(query);
  res.json(
    ApiResponse.paginated(result.data, result.meta.page, result.meta.limit, result.meta.total)
  );
});

/** GET /api/rapor-pesantren/:id */
export const getById = asyncHandler(async (req: Request, res: Response) => {
  const rapor = await service.getRaporPesantrenById(req.params.id);
  if (!rapor) {
    return res.status(404).json(ApiResponse.error('Rapor not found'));
  }
  res.json(ApiResponse.success(rapor));
});

/** PUT /api/rapor-pesantren/:id */
export const update = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.updateRaporPesantren(req.params.id, req.body, actorOf(req));
  res.json(ApiResponse.success(result, 'Rapor updated successfully'));
});

/** DELETE /api/rapor-pesantren/:id */
export const remove = asyncHandler(async (req: Request, res: Response) => {
  await service.deleteRaporPesantren(req.params.id, actorOf(req));
  res.json(ApiResponse.success(null, 'Rapor deleted successfully'));
});
