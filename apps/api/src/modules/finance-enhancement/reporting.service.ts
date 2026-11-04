import { prisma } from '../../lib/prisma';
import { Prisma } from '@prisma/client';
import { wibDayOf } from '../../utils/wib-day';
import {
  AccountType,
  BalanceSheetReport,
  IncomeExpenseReport,
  TrialBalanceReport,
  GeneralLedgerReport,
  CashFlowReport,
  CashFlowCategory,
  GeneralLedgerEntry,
} from '@cipansor/shared';

// A report period is shown on the pesantren's clock. The bounds arrive as WIB
// instants (see `wibDayBound`), so reading them back with `toISOString()` would
// render the day before the one the user picked.
const formatDate = (date: Date) => wibDayOf(date);

export async function getBalanceSheet(unitId: string, date: Date): Promise<BalanceSheetReport> {
  // Get all accounts
  const accounts = await prisma.accountCode.findMany({
    where: { isActive: true },
    orderBy: { code: 'asc' },
  });

  // Calculate balances up to date
  const balances = await prisma.journalEntry.groupBy({
    by: ['accountId'],
    where: {
      unitId,
      date: { lte: date },
    },
    _sum: {
      debit: true,
      credit: true,
    },
  });

  const balanceMap = new Map<string, number>();
  balances.forEach((b) => {
    const debit = b._sum.debit?.toNumber() || 0;
    const credit = b._sum.credit?.toNumber() || 0;
    // Store simple net debit for now
    balanceMap.set(b.accountId, debit - credit);
  });

  const buildTree = (type: AccountType) => {
    const typeAccounts = accounts.filter((a) => a.type === type);
    const roots = typeAccounts.filter((a) => !a.parentId);

    interface ReportNode {
      code: string;
      name: string;
      amount: number;
      level: number;
      children?: ReportNode[];
    }
    const buildNode = (account: (typeof accounts)[0]): ReportNode => {
      const children: ReportNode[] = typeAccounts
        .filter((a) => a.parentId === account.id)
        .map(buildNode);
      let directBalance = balanceMap.get(account.id) || 0;

      // Flip sign for Credit normal accounts (Liability, Equity, Revenue)
      if (
        type === AccountType.LIABILITY ||
        type === AccountType.EQUITY ||
        type === AccountType.REVENUE
      ) {
        directBalance = -directBalance;
      }

      // Add children totals
      const childrenTotal = children.reduce((sum, c) => sum + c.amount, 0);

      return {
        code: account.code,
        name: account.name,
        amount: directBalance + childrenTotal,
        level: account.code.split('-').length,
        children: children.length > 0 ? children : undefined,
      };
    };

    return roots.map(buildNode);
  };

  const assets = buildTree(AccountType.ASSET);
  const liabilities = buildTree(AccountType.LIABILITY);
  const equity = buildTree(AccountType.EQUITY);

  return {
    assets: { title: 'Aset', total: assets.reduce((s, i) => s + i.amount, 0), items: assets },
    liabilities: {
      title: 'Liabilitas',
      total: liabilities.reduce((s, i) => s + i.amount, 0),
      items: liabilities,
    },
    equity: { title: 'Ekuitas', total: equity.reduce((s, i) => s + i.amount, 0), items: equity },
    periodDate: formatDate(date),
  };
}

