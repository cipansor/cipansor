import { prisma } from '../../lib/prisma';
import { ViolationType } from '@prisma/client';
import { CreateViolationDto, UpdateViolationDto, QueryViolationDto } from './violations.schema';
import {
  assertStudentInScope,
  onlyScopedStudents,
  studentScope,
  type ScopeActor,
} from '../../utils/student-scope';
import { STUDENT_SUMMARY_SELECT, withStudentSummary } from '../../utils/student-summary';

/**
 * `studentScope` returns the santri the caller may see; folding it into the
 * `where` keeps one violation row from another unit out of every read — a
 * list, a detail, a per-santri summary or a category aggregate. `studentId`
 * from the request is a filter, never a grant: it is intersected with the
 * scope, so naming another unit's santri yields nothing.
 */
function scopedWhere(actor: ScopeActor, extra: Record<string, unknown> = {}) {
  return { ...onlyScopedStudents(studentScope(actor)), ...extra };
}

export async function createViolation(
  data: CreateViolationDto,
  reportedById: string,
  actor: ScopeActor
) {
  await assertStudentInScope(data.studentId, actor);
  const created = await prisma.violation.create({
    data: {
      ...data,
      occurredAt: new Date(data.occurredAt),
      reportedById,
    } as any,
    include: {
      student: { select: STUDENT_SUMMARY_SELECT },
      reportedBy: { select: { id: true, name: true } },
    },
  });
  return withStudentSummary(created);
}

export async function getViolations(query: QueryViolationDto, actor: ScopeActor) {
  const { studentId, type, category, categoryId, startDate, endDate, page, limit } = query;
  const skip = (page - 1) * limit;

  const where = scopedWhere(actor, {
    ...(studentId && { studentId }),
    ...(type && { type }),
    // `categoryId` is the exact category the type-edit page addresses; `category`
    // stays a free-text contains for the list search box.
    ...(categoryId
      ? { category: { equals: categoryId, mode: 'insensitive' as const } }
      : category
        ? { category: { contains: category, mode: 'insensitive' as const } }
        : {}),
    ...(startDate || endDate
      ? {
          occurredAt: {
            ...(startDate && { gte: new Date(startDate) }),
            ...(endDate && { lte: new Date(endDate) }),
          },
        }
      : {}),
  });

  const [data, total] = await Promise.all([
    prisma.violation.findMany({
      where,
      include: {
        student: { select: STUDENT_SUMMARY_SELECT },
        reportedBy: { select: { id: true, name: true } },
      },
      orderBy: { occurredAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.violation.count({ where }),
  ]);

  return {
    data: data.map(withStudentSummary),
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

export async function getViolationById(id: string, actor: ScopeActor) {
  const row = await prisma.violation.findFirst({
    where: { AND: [{ id }, { student: studentScope(actor) }] },
    include: {
      student: { select: STUDENT_SUMMARY_SELECT },
      reportedBy: { select: { id: true, name: true } },
    },
  });
  return row ? withStudentSummary(row) : null;
}

export async function updateViolation(id: string, data: UpdateViolationDto, actor: ScopeActor) {
  const existing = await getViolationById(id, actor);
  if (!existing) return null;
  const updated = await prisma.violation.update({
    where: { id },
    data: {
      ...data,
      ...(data.occurredAt && { occurredAt: new Date(data.occurredAt) }),
    },
    include: {
      student: { select: STUDENT_SUMMARY_SELECT },
      reportedBy: { select: { id: true, name: true } },
    },
  });
  return withStudentSummary(updated);
}

export async function deleteViolation(id: string, actor: ScopeActor) {
  const existing = await getViolationById(id, actor);
  if (!existing) return false;
  await prisma.violation.delete({ where: { id } });
  return true;
}

export async function getStudentViolationPoints(studentId: string) {
  const result = await prisma.violation.aggregate({
    where: { studentId },
    _sum: { points: true },
  });
  return result._sum.points || 0;
}

export async function getStudentViolationSummary(studentId: string, actor: ScopeActor) {
  await assertStudentInScope(studentId, actor);

  const violations = await prisma.violation.findMany({
    where: { studentId },
    orderBy: { occurredAt: 'desc' },
    take: 10,
  });

  const totalPoints = await getStudentViolationPoints(studentId);

  const byType = await prisma.violation.groupBy({
    by: ['type'],
    where: { studentId },
    _count: true,
  });

  const byCategory = await prisma.violation.groupBy({
    by: ['category'],
    where: { studentId },
    _count: true,
    orderBy: { _count: { category: 'desc' } },
    take: 5,
  });

  return {
    totalPoints,
    recentViolations: violations,
    byType,
    byCategory,
  };
}

/**
 * The violation categories in the caller's scope, each with the points and the
 * severity its rows actually carry.
 *
 * A "violation type" is the free-text `category` column on Violation; severity
 * lives in `type` (MINOR/MODERATE/MAJOR). The list used to return bare category
 * strings, so the web picker invented `points: 0` and `type: MINOR`; every new
 * violation was then recorded as a zero-point minor one whatever the category's
 * existing rows showed. Returning the points and the most common severity keeps
 * the form's default honest, and the API stays the authority: the create route
 * records exactly the `points` and `type` it is sent.
 */
export async function getViolationCategories(actor: ScopeActor) {
  const categories = await prisma.violation.groupBy({
    by: ['category', 'points', 'type'],
    where: onlyScopedStudents(studentScope(actor)),
    _count: true,
    orderBy: { _count: { category: 'desc' } },
  });

  const byCategory = new Map<
    string,
    { id: string; points: number; type: ViolationType; count: number }
  >();
  for (const row of categories) {
    const current = byCategory.get(row.category);
    const count = row._count ?? 0;
    if (!current) {
      // The first row of a category is its largest (points, type) group —
      // `orderBy` is descending by group size — so that group sets the
      // category's default points and severity. Later groups only add to the
      // total; overwriting made the *least* common combination the default, so
      // a category of twenty 10-point MINOR violations and one 0-point MAJOR
      // one seeded new records as 0 points and MAJOR.
      byCategory.set(row.category, {
        id: row.category,
        points: row.points,
        type: row.type,
        count,
      });
    } else {
      current.count += count;
    }
  }

  return [...byCategory.values()]
    .sort((a, b) => b.count - a.count)
    .map(({ id, points, type }) => ({
      id,
      name: id.charAt(0).toUpperCase() + id.slice(1),
      category: id.toUpperCase(),
      points,
      type,
      isActive: true,
    }));
}

/**
 * Mirror of `getRewardCategoryById` for violations: the UI's "violation type"
 * is the free-text `category` column, and `/violations/types/ketertiban/edit`
 * addresses it by that string. Aggregate the matching rows into the shape the
 * edit form reads; null (→ 404) when the category is unused.
 */
export async function getViolationCategoryById(category: string, actor: ScopeActor) {
  const agg = await prisma.violation.aggregate({
    where: {
      ...onlyScopedStudents(studentScope(actor)),
      category: { equals: category, mode: 'insensitive' },
    },
    _count: true,
    _sum: { points: true },
    _max: { points: true },
  });
  if (!agg._count) return null;
  return {
    id: category,
    name: category.charAt(0).toUpperCase() + category.slice(1),
    category: category.toUpperCase(),
    points: agg._max.points ?? 0,
    count: agg._count,
    isActive: true,
  };
}
