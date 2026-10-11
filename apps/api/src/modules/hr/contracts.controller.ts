import { Request, Response, NextFunction } from 'express';
import { RoleCode } from '@prisma/client';
import { contractService } from './contracts.service';
import { requireUser } from '../../middleware/auth';
import { assertMayReadEmployeeRecord } from './hr.service';
import { sendResponse } from '@/utils/response';
import { Errors } from '@/middleware/error';

export const contractController = {
  create: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await contractService.create({
        ...req.body,
        startDate: new Date(req.body.startDate),
        endDate: req.body.endDate ? new Date(req.body.endDate) : undefined,
      });
      sendResponse(res, result, 'Contract created successfully', 201);
    } catch (error) {
      next(error);
    }
  },

  update: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const result = await contractService.update(id, {
        ...req.body,
        startDate: req.body.startDate ? new Date(req.body.startDate) : undefined,
        endDate: req.body.endDate ? new Date(req.body.endDate) : undefined,
      });
      sendResponse(res, result, 'Contract updated successfully');
    } catch (error) {
      next(error);
    }
  },

  findAll: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { unitId, roleCode } = req.user!;
      const requestedUnitId = req.query.unitId as string | undefined;
      const isSuperAdmin = roleCode === RoleCode.SUPER_ADMIN;
      const scopedUnitId = (isSuperAdmin ? requestedUnitId : unitId) ?? undefined;
      if (!isSuperAdmin && !scopedUnitId) throw Errors.badRequest('Unit ID missing from user');

      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 10;
      const search = req.query.search as string;
      const status = req.query.status as string;

      const result = await contractService.findAll(scopedUnitId, { page, limit, search, status });
      // `findAll` already returns the full SharedPaginatedResponse envelope.
      res.json(result);
    } catch (error) {
      next(error);
    }
  },

  findByUser: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = req.params;
      await assertMayReadEmployeeRecord(requireUser(req), userId);
      const result = await contractService.findByUser(userId);
      sendResponse(res, result, 'User contracts retrieved successfully');
    } catch (error) {
      next(error);
    }
  },

  getExpiring: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { unitId, roleCode } = req.user!;
      const requestedUnitId = req.query.unitId as string | undefined;
      const isSuperAdmin = roleCode === RoleCode.SUPER_ADMIN;
      const scopedUnitId = (isSuperAdmin ? requestedUnitId : unitId) ?? undefined;
      if (!isSuperAdmin && !scopedUnitId) throw Errors.badRequest('Unit ID missing from user');

      const days = Number(req.query.days) || 30;
      const result = await contractService.findExpiring(scopedUnitId, days);
      sendResponse(res, result, 'Expiring contracts retrieved successfully');
    } catch (error) {
      next(error);
    }
  },
};
