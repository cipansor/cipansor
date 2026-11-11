import { prisma } from '../../lib/prisma';
import { Prisma } from '@prisma/client';
import { CreateFinancialPeriodInput } from '@cipansor/shared';
import { Errors } from '../../middleware/error';
import { actorReachesUnit, writeUnitScopeFor, type UnitActor } from '../../utils/resolve-unit-id';

type TransactionClient = Prisma.TransactionClient;

export async function createFinancialPeriod(data: CreateFinancialPeriodInput, actor: UnitActor) {
  const { name, startDate, endDate, notes } = data;
  // A unit admin is pinned to its own unit whatever the body says; a foundation
  // role names one.
  const unitId = writeUnitScopeFor(actor, data.unitId);

  // Check overlap
  const overlap = await prisma.financialPeriod.findFirst({
    where: {
      unitId,
      OR: [{ startDate: { lte: new Date(endDate) }, endDate: { gte: new Date(startDate) } }],
    },
  });

  if (overlap) {
    throw new Error('Financial period overlaps with an existing period');
  }

  return prisma.financialPeriod.create({
    data: {
      unit: { connect: { id: unitId } },
      name,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      notes,
    },
  });
}

export async function closePeriod(id: string, closedById: string, actor: UnitActor) {
  // The period's unit must be one the account reaches; 404 otherwise.
  const period = await prisma.financialPeriod.findUnique({
    where: { id },
    select: { unitId: true },
  });
  if (!period || !actorReachesUnit(actor, period.unitId)) throw Errors.notFound('Financial period');

  return prisma.financialPeriod.update({
    where: { id },
    data: {
      isClosed: true,
      closedAt: new Date(),
      closedBy: { connect: { id: closedById } },
    },
  });
}

export async function reopenPeriod(id: string) {
  return prisma.financialPeriod.update({
    where: { id },
    data: {
      isClosed: false,
      closedAt: null,
      closedById: null,
    },
  });
}

export async function getFinancialPeriods(query: {
  unitId?: string;
  page?: number;
  limit?: number;
}) {
  const { unitId, page = 1, limit = 20 } = query;
  const skip = (page - 1) * limit;

  const where = {
    ...(unitId && { unitId }),
  };

  const [data, total] = await Promise.all([
    prisma.financialPeriod.findMany({
      where,
      include: { closedBy: { select: { id: true, name: true } } },
      orderBy: { startDate: 'desc' },
      skip,
      take: limit,
    }),
    prisma.financialPeriod.count({ where }),
  ]);

  return {
    data,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function checkPeriodStatus(unitId: string, date: Date) {
  const period = await prisma.financialPeriod.findFirst({
    where: {
      unitId,
      startDate: { lte: date },
      endDate: { gte: date },
    },
  });

  if (period && period.isClosed) {
    throw new Error(`Financial period for ${date.toISOString()} is closed.`);
  }
}

/**
 * Non-throwing variant of checkPeriodStatus.
 * Returns true if journal entries may be posted for this date/unit, false if
 * the enclosing financial period is closed.
 *
 * Use this when the caller performs a business transaction (e.g. a canteen
 * sale or refund) whose success should NOT be blocked by period closure —
 * only the associated accounting entries should be skipped.
 *
 * Accepts an optional transaction client so the period check participates
 * in the caller's transaction, eliminating the TOCTOU window where a period
 * could be closed between the check and the journal insert.
 */
export async function isPeriodOpen(
  unitId: string,
  date: Date,
  tx: TransactionClient | typeof prisma = prisma
): Promise<boolean> {
  const period = await tx.financialPeriod.findFirst({
    where: {
      unitId,
      startDate: { lte: date },
      endDate: { gte: date },
    },
    select: { isClosed: true },
  });

  // No matching period → treat as open (no closure enforced).
  return !period || !period.isClosed;
}