export async function getIncomeStatement(
  unitId: string,
  startDate: Date,
  endDate: Date
): Promise<IncomeExpenseReport> {
  const accounts = await prisma.accountCode.findMany({
    where: {
      type: { in: [AccountType.REVENUE, AccountType.EXPENSE] },
      isActive: true,
    },
    orderBy: { code: 'asc' },
  });

  const balances = await prisma.journalEntry.groupBy({
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

  const balanceMap = new Map<string, number>();
  balances.forEach((b) => {
    const debit = b._sum.debit?.toNumber() || 0;
    const credit = b._sum.credit?.toNumber() || 0;
    balanceMap.set(b.accountId, debit - credit);
  });

  // Calculate totals
  let totalIncome = 0;
  let totalExpense = 0;

  const breakdown = accounts
    .map((acc) => {
      let amount = balanceMap.get(acc.id) || 0;

      if (acc.type === AccountType.REVENUE) {
        amount = -amount; // Revenue is Credit normal, so flip Debit-Credit
        totalIncome += amount;
      } else {
        totalExpense += amount;
      }

      return {
        period: 'Current',
        income: acc.type === AccountType.REVENUE ? amount : 0,
        expense: acc.type === AccountType.EXPENSE ? amount : 0,
        net: 0,
        accountName: acc.name,
        accountCode: acc.code,
      };
    })
    .filter((item) => item.income !== 0 || item.expense !== 0);

  return {
    period: { startDate: formatDate(startDate), endDate: formatDate(endDate) },
    summary: {
      totalIncome,
      totalExpense,
      netIncome: totalIncome - totalExpense,
    },
    breakdown: breakdown,
  };
}

export async function getTrialBalance(
  unitId: string,
  startDate: Date,
  endDate: Date
): Promise<TrialBalanceReport> {
  const accounts = await prisma.accountCode.findMany({
    where: { isActive: true },
    orderBy: { code: 'asc' },
  });

  // 1. Get Opening Balances (before startDate)
  const openingBalances = await prisma.journalEntry.groupBy({
    by: ['accountId'],
    where: {
      unitId,
      date: { lt: startDate },
    },
    _sum: {
      debit: true,
      credit: true,
    },
  });

  const openingMap = new Map<string, number>();
  openingBalances.forEach((b) => {
    const net = (b._sum.debit?.toNumber() || 0) - (b._sum.credit?.toNumber() || 0);
    openingMap.set(b.accountId, net);
  });

  // 2. Get Period Movements
  const movements = await prisma.journalEntry.groupBy({
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

  const movementMap = new Map<string, { debit: number; credit: number }>();
  movements.forEach((b) => {
    movementMap.set(b.accountId, {
      debit: b._sum.debit?.toNumber() || 0,
      credit: b._sum.credit?.toNumber() || 0,
    });
  });

  const reportItems = accounts
    .map((acc) => {
      const startNet = openingMap.get(acc.id) || 0;
      const move = movementMap.get(acc.id) || { debit: 0, credit: 0 };
      const endNet = startNet + move.debit - move.credit;

      // Adjust sign for display based on Normal Balance if needed, but Trial Balance usually shows raw Debit/Credit columns
      // However, usually Trial Balance shows: Opening (D/C), Movement (D/C), Closing (D/C)
      // Our interface is simple: startBalance, debit, credit, endBalance
      // We will keep sign convention: Positive = Debit, Negative = Credit

      return {
        accountId: acc.id,
        code: acc.code,
        name: acc.name,
        type: acc.type,
        startBalance: startNet,
        debit: move.debit,
        credit: move.credit,
        endBalance: endNet,
      };
    })
    .filter(
      (item) => Math.abs(item.startBalance) > 0.01 || item.debit > 0.01 || item.credit > 0.01
    );

  const totals = reportItems.reduce(
    (acc, item) => ({
      startBalance: acc.startBalance + item.startBalance,
      debit: acc.debit + item.debit,
      credit: acc.credit + item.credit,
      endBalance: acc.endBalance + item.endBalance,
    }),
    { startBalance: 0, debit: 0, credit: 0, endBalance: 0 }
  );

  return {
    period: { startDate: formatDate(startDate), endDate: formatDate(endDate) },
    accounts: reportItems,
    totals,
    isBalanced: Math.abs(totals.endBalance) < 0.1, // Allow small float error
  };
}

export async function getGeneralLedger(
  unitId: string,
  accountId: string,
  startDate: Date,
  endDate: Date
): Promise<GeneralLedgerReport> {
  const account = await prisma.accountCode.findUnique({
    where: { id: accountId },
  });

  if (!account) throw new Error('Account not found');

  // Get Opening Balance
  const openingAgg = await prisma.journalEntry.aggregate({
    where: {
      unitId,
      accountId,
      date: { lt: startDate },
    },
    _sum: {
      debit: true,
      credit: true,
    },
  });

  let runningBalance =
    (openingAgg._sum.debit?.toNumber() || 0) - (openingAgg._sum.credit?.toNumber() || 0);
  const startBalance = runningBalance;

  // Get Entries
  const entries = await prisma.journalEntry.findMany({
    where: {
      unitId,
      accountId,
      date: { gte: startDate, lte: endDate },
    },
    orderBy: { date: 'asc' },
  });

  const formattedEntries: GeneralLedgerEntry[] = entries.map((e) => {
    const debit = e.debit.toNumber();
    const credit = e.credit.toNumber();
    runningBalance += debit - credit;

    return {
      id: e.id,
      date: formatDate(e.date),
      description: e.description,
      reference: e.reference || null,
      debit,
      credit,
      balance: runningBalance,
    };
  });

  return {
    period: { startDate: formatDate(startDate), endDate: formatDate(endDate) },
    accounts: [
      {
        accountId: account.id,
        code: account.code,
        name: account.name,
        startBalance,
        entries: formattedEntries,
        endBalance: runningBalance,
      },
    ],
  };
}

export async function getCashFlowStatement(
  unitId: string,
  startDate: Date,
  endDate: Date
): Promise<CashFlowReport> {
  // Using Indirect Method approximation or Direct Method based on tags?
  // Since we added `cashFlowCategory`, we can use Direct Method logic where applicable.
  // However, most entries might not have `cashFlowCategory` on the *offsetting* account easily accessible without complex queries.
  //
  // Simplified Direct Method:
  // 1. Find all Cash/Bank accounts.
  // 2. Get all Journal Entries for these accounts in the period.
  // 3. For each entry, find the contra-account (this is hard in simple journal system without grouping ID).
  //
  // Alternative: Indirect Method (Standard)
  // Start with Net Income -> Adjust Non-Cash -> Adjust Working Capital.

  // Let's implement a "Modified Direct Method" using the `cashFlowCategory` we added to AccountCode.
  // We calculate the net movement of accounts tagged with OPERATING, INVESTING, FINANCING.
  // But wait, Cash Flow is about CASH movement caused by these.
  // So:
  // Operating Cash Flow = Net change in Revenue/Expense accounts (Cash basis)
  //
  // Actually, simplest robust way with our new schema:
  // Calculate Net Change of every account tagged with a Category.
  // If an account is tagged "OPERATING" (e.g. Revenue, Expense), its net change contributes to Operating CF.
  // BUT, we need to know if it was settled in CASH.
  //
  // Let's go with the standard "Balance Sheet Approach" for Indirect Method (easier with current data):
  // 1. Net Income (from P&L)
  // 2. + Depreciation (Non-cash expense)
  // 3. - Increase in AR (Operating Asset)
  // 4. + Increase in AP (Operating Liability)
  // ... this requires tagging accounts as "Operating Asset", "Operating Liability".

  // Let's try the Direct Method using the new `cashFlowCategory` on the *AccountCode*.
  // We assume that if `cashFlowCategory` is present, movements in that account represent cash flow of that type *when corresponding to Cash*.
  // Actually, usually you tag the Revenue/Expense accounts.
  //
  // Let's fallback to a simple Logic for now until data is fully tagged:
  // Operating: Net Income
  // Investing: Net change in Fixed Assets
  // Financing: Net change in Long Term Liabilities + Equity

  const accounts = await prisma.accountCode.findMany({
    where: { isActive: true },
  });

  const balances = await prisma.journalEntry.groupBy({
    by: ['accountId'],
    where: {
      unitId,
      date: { gte: startDate, lte: endDate },
    },
    _sum: { debit: true, credit: true },
  });

  const movements = new Map<string, number>();
  balances.forEach((b) => {
    movements.set(b.accountId, (b._sum.debit?.toNumber() || 0) - (b._sum.credit?.toNumber() || 0));
  });

  let operatingTotal = 0;
  const operatingItems: any[] = [];

  let investingTotal = 0;
  const investingItems: any[] = [];

  let financingTotal = 0;
  const financingItems: any[] = [];

  // Calculate Net Income first for Operating Base
  let netIncome = 0;

  for (const acc of accounts) {
    const movement = movements.get(acc.id) || 0;
    if (movement === 0) continue;

    // Logic for categorization
    if (acc.type === AccountType.REVENUE || acc.type === AccountType.EXPENSE) {
      // Revenue (Credit normal) -> negative net debit; Expense (Debit) -> positive.
      // Net Income contribution = -movement.
      netIncome -= movement;
    }
  }

  operatingItems.push({ name: 'Laba Bersih (Net Income)', amount: netIncome });
  operatingTotal += netIncome;

  // Map movements based on explicit CashFlowCategory, with a heuristic
  // depreciation add-back as fallback (indirect method).
  for (const acc of accounts) {
    const movement = movements.get(acc.id) || 0;
    if (movement === 0) continue;

    if (acc.cashFlowCategory === CashFlowCategory.OPERATING) {
      // Working-capital adjustments (e.g. AR/AP changes) — only balance-sheet
      // accounts; revenue/expense movements are already inside Net Income.
      if (acc.type !== AccountType.REVENUE && acc.type !== AccountType.EXPENSE) {
        // Decrease in assets (Credit/-) = cash inflow (+);
        // increase in liabilities (Credit/-) = cash inflow (+).
        operatingItems.push({ name: acc.name, amount: -movement });
        operatingTotal -= movement;
      }
    } else if (acc.cashFlowCategory === CashFlowCategory.INVESTING) {
      // Asset purchase (Debit/+) = cash outflow (-).
      investingItems.push({ name: acc.name, amount: -movement });
      investingTotal -= movement;
    } else if (acc.cashFlowCategory === CashFlowCategory.FINANCING) {
      // Loan receipt (Credit/-) = cash inflow (+).
      financingItems.push({ name: acc.name, amount: -movement });
      financingTotal -= movement;
    } else if (
      acc.name.toLowerCase().includes('penyusutan') ||
      acc.name.toLowerCase().includes('depreciation')
    ) {
      // Non-cash expense (Debit/+) was subtracted in Net Income — add it back.
      operatingItems.push({ name: `Penyesuaian: ${acc.name}`, amount: movement });
      operatingTotal += movement;
    }
  }

  // Calculate Cash Balances
  // Find all accounts with type ASSET and name containing "Kas" or "Bank" (heuristic) or specific code range
  const cashAccounts = accounts.filter(
    (a) =>
      a.type === AccountType.ASSET &&
      (a.name.toLowerCase().includes('kas') || a.name.toLowerCase().includes('bank'))
  );

  const cashIds = cashAccounts.map((a) => a.id);

  // Beginning Cash
  const beginningAgg = await prisma.journalEntry.aggregate({
    where: {
      unitId,
      accountId: { in: cashIds },
      date: { lt: startDate },
    },
    _sum: { debit: true, credit: true },
  });
  const beginningCash =
    (beginningAgg._sum.debit?.toNumber() || 0) - (beginningAgg._sum.credit?.toNumber() || 0);

  const netChange = operatingTotal + investingTotal + financingTotal;
  const endingCash = beginningCash + netChange;

  return {
    period: { startDate: formatDate(startDate), endDate: formatDate(endDate) },
    operatingActivities: {
      title: 'Aktivitas Operasional',
      total: operatingTotal,
      items: operatingItems,
    },
    investingActivities: {
      title: 'Aktivitas Investasi',
      total: investingTotal,
      items: investingItems,
    },
    financingActivities: {
      title: 'Aktivitas Pendanaan',
      total: financingTotal,
      items: financingItems,
    },
    netChangeInCash: netChange,
    beginningCashBalance: beginningCash,
    endingCashBalance: endingCash,
  };
}

// Budget Realization Report
export async function getBudgetRealizationReport(unitId: string, academicYearId: string) {
  const academicYear = await prisma.academicYear.findUnique({
    where: { id: academicYearId },
  });

  if (!academicYear) throw new Error('Academic Year not found');

  // 1. Get all Budgets for the Unit & Year
  const budgets = await prisma.budget.findMany({
    where: { unitId, academicYearId },
    include: { account: true },
  });

  const start = academicYear.startDate;
  const end = academicYear.endDate;

  // 2. Get Actuals from Journals
  const accountIds = budgets.map((b) => b.accountId);

  const actuals = await prisma.journalEntry.groupBy({
    by: ['accountId'],
    where: {
      unitId,
      accountId: { in: accountIds },
      date: { gte: start, lte: end },
    },
    _sum: { debit: true, credit: true },
  });

  const actualMap = new Map<string, { debit: number; credit: number }>();
  actuals.forEach((a) => {
    const debit = a._sum.debit?.toNumber() || 0;
    const credit = a._sum.credit?.toNumber() || 0;
    actualMap.set(a.accountId, { debit, credit });
  });

  const items = budgets.map((b) => {
    const act = actualMap.get(b.accountId) || { debit: 0, credit: 0 };
    let actualAmount = 0;

    // Adjust sign based on account type
    if (b.account.type === AccountType.EXPENSE || b.account.type === AccountType.ASSET) {
      actualAmount = act.debit - act.credit;
    } else {
      actualAmount = act.credit - act.debit;
    }

    const budgetAmount = b.amount.toNumber();
    const variance = budgetAmount - actualAmount;
    const percentage = budgetAmount !== 0 ? (actualAmount / budgetAmount) * 100 : 0;

    return {
      accountId: b.accountId,
      code: b.account.code,
      name: b.account.name,
      budgetAmount,
      actualAmount,
      variance,
      percentage,
    };
  });

  const totals = items.reduce(
    (acc, item) => ({
      budget: acc.budget + item.budgetAmount,
      actual: acc.actual + item.actualAmount,
      variance: acc.variance + item.variance,
    }),
    { budget: 0, actual: 0, variance: 0 }
  );

  return {
    totals: {
      ...totals,
      percentage: totals.budget !== 0 ? (totals.actual / totals.budget) * 100 : 0,
    },
    items,
  };
}

export async function getCashFlowForecast(unitId: string, months: number = 6) {
  const now = new Date();
  // Use end-of-day on the last day of the final month so that items with a
  // non-midnight timestamp on that day aren't silently dropped by `<=` comparisons.
  const endDate = new Date(now.getFullYear(), now.getMonth() + months, 0, 23, 59, 59, 999);

  // 1. Get current cash balance
  // Identify cash/bank accounts using both the standard Indonesian COA code
  // prefix `1-1` (consistent with `procurement/[id]/fulfill-dialog.tsx`) and a
  // name-based heuristic as a fallback. The previous implementation relied on
  // name matches alone, which silently produced a zero `initialBalance` for
  // institutions that name accounts in English (e.g. "Cash") or use other
  // localized terms — that wrong baseline then propagates through every
  // forecast month as a running total.
  const cashAccounts = await prisma.accountCode.findMany({
    where: {
      isActive: true,
      type: AccountType.ASSET,
      OR: [
        { code: { startsWith: '1-1' } },
        { name: { contains: 'kas', mode: 'insensitive' } },
        { name: { contains: 'bank', mode: 'insensitive' } },
        { name: { contains: 'cash', mode: 'insensitive' } },
      ],
    },
  });
  const cashAccountIds = cashAccounts.map((a) => a.id);

  const currentBalanceAgg = await prisma.journalEntry.aggregate({
    where: { unitId, accountId: { in: cashAccountIds }, date: { lte: now } },
    _sum: { debit: true, credit: true },
  });
  const initialBalance =
    (currentBalanceAgg._sum.debit?.toNumber() || 0) -
    (currentBalanceAgg._sum.credit?.toNumber() || 0);

  // 2. Project Income (Pending/Partial Invoices by Due Date)
  // No lower bound: overdue receivables are real expected income and should
  // not be silently excluded. They are bucketed into the first forecast month
  // (mirroring the overdue PR backlog behavior below).
  const pendingInvoices = await prisma.invoice.findMany({
    where: {
      student: { unitId },
      status: { in: ['PENDING', 'PARTIAL'] },
      dueDate: { lte: endDate },
    },
    select: { dueDate: true, amount: true, paidAmount: true },
  });

  // 3. Project Expenses (Approved PRs and remaining Budgets)
  const approvedPRs = await prisma.purchaseRequest.findMany({
    where: {
      unitId,
      status: 'APPROVED',
      date: { lte: endDate },
    },
    select: { date: true, totalEstimated: true },
  });

  // Aggregate monthly
  const forecastData: any[] = [];
  let runningBalance = initialBalance;

  for (let i = 0; i < months; i++) {
    const monthDate = new Date(now.getFullYear(), now.getMonth() + i, 1);
    // End-of-day on the last day of the month so items dated mid-day on that
    // day are correctly bucketed into this month rather than dropped entirely.
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + i + 1, 0, 23, 59, 59, 999);
    const monthLabel = monthDate.toLocaleString('default', { month: 'short', year: '2-digit' });

    // Symmetric to the expense backlog: in the first month, include all
    // overdue receivables (dueDate < monthDate) so they aren't dropped.
    const monthIncome = pendingInvoices
      .filter((inv) =>
        i === 0 ? inv.dueDate <= monthEnd : inv.dueDate >= monthDate && inv.dueDate <= monthEnd
      )
      .reduce((sum, inv) => sum + (inv.amount.toNumber() - inv.paidAmount.toNumber()), 0);

    // For the first month, include all past approved-but-unfulfilled PRs
    // (overdue backlog) so they don't disappear from the forecast.
    const monthExpense = approvedPRs
      .filter((pr) => (i === 0 ? pr.date <= monthEnd : pr.date >= monthDate && pr.date <= monthEnd))
      .reduce((sum, pr) => sum + pr.totalEstimated.toNumber(), 0);

    const netFlow = monthIncome - monthExpense;
    runningBalance += netFlow;

    forecastData.push({
      month: monthLabel,
      income: monthIncome,
      expense: monthExpense,
      netFlow,
      balance: runningBalance,
    });
  }

  return {
    initialBalance,
    forecast: forecastData,
  };
}
