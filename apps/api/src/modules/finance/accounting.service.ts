import { prisma } from '../../lib/prisma';
import { Prisma, AccountCode } from '@prisma/client';
import { JournalReferenceType } from '@cipansor/shared';
import { Errors } from '@/middleware/error';
import { assertUnitWritable, isCrossUnitWriter, type WriteActor } from '@/utils/write-scope';

// =====================================
// COA (CHART OF ACCOUNTS) SERVICE
// =====================================

export async function createAccount(data: {
  code: string;
  name: string;
  type: string;
  normalBalance: string;
  parentId?: string;
  cashFlowCategory?: string;
  netAssetCategory?: string;
  ziswafFundType?: string;
  isActive?: boolean;
}) {
  return prisma.accountCode.create({
    data: {
      code: data.code,
      name: data.name,
      type: data.type,
      normalBalance: data.normalBalance,
      parentId: data.parentId,
      cashFlowCategory: data.cashFlowCategory,
      netAssetCategory: data.netAssetCategory,
      ziswafFundType: data.ziswafFundType,
      isActive: data.isActive ?? true,
    },
    include: {
      parent: true,
    },
  });
}

export async function updateAccount(
  id: string,
  data: {
    code?: string;
    name?: string;
    type?: string;
    normalBalance?: string;
    parentId?: string;
    cashFlowCategory?: string;
    netAssetCategory?: string;
    ziswafFundType?: string;
    isActive?: boolean;
  }
) {
  return prisma.accountCode.update({
    where: { id },
    data,
    include: {
      parent: true,
    },
  });
}

export async function getAccounts(query: { search?: string; type?: string; isActive?: boolean }) {
  const where: Prisma.AccountCodeWhereInput = {
    ...(query.isActive !== undefined && { isActive: query.isActive }),
    ...(query.type && { type: query.type }),
    ...(query.search && {
      OR: [
        { code: { contains: query.search, mode: 'insensitive' } },
        { name: { contains: query.search, mode: 'insensitive' } },
      ],
    }),
  };

  const accounts = await prisma.accountCode.findMany({
    where,
    orderBy: { code: 'asc' },
    include: {
      parent: { select: { id: true, name: true, code: true } },
    },
  });

  return accounts;
}

export async function getAccountById(id: string) {
  return prisma.accountCode.findUnique({
    where: { id },
    include: {
      parent: true,
      children: true,
    },
  });
}

export async function deleteAccount(id: string) {
  // Check for existing journals
  const journalCount = await prisma.journalEntry.count({
    where: { accountId: id },
  });

  if (journalCount > 0) {
    throw new Error('Cannot delete account with existing journal entries.');
  }

  // Check for children
  const childrenCount = await prisma.accountCode.count({
    where: { parentId: id },
  });

  if (childrenCount > 0) {
    throw new Error('Cannot delete account with child accounts.');
  }

  return prisma.accountCode.delete({
    where: { id },
  });
}

// =====================================
// JOURNAL SERVICE
// =====================================

export async function createManualJournal(data: {
  unitId: string;
  date: Date;
  description: string;
  entries: {
    accountId: string;
    debit: number;
    credit: number;
  }[];
  createdById: string;
  actor: WriteActor;
}) {
  // A journal belongs to the caller's own unit; only Super_Admin may name another
  // (#988, R26.7). A unit-scoped role's `unitId` in the body is ignored.
  const unitId = isCrossUnitWriter(data.actor) ? data.unitId : data.actor.unitId;
  if (!unitId) throw Errors.forbidden('Akun ini tidak terikat pada unit mana pun');
  assertUnitWritable(data.actor, unitId, 'Unit');

  return prisma.$transaction(async (tx) => {
    // Validate balance
    const totalDebit = data.entries.reduce((sum, e) => sum + e.debit, 0);
    const totalCredit = data.entries.reduce((sum, e) => sum + e.credit, 0);

    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      // Floating point tolerance
      throw new Error(`Journal is not balanced. Debit: ${totalDebit}, Credit: ${totalCredit}`);
    }

    // Every account must exist and belong to the journal's unit — a shared row
    // (`unitId: null`) is not enough (#988, R26.8). One bad line refuses the whole
    // request with 404, the same answer as for an account that does not exist, so
    // no partial journal is written.
    const accountIds = [...new Set(data.entries.map((e) => e.accountId))];
    const owned = await tx.accountCode.findMany({
      where: { id: { in: accountIds }, unitId },
      select: { id: true },
    });
    if (owned.length !== accountIds.length) throw Errors.notFound('AccountCode');

    const referenceId = crypto.randomUUID(); // Group ID for manual entry

    const createdEntries = [];
    for (const entry of data.entries) {
      const je = await tx.journalEntry.create({
        data: {
          unitId,
          accountId: entry.accountId,
          date: data.date,
          description: data.description,
          debit: new Prisma.Decimal(entry.debit),
          credit: new Prisma.Decimal(entry.credit),
          reference: referenceId,
          referenceType: 'MANUAL', // Using string literal as fallback if Enum not exported
          createdById: data.createdById,
        },
      });
      createdEntries.push(je);
    }

    return createdEntries;
  });
}

