import { Request, Response, NextFunction } from 'express';
import { leaveBalanceService } from './leave-balances.service';
import { requireUser } from '../../middleware/auth';
import { assertMayReadEmployeeRecord } from './hr.service';
import { sendResponse } from '@/utils/response';
import { Errors } from '@/middleware/error';

export const leaveBalanceController = {
  getBalances: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = req.params;
      const { academicYearId } = req.query; // Should get current AY if missing

      if (!academicYearId) {
        // Fallback to finding active academic year could be done in service
        // For now, require it
        if (!academicYearId) throw Errors.badRequest('Academic Year ID is required');
      }

      await assertMayReadEmployeeRecord(requireUser(req), userId);
      const result = await leaveBalanceService.getAllBalances(userId, academicYearId as string);
      sendResponse(res, result, 'Leave balances retrieved successfully');
    } catch (error) {
      next(error);
    }
  },

  initialize: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { unitId } = req.user!;
      if (!unitId) throw Errors.badRequest('Unit ID missing from user');

      const result = await leaveBalanceService.initializeBalance({
        ...req.body,
        unitId,
      });
      sendResponse(res, result, 'Leave balance initialized successfully', 201);
    } catch (error) {
      next(error);
    }
  },

  update: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const { totalDays } = req.body;
      const result = await leaveBalanceService.updateBalance(id, Number(totalDays));
      sendResponse(res, result, 'Leave balance updated successfully');
    } catch (error) {
      next(error);
    }
  },
};
