import { prisma } from '../../lib/prisma';
import { Prisma } from '@prisma/client';
import { CreateBudgetInput, UpdateBudgetInput } from '@cipansor/shared';
import { Errors } from '../../middleware/error';
import {
  actorReachesUnit,
  isFoundationScopedRole,
  writeUnitScopeFor,
  type UnitActor,
} from '../../utils/resolve-unit-id';

export async function createBudget(
  data: CreateBudgetInput & { createdById: string },
  actor: UnitActor
) {
  const { academicYearId, accountId, amount, periodType, notes, createdById } = data;
  // The budget belongs to a unit the account may write: a unit admin is pinned
  // to its own whatever the body says, a foundation role names one.
  const unitId = writeUnitScopeFor(actor, data.unitId);

  // The account must belong to the budget's unit. `AccountCode.unitId` is
  // nullable for legacy/shared rows, so a null account is allowed; one pinned
  // to a *different* unit is refused. Without this a unit admin could budget
  // against another unit's account and read its code and name back from the
  // list.
  const account = await prisma.accountCode.findUnique({
    where: { id: accountId },
    select: { unitId: true },
  });
  if (!account) throw Errors.badRequest('Akun tidak ditemukan');
  if (account.unitId && account.unitId !== unitId) {
    throw Errors.badRequest('Akun ini milik unit lain');
  }

  // Check if budget already exists
  const existing = await prisma.budget.findUnique({
    where: {
      unitId_academicYearId_accountId: {
        unitId,
        academicYearId,
        accountId,
      },
    },
  });

  if (existing) {
    throw new Error('Budget for this account and academic year already exists');
  }

  return prisma.budget.create({
    data: {
      unit: { connect: { id: unitId } },
      academicYear: { connect: { id: academicYearId } },
      account: { connect: { id: accountId } },
      amount: new Prisma.Decimal(amount),
      periodType: periodType || 'YEARLY',
      notes,
      createdBy: { connect: { id: createdById } },
    },
    include: {
      account: true,
      academicYear: { select: { id: true, name: true } },
    },
  });
}

export async function updateBudget(id: string, data: UpdateBudgetInput, actor: UnitActor) {
  const { amount, periodType, notes } = data;

  // The row's unit must be one the account reaches; 404 otherwise, as for an id
  // that does not exist. The write path used to update by id alone.
  const existing = await prisma.budget.findUnique({ where: { id }, select: { unitId: true } });
  if (!existing || !actorReachesUnit(actor, existing.unitId)) throw Errors.notFound('Budget');

  return prisma.budget.update({
    where: { id },
    data: {
      ...(amount !== undefined && { amount: new Prisma.Decimal(amount) }),
      ...(periodType && { periodType }),
      ...(notes !== undefined && { notes }),
    },
    include: {
      account: true,
      academicYear: { select: { id: true, name: true } },
    },
  });
}

export async function getBudgets(
  query: {
    unitId?: string;
    academicYearId?: string;
    page?: number;
    limit?: number;
  },
  actor: UnitActor
) {
  const { unitId, academicYearId, page = 1, limit = 20 } = query;
  const skip = (page - 1) * limit;

  // A unit admin reads only its own unit whatever the query says; a foundation
  // role names one (or none, for every unit). The read path used to take the
  // query's unitId verbatim, so any unit admin could read another unit's budget.
  const scopedUnitId = isFoundationScopedRole(actor.roleCode) ? unitId : actor.unitId;
  if (!isFoundationScopedRole(actor.roleCode) && !scopedUnitId) {
    throw Errors.forbidden('Akun ini tidak terikat pada unit mana pun');
  }

  const where: Prisma.BudgetWhereInput = {
    ...(scopedUnitId && { unitId: scopedUnitId }),
    ...(academicYearId && { academicYearId }),
  };

  const [data, total] = await Promise.all([
    prisma.budget.findMany({
      where,
      include: {
        account: true,
        academicYear: { select: { id: true, name: true, startDate: true, endDate: true } },
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: { account: { code: 'asc' } },
      skip,
      take: limit,
    }),
    prisma.budget.count({ where }),
  ]);

  const result = data.map((budget) => ({
    ...budget,
    amount: budget.amount.toNumber(),
    usedAmount: budget.usedAmount.toNumber(),
  }));

  return {
    data: result,
    meta: { pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } },
  };
}

export async function deleteBudget(id: string, actor: UnitActor) {
  // The row's unit must be one the account reaches; 404 otherwise.
  const budget = await prisma.budget.findUnique({ where: { id }, select: { unitId: true } });
  if (!budget || !actorReachesUnit(actor, budget.unitId)) throw Errors.notFound('Budget');

  // Check for Purchase Request dependencies first
  const purchaseRequestCount = await prisma.purchaseRequestItem.count({
    where: { budgetId: id },
  });

  if (purchaseRequestCount > 0) {
    throw new Error('Cannot delete budget referenced by Purchase Requests');
  }

  // Use atomic delete with condition to prevent race condition
  const result = await prisma.budget.deleteMany({
    where: {
      id,
      usedAmount: { equals: 0 },
    },
  });

  if (result.count === 0) {
    throw new Error('Cannot delete budget with existing usage');
  }

  return { success: true };
}