export async function getJournals(query: {
  unitId?: string;
  accountId?: string;
  startDate?: Date;
  endDate?: Date;
  page: number;
  limit: number;
}) {
  const { unitId, accountId, startDate, endDate, page, limit } = query;
  const skip = (page - 1) * limit;

  const where: Prisma.JournalEntryWhereInput = {
    ...(unitId && { unitId }),
    ...(accountId && { accountId }),
    ...(startDate || endDate
      ? {
          date: {
            ...(startDate && { gte: startDate }),
            ...(endDate && { lte: endDate }),
          },
        }
      : {}),
  };

  const [data, total] = await Promise.all([
    prisma.journalEntry.findMany({
      where,
      include: {
        account: { select: { code: true, name: true } },
        createdBy: { select: { name: true } },
      },
      orderBy: { date: 'desc' },
      skip,
      take: limit,
    }),
    prisma.journalEntry.count({ where }),
  ]);

  return {
    data,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

// =====================================
// REPORTS SERVICE
// =====================================

export async function getTrialBalance(query: {
  unitId?: string;
  startDate?: Date;
  endDate?: Date;
}) {
  const { unitId, startDate, endDate } = query;

  const where: Prisma.JournalEntryWhereInput = {
    ...(unitId && { unitId }),
    ...(startDate || endDate
      ? {
          date: {
            ...(startDate && { gte: startDate }),
            ...(endDate && { lte: endDate }),
          },
        }
      : {}),
  };

  // Group by accountId
  const aggregations = await prisma.journalEntry.groupBy({
    by: ['accountId'],
    where,
    _sum: {
      debit: true,
      credit: true,
    },
  });

  // Fetch account details
  const accounts = await prisma.accountCode.findMany({
    orderBy: { code: 'asc' },
  });

  // Map results
  const result = accounts.map((acc) => {
    const agg = aggregations.find((a) => a.accountId === acc.id);
    const totalDebit = agg?._sum.debit?.toNumber() || 0;
    const totalCredit = agg?._sum.credit?.toNumber() || 0;

    // Calculate net balance based on normal balance
    let balance = 0;
    if (acc.normalBalance === 'DEBIT') {
      balance = totalDebit - totalCredit;
    } else {
      balance = totalCredit - totalDebit;
    }

    return {
      accountId: acc.id,
      code: acc.code,
      name: acc.name,
      type: acc.type,
      normalBalance: acc.normalBalance,
      debit: totalDebit,
      credit: totalCredit,
      balance,
    };
  });

  // Filter out zero balances if needed, or keep for full report
  return result;
}

export async function getBalanceSheet(query: { unitId?: string; endDate: Date }) {
  // Balance sheet is "As of Date", so we need all transactions up to endDate
  const trialBalance = await getTrialBalance({
    unitId: query.unitId,
    endDate: query.endDate,
  });

  // Filter for Asset, Liability, Equity
  const assets = trialBalance.filter((i) => i.type === 'ASSET');
  const liabilities = trialBalance.filter((i) => i.type === 'LIABILITY');
  const equity = trialBalance.filter((i) => i.type === 'EQUITY');

  // Calculate Net Income (Retained Earnings) from Revenue - Expense
  // This is a simplified calculation. Real systems might close periods.
  const revenues = trialBalance.filter((i) => i.type === 'REVENUE');
  const expenses = trialBalance.filter((i) => i.type === 'EXPENSE');

  const totalRevenue = revenues.reduce((sum, i) => sum + i.credit - i.debit, 0); // Rev is Credit normal
  const totalExpense = expenses.reduce((sum, i) => sum + i.debit - i.credit, 0); // Exp is Debit normal
  const netIncome = totalRevenue - totalExpense;

  return {
    assets,
    totalAssets: assets.reduce((sum, i) => sum + i.balance, 0),
    liabilities,
    totalLiabilities: liabilities.reduce((sum, i) => sum + i.balance, 0),
    equity,
    netIncome,
    totalEquity: equity.reduce((sum, i) => sum + i.balance, 0) + netIncome,
  };
}

export async function getIncomeStatement(query: {
  unitId?: string;
  startDate: Date;
  endDate: Date;
}) {
  const trialBalance = await getTrialBalance({
    unitId: query.unitId,
    startDate: query.startDate,
    endDate: query.endDate,
  });

  const revenues = trialBalance.filter((i) => i.type === 'REVENUE');
  const expenses = trialBalance.filter((i) => i.type === 'EXPENSE');

  const totalRevenue = revenues.reduce((sum, i) => sum + i.credit - i.debit, 0);
  const totalExpense = expenses.reduce((sum, i) => sum + i.debit - i.credit, 0);

  return {
    revenues,
    totalRevenue,
    expenses,
    totalExpense,
    netIncome: totalRevenue - totalExpense,
  };
}

// =====================================
// SEEDING SERVICE
// =====================================

export async function seedDefaultAccounts() {
  const defaultAccounts = [
    // ASSETS
    { code: '1101', name: 'Kas', type: 'ASSET', normalBalance: 'DEBIT' },
    { code: '1102', name: 'Bank', type: 'ASSET', normalBalance: 'DEBIT' },
    { code: '1103', name: 'Piutang Santri', type: 'ASSET', normalBalance: 'DEBIT' },
    { code: '1201', name: 'Tanah', type: 'ASSET', normalBalance: 'DEBIT' },
    { code: '1202', name: 'Bangunan', type: 'ASSET', normalBalance: 'DEBIT' },

    // LIABILITIES
    { code: '2101', name: 'Hutang Usaha', type: 'LIABILITY', normalBalance: 'CREDIT' },
    { code: '2102', name: 'Hutang Gaji', type: 'LIABILITY', normalBalance: 'CREDIT' },

    // EQUITY
    { code: '3101', name: 'Modal Yayasan', type: 'EQUITY', normalBalance: 'CREDIT' },
    { code: '3102', name: 'Saldo Laba', type: 'EQUITY', normalBalance: 'CREDIT' },

    // REVENUE
    { code: '4101', name: 'Pendapatan SPP', type: 'REVENUE', normalBalance: 'CREDIT' },
    { code: '4102', name: 'Pendapatan Pembangunan', type: 'REVENUE', normalBalance: 'CREDIT' },
    { code: '4103', name: 'Pendapatan Lain-lain', type: 'REVENUE', normalBalance: 'CREDIT' },

    // EXPENSE
    { code: '5101', name: 'Beban Gaji', type: 'EXPENSE', normalBalance: 'DEBIT' },
    { code: '5102', name: 'Beban Listrik & Air', type: 'EXPENSE', normalBalance: 'DEBIT' },
    { code: '5103', name: 'Beban Operasional', type: 'EXPENSE', normalBalance: 'DEBIT' },
  ];

  const results = [];
  for (const acc of defaultAccounts) {
    const existing = await prisma.accountCode.findUnique({
      where: { code: acc.code },
    });

    if (!existing) {
      const created = await prisma.accountCode.create({
        data: {
          code: acc.code,
          name: acc.name,
          type: acc.type,
          normalBalance: acc.normalBalance,
          isActive: true,
        },
      });
      results.push(created);
    }
  }

  return results;
}
