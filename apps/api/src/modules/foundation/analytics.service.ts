import { prisma } from '../../lib/prisma';
import { wibMonthYear, wibMonthRange } from '../../utils/wib-day';
import {
  FoundationExecutiveSummary,
  FoundationFinancialOverview,
  FoundationUnitComparison,
} from '@cipansor/shared';
import { STUDENT_STATUS } from '@cipansor/shared';

/**
 * Get executive summary statistics for the foundation
 * Includes total counts and growth metrics
 */
export async function getExecutiveSummary(): Promise<FoundationExecutiveSummary> {
  // Count active students
  const totalStudents = await prisma.student.count({
    where: { status: STUDENT_STATUS.ACTIVE },
  });

  // Count teachers via role assignments (roles containing GURU)
  const totalTeachers = await prisma.userRoleAssignment.count({
    where: {
      role: {
        code: { in: ['TKQ_GURU', 'SDIT_GURU', 'SMPIT_GURU', 'SMAQ_GURU', 'MUSYRIF'] },
      },
      isActive: true,
    },
  });

  // Count staff via role assignments (admin/tata usaha roles)
  const totalStaff = await prisma.userRoleAssignment.count({
    where: {
      role: {
        code: { in: ['TKQ_TATA_USAHA', 'SDIT_TATA_USAHA', 'SMPIT_TATA_USAHA', 'SMAQ_TATA_USAHA'] },
      },
      isActive: true,
    },
  });

  // Count units
  const totalUnits = await prisma.unit.count();

  // Count registrants still active in the admissions pipeline
  // (i.e. not yet enrolled, rejected, or cancelled).
  const activeAdmissions = await prisma.registrant.count({
    where: {
      status: {
        in: ['REGISTERED', 'DOCUMENT_CHECK', 'TEST_SCHEDULED', 'TEST_COMPLETED', 'ACCEPTED'],
      },
    },
  });

  // Calculate growth based on students created in the last month
  const oneMonthAgo = new Date();
  oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

  const studentsLastMonth = await prisma.student.count({
    where: {
      status: STUDENT_STATUS.ACTIVE,
      createdAt: { lt: oneMonthAgo },
    },
  });

  const growth =
    studentsLastMonth > 0 ? ((totalStudents - studentsLastMonth) / studentsLastMonth) * 100 : 0;

  return {
    totalStudents,
    totalTeachers,
    totalStaff,
    totalUnits,
    activeAdmissions,
    growth: {
      students: Number(growth.toFixed(1)),
    },
  };
}

/**
 * Get financial overview including current/last month comparison
 * and breakdown by unit
 */
