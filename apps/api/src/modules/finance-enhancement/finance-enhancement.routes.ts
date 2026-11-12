import { Router } from 'express';
import { authenticate, authorize, isSuperAdmin } from '@/middleware/auth';
import { validate } from '@/middleware/validate';
import { RoleCode } from '@prisma/client';
import { financeEnhancementController } from './finance-enhancement.controller';
import {
  createAccountCodeSchema,
  updateAccountCodeSchema,
  createJournalEntrySchema,
  createScholarshipSchema,
  assignScholarshipSchema,
  createScholarshipCriterionSchema,
  createPaymentComponentSchema,
  createBudgetSchema,
  updateBudgetSchema,
  createFinancialPeriodSchema,
} from './finance-enhancement.schema';

// Reusable admin authorizer for finance-enhancement routes.
// Includes SUPER_ADMIN + all per-unit/yayasan admin RoleCodes + legacy
// 'UNIT_ADMIN' string for pre-migration JWT tokens (expanded via
// LEGACY_ROLE_EXPANSION in apps/api/src/middleware/auth.ts).
const financeAdmin = () =>
  authorize(
    RoleCode.SUPER_ADMIN,
    RoleCode.TKQ_ADMIN,
    RoleCode.SDIT_ADMIN,
    RoleCode.SMPIT_ADMIN,
    RoleCode.SMAQ_ADMIN,
    'UNIT_ADMIN' // Legacy pre-migration token value
  );

const router = Router();

// All routes require authentication
router.use(authenticate);

// ==================== ACCOUNT CODES ====================

router.get('/account-codes', financeEnhancementController.getAccountCodes);

router.post(
  '/account-codes',
  financeAdmin(),
  validate(createAccountCodeSchema),
  financeEnhancementController.createAccountCode
);

router.put(
  '/account-codes/:id',
  financeAdmin(),
  validate(updateAccountCodeSchema),
  financeEnhancementController.updateAccountCode
);

// ==================== JOURNAL ENTRIES ====================

router.get('/journal-entries', financeAdmin(), financeEnhancementController.getJournalEntries);

router.post(
  '/journal-entries',
  financeAdmin(),
  validate(createJournalEntrySchema),
  financeEnhancementController.createJournalEntry
);

router.get('/journal-entries/:id', financeEnhancementController.getJournalEntryById);

// ==================== SCHOLARSHIPS ====================

router.get('/scholarships', financeEnhancementController.getScholarships);

router.post(
  '/scholarships',
  financeAdmin(),
  validate(createScholarshipSchema),
  financeEnhancementController.createScholarship
);

router.get('/scholarships/:id', financeEnhancementController.getScholarshipById);

router.get('/scholarships/:id/recipients', financeEnhancementController.getScholarshipRecipients);

router.post(
  '/scholarship-recipients',
  financeAdmin(),
  validate(assignScholarshipSchema),
  financeEnhancementController.assignScholarship
);

// Scholarship scoring (criteria + automated assessment from PR #313)
router.get('/scholarships/:id/criteria', financeEnhancementController.getScholarshipCriteria);
router.post(
  '/scholarships/:id/criteria',
  financeAdmin(),
  validate(createScholarshipCriterionSchema),
  financeEnhancementController.createScholarshipCriterion
);
router.post(
  '/scholarship-recipients/:id/assess',
  financeAdmin(),
  financeEnhancementController.assessScholarshipRecipient
);

// ==================== PAYMENT COMPONENTS ====================

router.get('/payment-components', financeEnhancementController.getPaymentComponents);

router.post(
  '/payment-components',
  financeAdmin(),
  validate(createPaymentComponentSchema),
  financeEnhancementController.createPaymentComponent
);

// ==================== REPORTS ====================

router.get('/reports/trial-balance', financeAdmin(), financeEnhancementController.getTrialBalance);

router.get(
  '/reports/income-expense',
  financeAdmin(),
  financeEnhancementController.getIncomeExpenseReport
);

router.get(
  '/reports/general-ledger',
  financeAdmin(),
  financeEnhancementController.getGeneralLedger
);

router.get(
  '/reports/income-statement',
  financeAdmin(),
  financeEnhancementController.getIncomeExpenseReport
);

router.get('/reports/cash-flow', financeAdmin(), financeEnhancementController.getCashFlowStatement);

router.get(
  '/reports/budget-realization',
  financeAdmin(),
  financeEnhancementController.getBudgetRealizationReport
);
// ==================== BUDGETS ====================

router.get('/budgets', financeAdmin(), financeEnhancementController.getBudgets);

router.post(
  '/budgets',
  financeAdmin(),
  validate(createBudgetSchema),
  financeEnhancementController.createBudget
);

router.put(
  '/budgets/:id',
  financeAdmin(),
  validate(updateBudgetSchema),
  financeEnhancementController.updateBudget
);

router.delete('/budgets/:id', financeAdmin(), financeEnhancementController.deleteBudget);

router.post(
  '/budgets/recalculate',
  financeAdmin(),
  financeEnhancementController.recalculateBudgetUsage
);

router.get(
  '/budgets/alerts',
  financeAdmin(),
  financeEnhancementController.getBudgetUtilizationAlerts
);

// ==================== FINANCIAL PERIODS ====================

router.get('/financial-periods', financeAdmin(), financeEnhancementController.getFinancialPeriods);

router.post(
  '/financial-periods',
  financeAdmin(),
  validate(createFinancialPeriodSchema),
  financeEnhancementController.createFinancialPeriod
);

router.patch(
  '/financial-periods/:id/close',
  financeAdmin(),
  financeEnhancementController.closeFinancialPeriod
);

// ==================== NEW REPORTS ====================

router.get('/reports/balance-sheet', financeAdmin(), financeEnhancementController.getBalanceSheet);

router.get(
  '/reports/cash-flow-forecast',
  financeAdmin(),
  financeEnhancementController.getCashFlowForecast
);

// ==================== CONSOLIDATED BUDGET (Foundation-level) ====================

router.get(
  '/reports/consolidated-budget',
  isSuperAdmin,
  financeEnhancementController.getConsolidatedBudget
);

export default router;
