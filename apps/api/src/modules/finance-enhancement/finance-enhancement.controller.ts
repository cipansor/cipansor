import { requireUser } from '../../middleware/auth';
import { wibDayBound } from '../../utils/wib-day';
import { Request, Response, NextFunction } from 'express';
import { financeEnhancementService } from './finance-enhancement.service';
import {
  CreateAccountCodeInput,
  UpdateAccountCodeInput,
  CreateJournalEntryInput,
  CreateScholarshipInput,
  AssignScholarshipInput,
  CreatePaymentComponentInput,
  CreateBudgetInput,
  UpdateBudgetInput,
  CreateFinancialPeriodInput,
} from '@cipansor/shared';
import {
  createBudget,
  updateBudget,
  getBudgets,
  deleteBudget,
  recalculateBudgetUsage,
  getBudgetUtilizationAlerts,
} from './budget.service';
import { createFinancialPeriod, closePeriod, getFinancialPeriods } from './period.service';
import {
  getBalanceSheet,
  getIncomeStatement,
  getTrialBalance,
  getGeneralLedger,
  getCashFlowStatement,
  getBudgetRealizationReport,
  getCashFlowForecast,
} from './reporting.service';

// Helper for parsing pagination params
const parsePagination = (req: Request) => ({
  page: Number(req.query.page) || 1,
  limit: Number(req.query.limit) || 20,
});

export class FinanceEnhancementController {
  // ==================== ACCOUNT CODES ====================

