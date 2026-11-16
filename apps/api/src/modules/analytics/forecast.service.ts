/**
 * Analytics Forecast Service
 * Provides predictive analytics for enrollment, payments, and other metrics
 */

import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { dayOf, todayWib, wibMonthStart, wibMonthYear } from '@/utils/wib';

const DAY_MS = 24 * 60 * 60 * 1000;

interface ForecastResult {
  currentValue: number;
  predictedValue: number;
  trend: 'up' | 'down' | 'stable';
  trendPercentage: number;
  confidence: number;
  dataPoints: Array<{ date: string; value: number; predicted?: boolean }>;
}

/**
 * Calculate simple moving average for predictions
 */
function calculateMovingAverage(values: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      result.push(values[i]);
    } else {
      const sum = values.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
      result.push(sum / period);
    }
  }
  return result;
}

/**
 * Linear regression for trend prediction
 */
function linearRegression(values: number[]): { slope: number; intercept: number; r2: number } {
  const n = values.length;
  if (n === 0) return { slope: 0, intercept: 0, r2: 0 };

  const xMean = (n - 1) / 2;
  const yMean = values.reduce((a, b) => a + b, 0) / n;

  let numerator = 0;
  let denominator = 0;
  let totalSS = 0;

  for (let i = 0; i < n; i++) {
    numerator += (i - xMean) * (values[i] - yMean);
    denominator += (i - xMean) ** 2;
    totalSS += (values[i] - yMean) ** 2;
  }

  const slope = denominator === 0 ? 0 : numerator / denominator;
  const intercept = yMean - slope * xMean;

  // Calculate R-squared
  let residualSS = 0;
  for (let i = 0; i < n; i++) {
    const predicted = slope * i + intercept;
    residualSS += (values[i] - predicted) ** 2;
  }
  const r2 = totalSS === 0 ? 0 : 1 - residualSS / totalSS;

  return { slope, intercept, r2 };
}

/**
 * Get enrollment forecast for the next 6 months
 */
export async function getEnrollmentForecast(unitId?: string): Promise<ForecastResult> {
  // Get historical enrollment data (last 12 months)
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

  // Conditional fragments must be composed with Prisma.sql / Prisma.empty —
  // nesting prisma.$queryRaw inside another template produces invalid SQL.
  const unitFilter = unitId ? Prisma.sql`AND unit_id = ${unitId}` : Prisma.empty;
  const monthlyEnrollments = await prisma.$queryRaw<Array<{ month: string; count: bigint }>>`
    SELECT
      TO_CHAR(created_at, 'YYYY-MM') as month,
      COUNT(*)::bigint as count
    FROM students
    WHERE created_at >= ${twelveMonthsAgo}
    ${unitFilter}
    GROUP BY TO_CHAR(created_at, 'YYYY-MM')
    ORDER BY month
  `;

  const values = monthlyEnrollments.map((m) => Number(m.count));
  const dataPoints: Array<{ date: string; value: number; predicted?: boolean }> =
    monthlyEnrollments.map((m) => ({
      date: m.month,
      value: Number(m.count),
    }));

  if (values.length < 3) {
    // Not enough data for prediction
    const currentValue = values.length > 0 ? values[values.length - 1] : 0;
    return {
      currentValue,
      predictedValue: currentValue,
      trend: 'stable',
      trendPercentage: 0,
      confidence: 0,
      dataPoints,
    };
  }

  // Calculate linear regression for trend
  const { slope, intercept, r2 } = linearRegression(values);
  const currentValue = values[values.length - 1];

  // Predict next 6 months
  for (let i = 1; i <= 6; i++) {
    const predictedValue = Math.max(0, Math.round(slope * (values.length + i - 1) + intercept));
    const futureDate = new Date();
    futureDate.setMonth(futureDate.getMonth() + i);
    dataPoints.push({
      date: futureDate.toISOString().slice(0, 7),
      value: predictedValue,
      predicted: true,
    });
  }

  const predictedValue = Math.max(0, Math.round(slope * (values.length + 5) + intercept));
  const trendPercentage =
    currentValue === 0 ? 0 : ((predictedValue - currentValue) / currentValue) * 100;

  return {
    currentValue,
    predictedValue,
    trend: slope > 0.5 ? 'up' : slope < -0.5 ? 'down' : 'stable',
    trendPercentage: Math.round(trendPercentage * 100) / 100,
    confidence: Math.round(Math.max(0, r2) * 100),
    dataPoints,
  };
}