export async function getFinancialOverview(): Promise<FoundationFinancialOverview> {
  const now = new Date();
  // The month windows are WIB calendar months, not the server's: the container
  // runs UTC, and a `JournalEntry.date` is a real instant, so bounding it at
  // midnight UTC (`new Date(y, m, 0)`) dropped the whole last day of the month
  // and the first hours of the 1st (00:00–07:00 WIB, stored the previous UTC
  // day). `wibMonthRange` closes both ends on the WIB clock.
  const { year, month } = wibMonthYear(now);
  const { start: startOfMonth, end: endOfMonth } = wibMonthRange(year, month);
  const lastMonth = month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 };
  const { start: startOfLastMonth, end: endOfLastMonth } = wibMonthRange(
    lastMonth.year,
    lastMonth.month
  );

  // Helper to get totals from journal entries
  const getTotals = async (start: Date, end: Date) => {
    // Revenue (Credit balance on Revenue accounts - code starting with '4')
    const revenue = await prisma.journalEntry.aggregate({
      _sum: { credit: true },
      where: {
        date: { gte: start, lte: end },
        account: { code: { startsWith: '4' } },
      },
    });

    // Expense (Debit balance on Expense accounts - code starting with '5')
    const expense = await prisma.journalEntry.aggregate({
      _sum: { debit: true },
      where: {
        date: { gte: start, lte: end },
        account: { code: { startsWith: '5' } },
      },
    });

    return {
      revenue: Number(revenue._sum.credit || 0),
      expense: Number(expense._sum.debit || 0),
      net: Number(revenue._sum.credit || 0) - Number(expense._sum.debit || 0),
    };
  };

  const [current, last] = await Promise.all([
    getTotals(startOfMonth, endOfMonth),
    getTotals(startOfLastMonth, endOfLastMonth),
  ]);

  // Get all units for breakdown
  const units = await prisma.unit.findMany({
    select: { id: true, name: true },
  });

  // Real per-unit revenue/expense from journal entries scoped to each unit.
  const [revenueByUnit, expenseByUnit, studentsByUnit] = await Promise.all([
    prisma.journalEntry.groupBy({
      by: ['unitId'],
      _sum: { credit: true },
      where: {
        date: { gte: startOfMonth, lte: endOfMonth },
        account: { code: { startsWith: '4' } },
      },
    }),
    prisma.journalEntry.groupBy({
      by: ['unitId'],
      _sum: { debit: true },
      where: {
        date: { gte: startOfMonth, lte: endOfMonth },
        account: { code: { startsWith: '5' } },
      },
    }),
    prisma.student.groupBy({
      by: ['unitId'],
      _count: { _all: true },
      where: { status: STUDENT_STATUS.ACTIVE },
    }),
  ]);

  const revenueMap = new Map(revenueByUnit.map((r) => [r.unitId, Number(r._sum.credit || 0)]));
  const expenseMap = new Map(expenseByUnit.map((e) => [e.unitId, Number(e._sum.debit || 0)]));
  const studentMap = new Map(studentsByUnit.map((s) => [s.unitId, s._count._all]));

  const byUnit = units.map((u) => ({
    unitId: u.id,
    unitName: u.name,
    revenue: revenueMap.get(u.id) || 0,
    expense: expenseMap.get(u.id) || 0,
  }));

  const unitsWithNetIncome = byUnit.map((u) => ({
    ...u,
    netIncome: u.revenue - u.expense,
    students: studentMap.get(u.unitId) || 0,
  }));

  // Cash position from balance-sheet accounts (all-time balances):
  // Cash (11xx), Receivables (12xx) — debit-normal; Payables (2xx) — credit-normal.
  const balanceFor = async (codePrefix: string, normal: 'debit' | 'credit') => {
    const agg = await prisma.journalEntry.aggregate({
      _sum: { debit: true, credit: true },
      where: { account: { code: { startsWith: codePrefix } } },
    });
    const debit = Number(agg._sum.debit || 0);
    const credit = Number(agg._sum.credit || 0);
    return normal === 'debit' ? debit - credit : credit - debit;
  };

  const [cashOnHand, receivables, payables] = await Promise.all([
    balanceFor('11', 'debit'),
    balanceFor('12', 'debit'),
    balanceFor('2', 'credit'),
  ]);

  // Revenue/expense for the trailing 6 months (oldest first). Each window is a
  // WIB calendar month, the same bounds the current-month totals use.
  const monthlyTrend = await Promise.all(
    Array.from({ length: 6 }, (_, i) => 5 - i).map(async (back) => {
      const monthIndex = month - back;
      const mYear = year + Math.floor(monthIndex / 12);
      const mMonth = ((monthIndex % 12) + 12) % 12;
      const { start: mStart, end: mEnd } = wibMonthRange(mYear, mMonth);
      const totals = await getTotals(mStart, mEnd);
      return {
        month: mStart.toLocaleString('id-ID', { month: 'short', timeZone: 'Asia/Jakarta' }),
        revenue: totals.revenue,
        expense: totals.expense,
      };
    })
  );

  // Get expense composition by account for pie chart
  const expensesByAccount = await prisma.journalEntry.groupBy({
    by: ['accountId'],
    _sum: { debit: true },
    where: {
      date: { gte: startOfMonth, lte: endOfMonth },
      account: { code: { startsWith: '5' } },
    },
    orderBy: { _sum: { debit: 'desc' } },
    take: 6,
  });

  const accountIds = expensesByAccount.map((e) => e.accountId);
  const accounts = await prisma.accountCode.findMany({
    where: { id: { in: accountIds } },
    select: { id: true, name: true },
  });

  const expenseComposition = expensesByAccount.map((e) => {
    const account = accounts.find((a) => a.id === e.accountId);
    return {
      name: account?.name || 'Lainnya',
      value: Number(e._sum.debit || 0),
    };
  });

  return {
    currentMonth: current,
    lastMonth: last,
    byUnit,
    units: unitsWithNetIncome,
    expenseComposition,
    cashPosition: { cashOnHand, receivables, payables },
    monthlyTrend,
  };
}

/**
 * Get comparison metrics for all units
 * Includes student/teacher counts and ratios
 */
export async function getUnitComparison(): Promise<FoundationUnitComparison[]> {
  // Get units with student counts
  const units = await prisma.unit.findMany({
    include: {
      _count: {
        select: {
          students: { where: { status: STUDENT_STATUS.ACTIVE } },
        },
      },
    },
  });

  // Get teacher counts by unit via role assignments
  const teachersByUnit = await prisma.userRoleAssignment.groupBy({
    by: ['unitId'],
    _count: { _all: true },
    where: {
      role: {
        code: { in: ['TKQ_GURU', 'SDIT_GURU', 'SMPIT_GURU', 'SMAQ_GURU', 'MUSYRIF'] },
      },
      isActive: true,
      unitId: { not: null },
    },
  });

  return units.map((u) => {
    const teacherData = teachersByUnit.find((t) => t.unitId === u.id);
    const teacherCount = teacherData?._count?._all || 0;
    const studentCount = u._count.students;

    return {
      unitId: u.id,
      unitName: u.name,
      studentCount,
      teacherCount,
      studentTeacherRatio: teacherCount > 0 ? Number((studentCount / teacherCount).toFixed(1)) : 0,
      averageGrade: 0, // Placeholder - requires complex grade aggregation
    };
  });
}