export async function recalculateBudgetUsage(
  unitId: string,
  academicYearId: string,
  actor: UnitActor
) {
  if (!actorReachesUnit(actor, unitId)) throw Errors.notFound('Unit');

  // 1. Get Academic Year dates
  const academicYear = await prisma.academicYear.findUnique({
    where: { id: academicYearId },
  });
  if (!academicYear) throw new Error('Academic Year not found');

  // 2. Get all budgets
  const budgets = await prisma.budget.findMany({
    where: { unitId, academicYearId },
    include: { account: true },
  });

  if (budgets.length === 0) return { count: 0 };

  // 3. Aggregate Journal Entries efficiently
  const aggregates = await prisma.journalEntry.groupBy({
    by: ['accountId'],
    where: {
      unitId,
      date: {
        gte: academicYear.startDate,
        lte: academicYear.endDate,
      },
      accountId: { in: budgets.map((b) => b.accountId) },
    },
    _sum: {
      debit: true,
      credit: true,
    },
  });

  // 4. Map aggregates for lookup
  const usageMap = new Map();
  aggregates.forEach((agg) => {
    usageMap.set(agg.accountId, {
      debit: agg._sum.debit?.toNumber() || 0,
      credit: agg._sum.credit?.toNumber() || 0,
    });
  });

  // 5. Create Update Operations
  const updates = budgets.map((budget) => {
    const usage = usageMap.get(budget.accountId) || { debit: 0, credit: 0 };
    let usedAmount = 0;

    // Check normal balance to decide direction
    if (budget.account.normalBalance === 'CREDIT') {
      usedAmount = usage.credit - usage.debit;
    } else {
      usedAmount = usage.debit - usage.credit;
    }

    usedAmount = Math.max(0, usedAmount);

    return prisma.budget.update({
      where: { id: budget.id },
      data: { usedAmount: new Prisma.Decimal(usedAmount) },
    });
  });

  if (updates.length > 0) {
    await prisma.$transaction(updates);

    // After recalculating, check for alerts to trigger notifications
    void triggerBudgetAlerts(unitId, academicYearId);
  }

  return { count: updates.length };
}

/**
 * Internal logic to trigger real-time notifications for budget thresholds
 */
async function triggerBudgetAlerts(unitId: string, academicYearId: string) {
  try {
    const alerts = await getBudgetUtilizationAlerts(unitId, academicYearId);
    const criticalAlerts = alerts.filter((a) => a.status !== 'NORMAL');

    if (criticalAlerts.length === 0) return;

    // Find treasury roles to notify
    const treasuryUsers = await prisma.user.findMany({
      where: {
        isActive: true,
        userRoles: {
          some: {
            role: {
              code: { in: ['YAYASAN_BENDAHARA', 'SUPER_ADMIN'] },
            },
          },
        },
      },
      select: { id: true },
    });

    await Promise.allSettled(
      treasuryUsers.flatMap((user) =>
        criticalAlerts.map((alert) =>
          prisma.notification.create({
            data: {
              userId: user.id,
              type: 'ALERT',
              title: alert.status === 'EXCEEDED' ? 'Anggaran Terlampaui!' : 'Peringatan Anggaran',
              message: `Akun ${alert.accountCode} (${alert.accountName}) di unit ${alert.unitName} telah mencapai ${alert.percentage}% penggunaan.`,
              link: '/finance/budget',
              status: 'UNREAD',
            },
          })
        )
      )
    );
  } catch (err) {
    console.error('[Budget] Failed to trigger real-time budget alerts:', err);
  }
}

/**
 * Identify budgets that exceed or are close to exceeding their allocated amount.
 * Returns alerts for accounts with usage > 90%.
 *
 * Scopes to a single academic year so historical (already-closed) budgets
 * don't surface as EXCEEDED alerts indefinitely. If no `academicYearId` is
 * provided, falls back to the currently-active academic year. If no AY is
 * active (brief window between two AYs), returns an empty list rather than
 * the cross-year aggregate, mirroring the behaviour of
 * `calculateCashFlowForecast` in `forecast.service.ts`.
 */
export async function getBudgetUtilizationAlerts(unitId?: string, academicYearId?: string) {
  let effectiveAcademicYearId = academicYearId;
  if (!effectiveAcademicYearId) {
    const activeAcademicYear = await prisma.academicYear.findFirst({
      where: { isActive: true },
      select: { id: true },
    });
    if (!activeAcademicYear) return [];
    effectiveAcademicYearId = activeAcademicYear.id;
  }

  const budgets = await prisma.budget.findMany({
    where: {
      academicYearId: effectiveAcademicYearId,
      ...(unitId && { unitId }),
    },
    include: {
      account: { select: { code: true, name: true } },
      unit: { select: { name: true } },
    },
  });

  const alerts = budgets
    .map((b) => {
      const limit = b.amount.toNumber();
      const used = b.usedAmount.toNumber();
      const percentage = limit > 0 ? (used / limit) * 100 : 0;

      return {
        id: b.id,
        unitId: b.unitId,
        unitName: b.unit.name,
        accountCode: b.account.code,
        accountName: b.account.name,
        limit,
        used,
        percentage: Math.round(percentage * 100) / 100,
        status: percentage >= 100 ? 'EXCEEDED' : percentage >= 90 ? 'WARNING' : 'NORMAL',
      };
    })
    .filter((a) => a.status !== 'NORMAL');

  return alerts.sort((a, b) => b.percentage - a.percentage);
}