/**
 * Get payment collection forecast
 */
export async function getPaymentForecast(unitId?: string): Promise<ForecastResult> {
  // Get historical payment data (last 12 months)
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

  const monthlyPayments = await prisma.$queryRaw<Array<{ month: string; total: bigint }>>`
    SELECT 
      TO_CHAR(paid_at, 'YYYY-MM') as month,
      COALESCE(SUM(amount), 0)::bigint as total
    FROM payments
    WHERE paid_at >= ${twelveMonthsAgo}
    GROUP BY TO_CHAR(paid_at, 'YYYY-MM')
    ORDER BY month
  `;

  const values = monthlyPayments.map((m) => Number(m.total));
  const dataPoints: Array<{ date: string; value: number; predicted?: boolean }> =
    monthlyPayments.map((m) => ({
      date: m.month,
      value: Number(m.total),
    }));

  if (values.length < 3) {
    const currentValue = values.length > 0 ? values[values.length - 1] : 0;
    return {
      currentValue,
      predictedValue: currentValue,
      trend: 'stable',
      trendPercentage: 0,
      confidence: 0,
      dataPoints,
    };
  }

  // Use moving average for smoother prediction
  const smoothedValues = calculateMovingAverage(values, 3);
  const { slope, intercept, r2 } = linearRegression(smoothedValues);
  const currentValue = values[values.length - 1];

  // Predict next 6 months
  for (let i = 1; i <= 6; i++) {
    const predictedValue = Math.max(0, Math.round(slope * (values.length + i - 1) + intercept));
    const futureDate = new Date();
    futureDate.setMonth(futureDate.getMonth() + i);
    dataPoints.push({
      date: futureDate.toISOString().slice(0, 7),
      value: predictedValue,
      predicted: true,
    });
  }

  const predictedValue = Math.max(0, Math.round(slope * (values.length + 5) + intercept));
  const trendPercentage =
    currentValue === 0 ? 0 : ((predictedValue - currentValue) / currentValue) * 100;

  return {
    currentValue,
    predictedValue,
    trend: slope > 1000 ? 'up' : slope < -1000 ? 'down' : 'stable',
    trendPercentage: Math.round(trendPercentage * 100) / 100,
    confidence: Math.round(Math.max(0, r2) * 100),
    dataPoints,
  };
}

/**
 * Get outstanding payment prediction
 */
export async function getOutstandingPaymentPrediction(unitId?: string): Promise<{
  currentOutstanding: number;
  predictedCollection: number;
  collectionRate: number;
  atRiskAmount: number;
  dataPoints: Array<{ category: string; amount: number }>;
}> {
  // Get current outstanding invoices
  const outstandingInvoices = await prisma.invoice.findMany({
    where: {
      status: { in: ['PENDING', 'PARTIAL'] },
      ...(unitId && { student: { unitId } }),
    },
    include: {
      student: {
        select: { id: true },
      },
    },
  });

  const totalOutstanding = outstandingInvoices.reduce(
    (sum, inv) => sum + (Number(inv.amount) - Number(inv.paidAmount)),
    0
  );

  // Calculate historical collection rate
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  const historicalStats = await prisma.invoice.aggregate({
    where: {
      createdAt: { gte: threeMonthsAgo },
      ...(unitId && { student: { unitId } }),
    },
    _sum: { amount: true, paidAmount: true },
  });

  const collectionRate =
    historicalStats._sum.amount && Number(historicalStats._sum.amount) > 0
      ? (Number(historicalStats._sum.paidAmount) / Number(historicalStats._sum.amount)) * 100
      : 75; // Default assumption

  const predictedCollection = Math.round(totalOutstanding * (collectionRate / 100));
  const atRiskAmount = totalOutstanding - predictedCollection;

  // Categorize by age, in whole WIB days from the due day. `Invoice.dueDate`
  // is date-only at midnight UTC, i.e. 07:00 WIB on the day it names; anchoring
  // on `new Date()` made a bill due today tick over mid-morning instead of at
  // the end of its WIB day. `dayOf(todayWib())` is midnight UTC of today's WIB
  // day, so the difference is an exact whole number of days (#1050).
  const today = dayOf(todayWib());
  const categories = {
    'Kurang dari 30 hari': 0,
    '30-60 hari': 0,
    '60-90 hari': 0,
    'Lebih dari 90 hari': 0,
  };

  outstandingInvoices.forEach((inv) => {
    const daysDiff = Math.floor((today.getTime() - new Date(inv.dueDate).getTime()) / DAY_MS);
    const outstanding = Number(inv.amount) - Number(inv.paidAmount);

    if (daysDiff < 30) {
      categories['Kurang dari 30 hari'] += outstanding;
    } else if (daysDiff < 60) {
      categories['30-60 hari'] += outstanding;
    } else if (daysDiff < 90) {
      categories['60-90 hari'] += outstanding;
    } else {
      categories['Lebih dari 90 hari'] += outstanding;
    }
  });

  return {
    currentOutstanding: totalOutstanding,
    predictedCollection,
    collectionRate: Math.round(collectionRate * 100) / 100,
    atRiskAmount,
    dataPoints: Object.entries(categories).map(([category, amount]) => ({ category, amount })),
  };
}

