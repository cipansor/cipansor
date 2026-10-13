import { Request, Response, NextFunction } from 'express';
import { RoleCode } from '@prisma/client';
import { departmentService } from './departments.service';
import { sendResponse } from '@/utils/response';
import { Errors } from '@/middleware/error';

export const departmentController = {
  create: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { unitId } = req.user!;
      if (!unitId) throw Errors.badRequest('Unit ID missing from user');

      const result = await departmentService.create({ ...req.body, unitId });
      sendResponse(res, result, 'Department created successfully', 201);
    } catch (error) {
      next(error);
    }
  },

  update: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const result = await departmentService.update(id, req.body);
      sendResponse(res, result, 'Department updated successfully');
    } catch (error) {
      next(error);
    }
  },

  findAll: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { unitId, roleCode } = req.user!;
      const requestedUnitId = req.query.unitId as string | undefined;
      const isSuperAdmin = roleCode === RoleCode.SUPER_ADMIN;

      // SUPER_ADMIN may aggregate across units (no `unitId` → all units);
      // everyone else is pinned to their own unit and must have one.
      const scopedUnitId = (isSuperAdmin ? requestedUnitId : unitId) ?? undefined;
      if (!isSuperAdmin && !scopedUnitId) throw Errors.badRequest('Unit ID missing from user');

      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 10;
      const search = req.query.search as string;

      const result = await departmentService.findAll(scopedUnitId, { page, limit, search });
      // `findAll` already returns the full SharedPaginatedResponse envelope;
      // sendResponse would wrap it a second time as { success, data: { success, data } }.
      res.json(result);
    } catch (error) {
      next(error);
    }
  },

  findOne: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const result = await departmentService.findOne(id);
      if (!result) throw Errors.notFound('Department');
      sendResponse(res, result, 'Department retrieved successfully');
    } catch (error) {
      next(error);
    }
  },

  delete: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      await departmentService.delete(id);
      sendResponse(res, null, 'Department deleted successfully');
    } catch (error) {
      next(error);
    }
  },
};
