import { prisma } from '@/lib/prisma';
import {
  AccountCode,
  CreateAccountCodeInput,
  UpdateAccountCodeInput,
  JournalEntry,
  CreateJournalEntryInput,
  Scholarship,
  CreateScholarshipInput,
  ScholarshipRecipient,
  AssignScholarshipInput,
  PaymentComponent,
  CreatePaymentComponentInput,
  TrialBalanceReport,
  IncomeExpenseReport,
  SharedPaginatedResponse,
  Pagination,
  AccountType,
  FinanceReportPeriod,
} from '@cipansor/shared';
import { Prisma } from '@prisma/client';
import { checkPeriodStatus } from './period.service';
import { CLASS_ENROLLMENT_STATUS } from '@cipansor/shared';

export class FinanceEnhancementService {
  // ==================== ACCOUNT CODES ====================

  async getAccountCodes(params: {
    type?: string;
    isActive?: boolean;
    search?: string;
    unitId?: string;
    page: number;
    limit: number;
  }): Promise<SharedPaginatedResponse<AccountCode>> {
    const { type, isActive, search, unitId, page, limit } = params;

    // A unit's chart of accounts also holds shared rows (`unitId: null`, legacy
    // or foundation-wide), so a `unitId` filter answers "accounts this unit may
    // use" rather than an exact match. It exists because the budgeting form must
    // offer only accounts `createBudget` accepts — filtering client-side over
    // the first page hid a unit's own accounts that fell past it.
    const and: Prisma.AccountCodeWhereInput[] = [];
    if (type) and.push({ type });
    if (isActive !== undefined) and.push({ isActive });
    if (search) {
      and.push({
        OR: [
          { code: { contains: search, mode: 'insensitive' } },
          { name: { contains: search, mode: 'insensitive' } },
        ],
      });
    }
    if (unitId) and.push({ OR: [{ unitId }, { unitId: null }] });
    const whereClause: Prisma.AccountCodeWhereInput = and.length ? { AND: and } : {};

    const [data, total] = await Promise.all([
      prisma.accountCode.findMany({
        where: whereClause,
        include: {
          parent: { select: { id: true, code: true, name: true, type: true } },
          children: { select: { id: true, code: true, name: true, type: true } },
        },
        orderBy: { code: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.accountCode.count({ where: whereClause }),
    ]);

    return {
      success: true,
      data: data.map(this.mapToAccountCode),
      meta: {
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    };
  }

  async createAccountCode(input: CreateAccountCodeInput): Promise<AccountCode> {
    const existing = await prisma.accountCode.findUnique({ where: { code: input.code } });
    if (existing) {
      throw new Error('Account code already exists');
    }

    const accountCode = await prisma.accountCode.create({
      data: {
        code: input.code,
        name: input.name,
        type: input.type,
        parentId: input.parentId,
        isActive: input.isActive ?? true,
        cashFlowCategory: input.cashFlowCategory,
      },
    });

    return this.mapToAccountCode(accountCode);
  }

  async updateAccountCode(id: string, input: UpdateAccountCodeInput): Promise<AccountCode> {
    const accountCode = await prisma.accountCode.update({
      where: { id },
      data: {
        ...input,
        type: input.type ? input.type : undefined,
        cashFlowCategory: input.cashFlowCategory,
      },
    });
    return this.mapToAccountCode(accountCode);
  }

  // ==================== JOURNAL ENTRIES ====================

  async getJournalEntries(params: {
    unitId?: string;
    accountId?: string;
    startDate?: Date;
    endDate?: Date;
    search?: string;
    page: number;
    limit: number;
  }): Promise<SharedPaginatedResponse<JournalEntry>> {
    const { unitId, accountId, startDate, endDate, search, page, limit } = params;

    const whereClause: Prisma.JournalEntryWhereInput = {};
    if (unitId) whereClause.unitId = unitId;
    if (accountId) whereClause.accountId = accountId;
    if (startDate || endDate) {
      whereClause.date = {};
      if (startDate) whereClause.date.gte = startDate;
      if (endDate) whereClause.date.lte = endDate;
    }
    if (search) {
      whereClause.description = { contains: search, mode: 'insensitive' };
    }

    const [data, total] = await Promise.all([
      prisma.journalEntry.findMany({
        where: whereClause,
        include: {
          unit: { select: { id: true, name: true } },
          account: { select: { id: true, code: true, name: true, type: true } },
          createdBy: { select: { id: true, name: true } },
        },
        orderBy: { date: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.journalEntry.count({ where: whereClause }),
    ]);

    return {
      success: true,
      data: data.map(this.mapToJournalEntry),
      meta: {
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    };
  }

  async createJournalEntry(
    input: CreateJournalEntryInput & { createdById: string }
  ): Promise<JournalEntry> {
    // Check if period is closed
    const entryDate = new Date(input.date);
    await checkPeriodStatus(input.unitId, entryDate);

    // Use transaction to ensure consistency
    const result = await prisma.$transaction(async (tx) => {
      // 1. Create Journal Entry
      const entry = await tx.journalEntry.create({
        data: {
          unitId: input.unitId,
          accountId: input.accountId,
          date: entryDate,
          description: input.description || '',
          debit: input.debit || 0,
          credit: input.credit || 0,
          reference: input.reference,
          referenceType: input.referenceType ?? null,
          createdById: input.createdById,
        },
        include: {
          unit: { select: { name: true } },
          account: { select: { code: true, name: true, normalBalance: true } },
        },
      });

      // 2. Update Budget Realization (if exists)
      // Find academic year for this date
      const academicYear = await tx.academicYear.findFirst({
        where: {
          startDate: { lte: entryDate },
          endDate: { gte: entryDate },
        },
        orderBy: [
          { isActive: 'desc' }, // Prefer active year first
          { startDate: 'desc' }, // Then most recent start date
        ],
      });

      if (academicYear) {
        const budget = await tx.budget.findUnique({
          where: {
            unitId_academicYearId_accountId: {
              unitId: input.unitId,
              academicYearId: academicYear.id,
              accountId: input.accountId,
            },
          },
        });

        if (budget) {
          const debit = Number(input.debit || 0);
          const credit = Number(input.credit || 0);
          let delta = 0;

          if (entry.account?.normalBalance === 'CREDIT') {
            delta = credit - debit;
          } else {
            delta = debit - credit;
          }

          if (delta !== 0) {
            // Use raw SQL to update atomically and enforce non-negative constraint
            await tx.$executeRaw`
              UPDATE budgets
              SET used_amount = GREATEST(0, used_amount + ${delta})
              WHERE id = ${budget.id}
            `;
          }
        }
      }

      return entry;
    });

    return this.mapToJournalEntry(result);
  }

  async getJournalEntryById(id: string): Promise<JournalEntry | null> {
    const entry = await prisma.journalEntry.findUnique({
      where: { id },
      include: {
        unit: { select: { id: true, name: true } },
        account: { select: { id: true, code: true, name: true, type: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });

    if (!entry) return null;

    return this.mapToJournalEntry(entry);
  }

  // ==================== SCHOLARSHIPS ====================

  async getScholarships(params: {
    unitId?: string;
    type?: string;
    source?: string;
    isActive?: boolean;
    page: number;
    limit: number;
  }): Promise<SharedPaginatedResponse<Scholarship>> {
    const { unitId, type, source, isActive, page, limit } = params;

    const whereClause: Prisma.ScholarshipWhereInput = {};
    if (unitId) whereClause.unitId = unitId;
    if (type) whereClause.type = type;
    if (source) whereClause.source = source;
    if (isActive !== undefined) whereClause.isActive = isActive;

    const [data, total] = await Promise.all([
      prisma.scholarship.findMany({
        where: whereClause,
        include: {
          unit: { select: { id: true, name: true } },
          _count: { select: { recipients: true, discounts: true } },
        },
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.scholarship.count({ where: whereClause }),
    ]);

    return {
      success: true,
      data: data.map(this.mapToScholarship),
      meta: {
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    };
  }

  async createScholarship(input: CreateScholarshipInput): Promise<Scholarship> {
    const scholarship = await prisma.scholarship.create({
      data: {
        name: input.name,
        description: input.description,
        source: input.source as string,
        type: input.type as string,
        quota: input.quota,
        requirements: input.requirements,
        startDate: new Date(input.startDate),
        endDate: input.endDate ? new Date(input.endDate) : null,
        unitId: input.unitId,
        isActive: input.isActive ?? true,
      },
    });

    return this.mapToScholarship(scholarship);
  }

  async getScholarshipById(id: string): Promise<Scholarship | null> {
    const scholarship = await prisma.scholarship.findUnique({
      where: { id },
      include: {
        unit: { select: { id: true, name: true } },
        discounts: {
          include: {
            component: { select: { code: true, name: true, amount: true } },
          },
        },
        _count: { select: { recipients: true } },
      },
    });

    if (!scholarship) return null;
    return this.mapToScholarship(scholarship);
  }

  async getScholarshipRecipients(
    id: string,
    params: {
      status?: string;
      page: number;
      limit: number;
    }
  ): Promise<SharedPaginatedResponse<ScholarshipRecipient>> {
    const { status, page, limit } = params;

    const whereClause: Prisma.ScholarshipRecipientWhereInput = { scholarshipId: id };
    if (status) whereClause.status = status;

    const [data, total] = await Promise.all([
      prisma.scholarshipRecipient.findMany({
        where: whereClause,
        include: {
          student: {
            include: {
              user: { select: { name: true } },
              enrollments: {
                where: { status: CLASS_ENROLLMENT_STATUS.ACTIVE },
                include: { class: { select: { name: true } } },
                take: 1,
              },
            },
          },
          academicYear: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.scholarshipRecipient.count({ where: whereClause }),
    ]);

    return {
      success: true,
      data: data.map(this.mapToScholarshipRecipient),
      meta: {
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    };
  }

  async assignScholarship(input: AssignScholarshipInput): Promise<ScholarshipRecipient> {
    const existing = await prisma.scholarshipRecipient.findFirst({
      where: {
        scholarshipId: input.scholarshipId,
        studentId: input.studentId,
        academicYearId: input.academicYearId,
      },
    });

    if (existing) {
      throw new Error('Student already has this scholarship for the academic year');
    }

    const recipient = await prisma.scholarshipRecipient.create({
      data: {
        scholarshipId: input.scholarshipId,
        studentId: input.studentId,
        academicYearId: input.academicYearId,
        startDate: new Date(input.startDate),
        endDate: input.endDate ? new Date(input.endDate) : null,
        notes: input.notes,
        status: 'ACTIVE',
      },
      include: {
        scholarship: { select: { name: true } },
        student: {
          include: { user: { select: { name: true } } },
        },
      },
    });

    return this.mapToScholarshipRecipient(recipient);
  }

  // ==================== PAYMENT COMPONENTS ====================

  async getPaymentComponents(params: {
    unitId?: string;
    category?: string;
    isActive?: boolean;
    page: number;
    limit: number;
  }): Promise<SharedPaginatedResponse<PaymentComponent>> {
    const { unitId, category, isActive, page, limit } = params;

    const whereClause: Prisma.PaymentComponentWhereInput = {};
    if (unitId) whereClause.unitId = unitId;
    if (category) whereClause.category = category;
    if (isActive !== undefined) whereClause.isActive = isActive;

    const [data, total] = await Promise.all([
      prisma.paymentComponent.findMany({
        where: whereClause,
        include: {
          unit: { select: { id: true, name: true } },
        },
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.paymentComponent.count({ where: whereClause }),
    ]);

    const mappedData = data.map((item) => ({
      ...item,
      amount: Number(item.amount),
    }));

    return {
      success: true,
      data: mappedData as unknown as PaymentComponent[],
      meta: {
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    };
  }

  async createPaymentComponent(input: CreatePaymentComponentInput): Promise<PaymentComponent> {
    const component = await prisma.paymentComponent.create({
      data: {
        code: input.code,
        name: input.name,
        description: input.description,
        category: input.category as string,
        amount: input.amount,
        unitId: input.unitId,
        isActive: input.isActive ?? true,
      },
    });

    return {
      ...component,
      amount: Number(component.amount),
    } as unknown as PaymentComponent;
  }

  // ==================== REPORTS ====================

  async getTrialBalance(params: {
    unitId?: string;
    startDate: Date;
    endDate: Date;
  }): Promise<TrialBalanceReport> {
    const { unitId, startDate, endDate } = params;

    const grouped = await prisma.journalEntry.groupBy({
      by: ['accountId'],
      where: {
        unitId,
        date: { gte: startDate, lte: endDate },
      },
      _sum: {
        debit: true,
        credit: true,
      },
    });

    const accountIds = grouped.map((g) => g.accountId);
    const accounts = await prisma.accountCode.findMany({
      where: { id: { in: accountIds } },
    });

    const accountMap = new Map(accounts.map((a) => [a.id, a]));

    // Opening balances: net (debit - credit) of all entries before the period.
    const opening = await prisma.journalEntry.groupBy({
      by: ['accountId'],
      where: {
        unitId,
        date: { lt: startDate },
      },
      _sum: { debit: true, credit: true },
    });
    const openingMap = new Map(
      opening.map((o) => [o.accountId, Number(o._sum.debit || 0) - Number(o._sum.credit || 0)])
    );

    const resultAccounts = grouped
      .map((group) => {
        const account = accountMap.get(group.accountId);
        const startBalance = openingMap.get(group.accountId) || 0;
        const debit = Number(group._sum.debit || 0);
        const credit = Number(group._sum.credit || 0);
        return {
          accountId: group.accountId,
          code: account?.code || 'UNKNOWN',
          name: account?.name || 'Unknown Account',
          type: account?.type || 'OTHER',
          startBalance,
          debit,
          credit,
          endBalance: startBalance + debit - credit,
        };
      })
      .sort((a, b) => a.code.localeCompare(b.code));

    const totals = resultAccounts.reduce(
      (acc, item) => ({
        startBalance: acc.startBalance + item.startBalance,
        debit: acc.debit + item.debit,
        credit: acc.credit + item.credit,
        endBalance: acc.endBalance + item.endBalance,
      }),
      { startBalance: 0, debit: 0, credit: 0, endBalance: 0 }
    );

    return {
      period: {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      },
      accounts: resultAccounts,
      totals,
      isBalanced: Math.abs(totals.debit - totals.credit) < 0.01,
    };
  }

  // NOTE: The previous one-month `getCashFlowForecast` method was removed.
  // The controller now delegates to `reporting.service.ts#getCashFlowForecast`
  // which implements a multi-month projection.

  async getConsolidatedBudget(params: { academicYearId: string }) {
    const { academicYearId } = params;

    const budgets = await prisma.budget.findMany({
      where: { academicYearId },
      include: {
        unit: { select: { name: true } },
        account: { select: { code: true, name: true, type: true } },
      },
    });

    const consolidated: Record<
      string,
      {
        accountCode: string;
        accountName: string;
        accountType: string;
        totalAmount: number;
        totalUsed: number;
        unitBreakdown: Array<{ unitName: string; amount: number; used: number }>;
      }
    > = {};

    budgets.forEach((b) => {
      const key = b.accountId;
      if (!consolidated[key]) {
        consolidated[key] = {
          accountCode: b.account.code,
          accountName: b.account.name,
          accountType: b.account.type,
          totalAmount: 0,
          totalUsed: 0,
          unitBreakdown: [],
        };
      }

      const amount = Number(b.amount);
      const used = Number(b.usedAmount);

      consolidated[key].totalAmount += amount;
      consolidated[key].totalUsed += used;
      consolidated[key].unitBreakdown.push({
        unitName: b.unit.name,
        amount,
        used,
      });
    });

    return Object.values(consolidated).sort((a, b) => a.accountCode.localeCompare(b.accountCode));
  }

  async getIncomeExpenseReport(params: {
    unitId?: string;
    startDate: Date;
    endDate: Date;
    groupBy?: FinanceReportPeriod | 'day' | 'month';
  }): Promise<IncomeExpenseReport> {
    const { unitId, startDate, endDate, groupBy = FinanceReportPeriod.MONTH } = params;

    const dateFormat = groupBy === FinanceReportPeriod.MONTH ? 'YYYY-MM' : 'YYYY-MM-DD';

    // Optimization: Using Enum constants instead of hardcoded strings
    const results = await prisma.$queryRaw<Array<{ period: string; type: string; total: bigint }>>`
      SELECT
        TO_CHAR(je.date, ${dateFormat}) as period,
        ac.type,
        SUM(COALESCE(je.credit, 0) - COALESCE(je.debit, 0)) as total
      FROM "journal_entries" je
      JOIN "account_codes" ac ON je.account_id = ac.id
      WHERE je.unit_id = ${unitId}
        AND je.date >= ${startDate}
        AND je.date <= ${endDate}
        AND ac.type IN (${AccountType.REVENUE}, ${AccountType.EXPENSE})
      GROUP BY 1, 2
      ORDER BY 1 ASC
    `;

    const breakdownMap: Record<string, { income: number; expense: number }> = {};
    let totalIncome = 0;
    let totalExpense = 0;

    results.forEach((row) => {
      const period = row.period;
      const val = Number(row.total);

      if (!breakdownMap[period]) {
        breakdownMap[period] = { income: 0, expense: 0 };
      }

      if (row.type === AccountType.REVENUE) {
        const amount = val;
        breakdownMap[period].income += amount;
        totalIncome += amount;
      } else if (row.type === AccountType.EXPENSE) {
        const amount = -val;
        breakdownMap[period].expense += amount;
        totalExpense += amount;
      }
    });

    const breakdown = Object.entries(breakdownMap)
      .map(([period, data]) => ({
        period,
        income: data.income,
        expense: data.expense,
        net: data.income - data.expense,
      }))
      .sort((a, b) => a.period.localeCompare(b.period));

    return {
      period: {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      },
      summary: {
        totalIncome,
        totalExpense,
        netIncome: totalIncome - totalExpense,
      },
      breakdown,
    };
  }

  // ==================== HELPERS ====================

  private mapToAccountCode(prismaAccount: any): AccountCode {
    return {
      id: prismaAccount.id,
      code: prismaAccount.code,
      name: prismaAccount.name,
      type: prismaAccount.type as AccountType, // Prisma enum should match Shared enum
      unitId: prismaAccount.unitId,
      parentId: prismaAccount.parentId,
      isActive: prismaAccount.isActive,
      createdAt: prismaAccount.createdAt,
      updatedAt: prismaAccount.updatedAt,
      // Map relations if they exist
      parent: prismaAccount.parent
        ? {
            id: prismaAccount.parent.id,
            code: prismaAccount.parent.code,
            name: prismaAccount.parent.name,
            type: prismaAccount.parent.type as AccountType,
            isActive: true, // Partial mapping for relation
          }
        : undefined,
      children: prismaAccount.children
        ? prismaAccount.children.map((c: any) => ({
            id: c.id,
            code: c.code,
            name: c.name,
            type: c.type as AccountType,
            isActive: true,
          }))
        : undefined,
    };
  }

  private mapToJournalEntry(prismaEntry: any): JournalEntry {
    return {
      id: prismaEntry.id,
      unitId: prismaEntry.unitId,
      accountId: prismaEntry.accountId,
      date: prismaEntry.date, // Date object, shared type allows string or Date
      description: prismaEntry.description,
      debit: Number(prismaEntry.debit),
      credit: Number(prismaEntry.credit),
      reference: prismaEntry.reference,
      referenceType: prismaEntry.referenceType,
      createdById: prismaEntry.createdById,
      createdAt: prismaEntry.createdAt,
      updatedAt: prismaEntry.updatedAt,

      unit: prismaEntry.unit,
      account: prismaEntry.account
        ? {
            id: prismaEntry.account.id,
            code: prismaEntry.account.code,
            name: prismaEntry.account.name,
            type: prismaEntry.account.type as AccountType,
            isActive: true,
          }
        : undefined,
      createdBy: prismaEntry.createdBy,
    };
  }

  private mapToScholarship(prismaScholarship: any): Scholarship {
    return {
      id: prismaScholarship.id,
      name: prismaScholarship.name,
      description: prismaScholarship.description,
      source: prismaScholarship.source,
      type: prismaScholarship.type,
      quota: prismaScholarship.quota,
      requirements: prismaScholarship.requirements,
      startDate: prismaScholarship.startDate,
      endDate: prismaScholarship.endDate,
      unitId: prismaScholarship.unitId,
      isActive: prismaScholarship.isActive,
      createdAt: prismaScholarship.createdAt,
      updatedAt: prismaScholarship.updatedAt,
      unit: prismaScholarship.unit,
      _count: prismaScholarship._count,
    };
  }

  private mapToScholarshipRecipient(prismaRecipient: any): ScholarshipRecipient {
    return {
      id: prismaRecipient.id,
      scholarshipId: prismaRecipient.scholarshipId,
      studentId: prismaRecipient.studentId,
      academicYearId: prismaRecipient.academicYearId,
      startDate: prismaRecipient.startDate,
      endDate: prismaRecipient.endDate,
      notes: prismaRecipient.notes,
      status: prismaRecipient.status,
      createdAt: prismaRecipient.createdAt,
      updatedAt: prismaRecipient.updatedAt,
      student: prismaRecipient.student
        ? {
            id: prismaRecipient.student.id,
            nis: prismaRecipient.student.nis,
            name: prismaRecipient.student.user?.name || '',
            class: prismaRecipient.student.enrollments?.[0]?.class?.name || '-',
          }
        : undefined,
      academicYear: prismaRecipient.academicYear,
      scholarship: prismaRecipient.scholarship,
    };
  }
}

export const financeEnhancementService = new FinanceEnhancementService();