/**
 * Get tahfidz completion forecast
 */
export async function getTahfidzCompletionForecast(unitId?: string): Promise<{
  averageCompletionRate: number;
  projectedHafidz: number;
  currentHafidz: number;
  monthlyProgress: Array<{ month: string; totalAyah: number; students: number }>;
}> {
  // Get monthly tahfidz progress for last 6 months
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  // Scope monthly progress by `unitId` when provided so the aggregate is
  // consistent with `currentHafidz` below (which already filters by unit).
  // Without this the function would mix cross-unit ZIYADAH totals with a
  // unit-scoped hafidz count, producing nonsensical projections for callers
  // who passed a `unitId`. The join goes through `students` because
  // `tahfidz_records` only carries `student_id`.
  const monthlyProgress = unitId
    ? await prisma.$queryRaw<Array<{ month: string; total_ayah: bigint; student_count: bigint }>>`
        SELECT 
          TO_CHAR(tr.recorded_at, 'YYYY-MM') as month,
          COALESCE(SUM(tr.total_ayah), 0)::bigint as total_ayah,
          COUNT(DISTINCT tr.student_id)::bigint as student_count
        FROM tahfidz_records tr
        INNER JOIN students s ON s.id = tr.student_id
        WHERE tr.recorded_at >= ${sixMonthsAgo}
          AND tr.activity_type = 'ZIYADAH'
          AND s.unit_id = ${unitId}
        GROUP BY TO_CHAR(tr.recorded_at, 'YYYY-MM')
        ORDER BY month
      `
    : await prisma.$queryRaw<Array<{ month: string; total_ayah: bigint; student_count: bigint }>>`
        SELECT 
          TO_CHAR(recorded_at, 'YYYY-MM') as month,
          COALESCE(SUM(total_ayah), 0)::bigint as total_ayah,
          COUNT(DISTINCT student_id)::bigint as student_count
        FROM tahfidz_records
        WHERE recorded_at >= ${sixMonthsAgo}
          AND activity_type = 'ZIYADAH'
        GROUP BY TO_CHAR(recorded_at, 'YYYY-MM')
        ORDER BY month
      `;

  // Count current hafidz (students with 30 juz completed)
  const currentHafidz = await prisma.student.count({
    where: {
      tahfidzRecords: {
        some: {
          // Approximate: students with significant total ayah
        },
      },
      ...(unitId && { unitId }),
    },
  });

  // Calculate average completion rate
  const avgAyahPerMonth =
    monthlyProgress.length > 0
      ? monthlyProgress.reduce((sum, m) => sum + Number(m.total_ayah), 0) / monthlyProgress.length
      : 0;

  // Project new hafidz in next 12 months (rough estimate)
  // Assuming 6236 ayah for full Quran
  const projectedHafidz = currentHafidz + Math.floor((avgAyahPerMonth * 12) / 6236);

  return {
    averageCompletionRate: Math.round(avgAyahPerMonth),
    projectedHafidz,
    currentHafidz,
    monthlyProgress: monthlyProgress.map((m) => ({
      month: m.month,
      totalAyah: Number(m.total_ayah),
      students: Number(m.student_count),
    })),
  };
}

/**
 * Project future cash flow for the next 6 months
 * Logic: (Pending Invoices - Outstanding Budgets)
 */