  async getAccountCodes(req: Request, res: Response, next: NextFunction) {
    try {
      const { type, isActive, search } = req.query;
      const { page, limit } = parsePagination(req);

      const result = await financeEnhancementService.getAccountCodes({
        type: type as string,
        isActive: isActive !== undefined ? isActive === 'true' : undefined,
        search: search as string,
        page,
        limit,
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  async getBudgetRealizationReport(req: Request, res: Response, next: NextFunction) {
    try {
      const { unitId, academicYearId } = req.query;

      if (!unitId || !academicYearId) {
        return res
          .status(400)
          .json({ success: false, message: 'Unit ID and Academic Year ID are required' });
      }

      const result = await getBudgetRealizationReport(unitId as string, academicYearId as string);

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async createAccountCode(req: Request, res: Response, next: NextFunction) {
    try {
      const input: CreateAccountCodeInput = req.body;
      const result = await financeEnhancementService.createAccountCode(input);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async updateAccountCode(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const input: UpdateAccountCodeInput = req.body;
      const result = await financeEnhancementService.updateAccountCode(id, input);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  // ==================== JOURNAL ENTRIES ====================

  async getJournalEntries(req: Request, res: Response, next: NextFunction) {
    try {
      const { unitId, accountId, startDate, endDate, search } = req.query;
      const { page, limit } = parsePagination(req);

      const result = await financeEnhancementService.getJournalEntries({
        unitId: unitId as string,
        accountId: accountId as string,
        startDate: startDate ? wibDayBound(startDate as string, 'start') : undefined,
        endDate: endDate ? wibDayBound(endDate as string, 'end') : undefined,
        search: search as string,
        page,
        limit,
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  async createJournalEntry(req: Request, res: Response, next: NextFunction) {
    try {
      const input: CreateJournalEntryInput = req.body;
      const userId = requireUser(req).id;

      const result = await financeEnhancementService.createJournalEntry({
        ...input,
        createdById: userId,
      });

      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getJournalEntryById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await financeEnhancementService.getJournalEntryById(id);

      if (!result) {
        return res.status(404).json({ success: false, message: 'Journal entry not found' });
      }

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  // ==================== SCHOLARSHIPS ====================

  async getScholarships(req: Request, res: Response, next: NextFunction) {
    try {
      const { unitId, type, source, isActive } = req.query;
      const { page, limit } = parsePagination(req);

      const result = await financeEnhancementService.getScholarships({
        unitId: unitId as string,
        type: type as string,
        source: source as string,
        isActive: isActive !== undefined ? isActive === 'true' : undefined,
        page,
        limit,
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  async createScholarship(req: Request, res: Response, next: NextFunction) {
    try {
      const input: CreateScholarshipInput = req.body;
      const result = await financeEnhancementService.createScholarship(input);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getScholarshipById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await financeEnhancementService.getScholarshipById(id);

      if (!result) {
        return res.status(404).json({ success: false, message: 'Scholarship not found' });
      }

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getScholarshipRecipients(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { status } = req.query;
      const { page, limit } = parsePagination(req);

      const result = await financeEnhancementService.getScholarshipRecipients(id, {
        status: status as string,
        page,
        limit,
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  async assignScholarship(req: Request, res: Response, next: NextFunction) {
    try {
      const input: AssignScholarshipInput = req.body;
      const result = await financeEnhancementService.assignScholarship(input);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  // ==================== SCHOLARSHIP SCORING (Si-Beasiswa) ====================

  async createScholarshipCriterion(req: Request, res: Response, next: NextFunction) {
    try {
      const { prisma } = await import('@/lib/prisma');
      const criterion = await prisma.scholarshipCriterion.create({
        data: { ...req.body, scholarshipId: req.params.id },
      });
      res.status(201).json({ success: true, data: criterion });
    } catch (error) {
      next(error);
    }
  }

  async getScholarshipCriteria(req: Request, res: Response, next: NextFunction) {
    try {
      const { prisma } = await import('@/lib/prisma');
      const criteria = await prisma.scholarshipCriterion.findMany({
        where: { scholarshipId: req.params.id },
        orderBy: { createdAt: 'asc' },
      });
      res.json({ success: true, data: criteria });
    } catch (error) {
      next(error);
    }
  }

  async assessScholarshipRecipient(req: Request, res: Response, next: NextFunction) {
    try {
      const { scholarshipScoringService } = await import('../scholarship/scoring.service');
      const result = await scholarshipScoringService.assessRecipient(req.params.id);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  // ==================== PAYMENT COMPONENTS ====================

  async getPaymentComponents(req: Request, res: Response, next: NextFunction) {
    try {
      const { unitId, category, isActive } = req.query;
      const { page, limit } = parsePagination(req);

      const result = await financeEnhancementService.getPaymentComponents({
        unitId: unitId as string,
        category: category as string,
        isActive: isActive !== undefined ? isActive === 'true' : undefined,
        page,
        limit,
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  async createPaymentComponent(req: Request, res: Response, next: NextFunction) {
    try {
      const input: CreatePaymentComponentInput = req.body;
      const result = await financeEnhancementService.createPaymentComponent(input);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  // ==================== REPORTS ====================

  async getTrialBalance(req: Request, res: Response, next: NextFunction) {
    try {
      const { unitId, startDate, endDate } = req.query;

      if (!unitId || !startDate || !endDate) {
        return res
          .status(400)
          .json({ success: false, message: 'Unit ID, Start date, and End date are required' });
      }

      // Use Reporting Service Logic
      const result = await getTrialBalance(
        unitId as string,
        wibDayBound(startDate as string, 'start'),
        wibDayBound(endDate as string, 'end')
      );

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getGeneralLedger(req: Request, res: Response, next: NextFunction) {
    try {
      const { unitId, accountId, startDate, endDate } = req.query;

      if (!unitId || !startDate || !endDate || !accountId) {
        return res.status(400).json({
          success: false,
          message: 'Unit ID, Start date, End date, and Account ID are required',
        });
      }

      const result = await getGeneralLedger(
        unitId as string,
        accountId as string,
        wibDayBound(startDate as string, 'start'),
        wibDayBound(endDate as string, 'end')
      );

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getCashFlowStatement(req: Request, res: Response, next: NextFunction) {
    try {
      const { unitId, startDate, endDate } = req.query;

      if (!unitId || !startDate || !endDate) {
        return res
          .status(400)
          .json({ success: false, message: 'Unit ID, Start date, and End date are required' });
      }

      const result = await getCashFlowStatement(
        unitId as string,
        wibDayBound(startDate as string, 'start'),
        wibDayBound(endDate as string, 'end')
      );

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getIncomeExpenseReport(req: Request, res: Response, next: NextFunction) {
    try {
      const { unitId, startDate, endDate } = req.query;

      if (!unitId || !startDate || !endDate) {
        return res
          .status(400)
          .json({ success: false, message: 'Unit ID, Start date, and End date are required' });
      }

      const result = await getIncomeStatement(
        unitId as string,
        wibDayBound(startDate as string, 'start'),
        wibDayBound(endDate as string, 'end')
      );

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getBalanceSheet(req: Request, res: Response, next: NextFunction) {
    try {
      const { unitId, date } = req.query;

      if (!unitId || !date) {
        return res.status(400).json({ success: false, message: 'Unit ID and Date are required' });
      }

      const result = await getBalanceSheet(unitId as string, wibDayBound(date as string, 'end'));

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  // ==================== CASH FLOW FORECAST ====================

  async getCashFlowForecast(req: Request, res: Response, next: NextFunction) {
    try {
      const { unitId, months } = req.query;
      const user = requireUser(req);

      if (!unitId) {
        return res.status(400).json({ success: false, message: 'Unit ID is required' });
      }

      // Unit-level authorization: non-SUPER_ADMIN users can only access their own unit
      if (user.role !== 'SUPER_ADMIN' && user.unitId !== unitId) {
        return res
          .status(403)
          .json({ success: false, message: 'Access to this unit is not allowed' });
      }

      // Validate and cap `months` to prevent abuse (e.g. months=999999 would
      // create that many forecast iterations). Default to 6, clamp to [1, 24].
      const parsedMonths = Number(months);
      const safeMonths =
        Number.isFinite(parsedMonths) && parsedMonths >= 1
          ? Math.min(24, Math.floor(parsedMonths))
          : 6;
      const result = await getCashFlowForecast(unitId as string, safeMonths);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  // ==================== BUDGETS ====================

  async getBudgets(req: Request, res: Response, next: NextFunction) {
    try {
      const { unitId, academicYearId } = req.query;
      const { page, limit } = parsePagination(req);

      const result = await getBudgets(
        {
          unitId: unitId as string,
          academicYearId: academicYearId as string,
          page,
          limit,
        },
        requireUser(req)
      );

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async createBudget(req: Request, res: Response, next: NextFunction) {
    try {
      const input: CreateBudgetInput = req.body;
      const user = requireUser(req);

      const result = await createBudget(
        {
          ...input,
          createdById: user.id,
        },
        user
      );

      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async updateBudget(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const input: UpdateBudgetInput = req.body;
      const result = await updateBudget(id, input, requireUser(req));
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async deleteBudget(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      await deleteBudget(id, requireUser(req));
      res.json({ success: true, message: 'Budget deleted successfully' });
    } catch (error) {
      next(error);
    }
  }

  async getBudgetUtilizationAlerts(req: Request, res: Response, next: NextFunction) {
    try {
      const { unitId, academicYearId } = req.query;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const user = requireUser(req);

      // Unit-level authorization mirrors the cash-flow forecast endpoint:
      // a UNIT_ADMIN must not be able to query another unit's budget alerts
      // by supplying a different `unitId`, nor by omitting it (which would
      // otherwise return alerts across ALL units — see budget.service.ts
      // where `unitId` is only spread when truthy).
      let effectiveUnitId = unitId as string | undefined;
      if (user && user.role !== 'SUPER_ADMIN') {
        if (!user.unitId) {
          return res
            .status(403)
            .json({ success: false, message: 'Access to this unit is not allowed' });
        }
        if (effectiveUnitId && effectiveUnitId !== user.unitId) {
          return res
            .status(403)
            .json({ success: false, message: 'Access to this unit is not allowed' });
        }
        effectiveUnitId = user.unitId;
      }

      const alerts = await getBudgetUtilizationAlerts(
        effectiveUnitId,
        academicYearId as string | undefined
      );
      res.json({ success: true, data: alerts });
    } catch (error) {
      next(error);
    }
  }

  async recalculateBudgetUsage(req: Request, res: Response, next: NextFunction) {
    try {
      const { unitId, academicYearId } = req.body;
      if (!unitId || !academicYearId) {
        return res
          .status(400)
          .json({ success: false, message: 'Unit ID and Academic Year ID are required' });
      }

      const result = await recalculateBudgetUsage(unitId, academicYearId, requireUser(req));
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  // ==================== FINANCIAL PERIODS ====================

  async getFinancialPeriods(req: Request, res: Response, next: NextFunction) {
    try {
      const { unitId } = req.query;
      const { page, limit } = parsePagination(req);

      const result = await getFinancialPeriods(
        {
          unitId: unitId as string,
          page,
          limit,
        },
        requireUser(req)
      );

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async createFinancialPeriod(req: Request, res: Response, next: NextFunction) {
    try {
      const input: CreateFinancialPeriodInput = req.body;
      const result = await createFinancialPeriod(input, requireUser(req));
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getConsolidatedBudget(req: Request, res: Response, next: NextFunction) {
    try {
      const { academicYearId } = req.query;

      if (!academicYearId) {
        return res.status(400).json({ success: false, message: 'Academic Year ID is required' });
      }

      const result = await financeEnhancementService.getConsolidatedBudget({
        academicYearId: academicYearId as string,
      });

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async closeFinancialPeriod(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const user = requireUser(req);
      const result = await closePeriod(id, user.id, user);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
}

export const financeEnhancementController = new FinanceEnhancementController();