export async function calculateCashFlowForecast(unitId?: string) {
  const months = 6;
  const now = new Date();
  const dataPoints = [];

  const pendingInvoices = await prisma.invoice.findMany({
    where: {
      status: { in: ['PENDING', 'PARTIAL'] },
      ...(unitId && { student: { unitId } }),
    },
    select: { amount: true, paidAmount: true, dueDate: true },
  });

  // Scope budgets to the currently-active academic year. Without this filter
  // the query returns budgets from every historical academic year stored in
  // the DB, so the monthly outflow (`yearlyBudget / 12`) ends up summing
  // multiple years of expense allocations and inflates the projected outflow
  // — consistently producing misleading DEFICIT classifications for units
  // that have run several admission cycles. If no academic year is currently
  // active (edge case during the brief window between two AYs), fall back
  // to no budgets so the forecast simply omits outflow rather than
  // double-counting historical data.
  const activeAcademicYear = await prisma.academicYear.findFirst({
    where: { isActive: true },
    select: { id: true },
  });
  const activeBudgets = activeAcademicYear
    ? await prisma.budget.findMany({
        where: {
          academicYearId: activeAcademicYear.id,
          ...(unitId && { unitId }),
        },
        include: { account: true },
      })
    : [];

  const expenseBudgets = activeBudgets.filter((b) => b.account.type === 'EXPENSE');

  // Aggregate overdue (past-due) outstanding amounts separately so they don't
  // silently fall outside the 6-month forecast window. Without this, an
  // invoice with `dueDate < now` matches no projection month and its
  // outstanding amount disappears from `totalProjectedIncome`, materially
  // under-reporting expected cash for schools with significant arrears.
  // We surface the overdue total under a dedicated `overdue` bucket on the
  // first projection month and on the summary, so consumers can still
  // distinguish "scheduled future income" from "already-overdue receivables".
  //
  // The months are the WIB ones, not the server's: a request at 00:00–07:00 WIB
  // on the 1st is still the previous UTC month, so a UTC window would file the
  // new month's bills as overdue and start the projection a month early. The
  // bound is the stored day (midnight UTC) of the 1st of the current WIB month,
  // which is the form `Invoice.dueDate` holds (#1050).
  const currentMonthStart = wibMonthStart(now);
  const overdueAmount = pendingInvoices
    .filter((inv) => new Date(inv.dueDate) < currentMonthStart)
    .reduce((sum, inv) => sum + (Number(inv.amount) - Number(inv.paidAmount)), 0);

  // Hoist the monthly outflow out of the loop — it doesn't depend on the
  // iteration index and was being recomputed identically `months` times.
  const monthlyOutflow = expenseBudgets.reduce((sum, b) => {
    const yearlyBudget = b.amount.toNumber();
    return sum + yearlyBudget / 12;
  }, 0);

  const { year: baseYear, month: baseMonth } = wibMonthYear(now);
  for (let i = 0; i < months; i++) {
    const monthIndex = baseMonth + i;
    const projectionYear = baseYear + Math.floor(monthIndex / 12);
    const projectionMonth = monthIndex % 12;
    const monthStr = `${projectionYear}-${String(projectionMonth + 1).padStart(2, '0')}`;

    const monthlyIncome = pendingInvoices
      .filter((inv) => {
        const due = wibMonthYear(new Date(inv.dueDate));
        return due.year === projectionYear && due.month === projectionMonth;
      })
      .reduce((sum, inv) => sum + (Number(inv.amount) - Number(inv.paidAmount)), 0);

    // Fold overdue amounts into the FIRST projected month's income so the
    // forecast totals match the actual outstanding receivable position.
    const incomeWithOverdue = i === 0 ? monthlyIncome + overdueAmount : monthlyIncome;

    dataPoints.push({
      month: monthStr,
      income: Math.round(incomeWithOverdue),
      outflow: Math.round(monthlyOutflow),
      net: Math.round(incomeWithOverdue - monthlyOutflow),
      ...(i === 0 ? { overdueIncluded: Math.round(overdueAmount) } : {}),
    });
  }

  const totalIncome = dataPoints.reduce((s, d) => s + d.income, 0);
  const totalOutflow = dataPoints.reduce((s, d) => s + d.outflow, 0);
  const net = totalIncome - totalOutflow;

  return {
    summary: {
      totalProjectedIncome: totalIncome,
      totalProjectedOutflow: totalOutflow,
      overdueAmount: Math.round(overdueAmount),
      netProjection: net,
      // Distinguish exactly-balanced from deficit so a perfectly matched
      // budget isn't mislabelled as a shortfall.
      status: net > 0 ? 'SURPLUS' : net < 0 ? 'DEFICIT' : 'BALANCED',
    },
    dataPoints,
  };
}
