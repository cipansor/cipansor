import { prisma } from '../../lib/prisma';
import { CreateRewardDto, UpdateRewardDto, QueryRewardDto } from './rewards.schema';
import {
  assertStudentInScope,
  onlyScopedStudents,
  studentScope,
  type ScopeActor,
} from '../../utils/student-scope';
import { STUDENT_SUMMARY_SELECT, withStudentSummary } from '../../utils/student-summary';

/**
 * `studentScope` returns the santri the caller may see; folding it into the
 * `where` keeps one reward row from another unit out of every read — a list,
 * a detail, a per-santri summary or a category aggregate. `studentId` from the
 * request is a filter, never a grant: it is intersected with the scope, so
 * naming another unit's santri yields nothing.
 */
function scopedWhere(actor: ScopeActor, extra: Record<string, unknown> = {}) {
  return { ...onlyScopedStudents(studentScope(actor)), ...extra };
}

export async function createReward(data: CreateRewardDto, givenById: string, actor: ScopeActor) {
  await assertStudentInScope(data.studentId, actor);
  const created = await prisma.reward.create({
    data: {
      ...data,
      givenAt: data.givenAt ? new Date(data.givenAt) : new Date(),
      givenById,
    } as any,
    include: {
      student: { select: STUDENT_SUMMARY_SELECT },
      givenBy: { select: { id: true, name: true } },
    },
  });
  return withStudentSummary(created);
}

export async function getRewards(query: QueryRewardDto, actor: ScopeActor) {
  const { studentId, category, categoryId, startDate, endDate, page, limit } = query;
  const skip = (page - 1) * limit;

  const where = scopedWhere(actor, {
    ...(studentId && { studentId }),
    // `categoryId` is the exact category the type-edit page addresses; `category`
    // stays a free-text contains for the list search box.
    ...(categoryId
      ? { category: { equals: categoryId, mode: 'insensitive' as const } }
      : category
        ? { category: { contains: category, mode: 'insensitive' as const } }
        : {}),
    ...(startDate || endDate
      ? {
          givenAt: {
            ...(startDate && { gte: new Date(startDate) }),
            ...(endDate && { lte: new Date(endDate) }),
          },
        }
      : {}),
  });

  const [data, total] = await Promise.all([
    prisma.reward.findMany({
      where,
      include: {
        student: { select: STUDENT_SUMMARY_SELECT },
        givenBy: { select: { id: true, name: true } },
      },
      orderBy: { givenAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.reward.count({ where }),
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

export async function getRewardById(id: string, actor: ScopeActor) {
  const row = await prisma.reward.findFirst({
    where: { AND: [{ id }, { student: studentScope(actor) }] },
    include: {
      student: { select: STUDENT_SUMMARY_SELECT },
      givenBy: { select: { id: true, name: true } },
    },
  });
  return row ? withStudentSummary(row) : null;
}

export async function updateReward(id: string, data: UpdateRewardDto, actor: ScopeActor) {
  const existing = await getRewardById(id, actor);
  if (!existing) return null;
  const updated = await prisma.reward.update({
    where: { id },
    data: {
      ...data,
      ...(data.givenAt && { givenAt: new Date(data.givenAt) }),
    },
    include: {
      student: { select: STUDENT_SUMMARY_SELECT },
      givenBy: { select: { id: true, name: true } },
    },
  });
  return withStudentSummary(updated);
}

export async function deleteReward(id: string, actor: ScopeActor) {
  const existing = await getRewardById(id, actor);
  if (!existing) return false;
  await prisma.reward.delete({ where: { id } });
  return true;
}

export async function getStudentRewardPoints(studentId: string) {
  const result = await prisma.reward.aggregate({
    where: { studentId },
    _sum: { points: true },
  });
  return result._sum.points || 0;
}

export async function getStudentRewardSummary(studentId: string, actor: ScopeActor) {
  await assertStudentInScope(studentId, actor);

  const rewards = await prisma.reward.findMany({
    where: { studentId },
    orderBy: { givenAt: 'desc' },
    take: 10,
  });

  const totalPoints = await getStudentRewardPoints(studentId);

  const byCategory = await prisma.reward.groupBy({
    by: ['category'],
    where: { studentId },
    _count: true,
    _sum: { points: true },
    orderBy: { _count: { category: 'desc' } },
  });

  return {
    totalPoints,
    recentRewards: rewards,
    byCategory,
  };
}

export async function getStudentPointBalance(studentId: string, actor: ScopeActor) {
  await assertStudentInScope(studentId, actor);

  const [rewardPoints, violationPoints] = await Promise.all([
    prisma.reward.aggregate({
      where: { studentId },
      _sum: { points: true },
    }),
    prisma.violation.aggregate({
      where: { studentId },
      _sum: { points: true },
    }),
  ]);

  const earned = rewardPoints._sum.points || 0;
  const deducted = violationPoints._sum.points || 0;

  return {
    earned,
    deducted,
    balance: earned - deducted,
  };
}

/**
 * The reward categories in the caller's scope, each with the points its rows
 * actually carry.
 *
 * There is no RewardType table — a "type" is the free-text `category` column on
 * Reward. The list used to return the bare category strings, so the web picker
 * had nothing to read and invented `points: 0`; every new reward then scored
 * zero no matter what the existing rows said. Returning the points the category
 * already has (its most common value) keeps the form's default honest, and the
 * API stays the authority: the create route still records whatever `points` it
 * is sent.
 */
export async function getRewardCategories(actor: ScopeActor) {
  const categories = await prisma.reward.groupBy({
    by: ['category', 'points'],
    where: onlyScopedStudents(studentScope(actor)),
    _count: true,
    orderBy: { _count: { category: 'desc' } },
  });

  // groupBy yields one row per (category, points); reduce to one entry per
  // category. The first row of a category is its largest (points) group —
  // `orderBy` is descending by group size — so that group's points is the
  // category's default. Later groups only add to the total: overwriting the
  // points with each later group made the *least* common value the default, so
  // a category of twenty 10-point rewards and one 0-point reward handed new
  // rewards 0 points.
  const byCategory = new Map<string, { id: string; points: number; count: number }>();
  for (const row of categories) {
    const current = byCategory.get(row.category);
    const count = row._count ?? 0;
    if (!current) {
      byCategory.set(row.category, { id: row.category, points: row.points, count });
    } else {
      current.count += count;
    }
  }

  return [...byCategory.values()]
    .sort((a, b) => b.count - a.count)
    .map(({ id, points }) => ({
      id,
      name: id.charAt(0).toUpperCase() + id.slice(1),
      category: id.toUpperCase(),
      points,
      isActive: true,
    }));
}

/**
 * The UI addresses a "reward type" by the free-text `category` string
 * (`/rewards/types/tahfidz/edit`), but there is no RewardType table — the
 * category is just a column on Reward. Aggregate the rows carrying that
 * category into the `{id, name, category, points}` shape the edit form reads,
 * so the detail-by-id route answers instead of 404ing. Returns null when no
 * reward uses the category, which the controller turns into a 404.
 */
export async function getRewardCategoryById(category: string, actor: ScopeActor) {
  const agg = await prisma.reward.aggregate({
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

export async function getTopStudentsByPoints(actor: ScopeActor, limit = 10) {
  // Always at least the caller's own scope, so a unit role's leaderboard is
  // its own unit even without `?unitId=`; a foundation role sees every unit.
  const where = onlyScopedStudents(studentScope(actor));

  const rewards = await prisma.reward.groupBy({
    by: ['studentId'],
    where,
    _sum: { points: true },
    orderBy: { _sum: { points: 'desc' } },
    take: limit,
  });

  const studentIds = rewards.map((r) => r.studentId);

  const students = await prisma.student.findMany({
    where: { id: { in: studentIds } },
    select: {
      id: true,
      nis: true,
      nisn: true,
      unitId: true,
      user: { select: { id: true, name: true, email: true } },
      unit: { select: { id: true, name: true } },
    },
  });

  return rewards.map((r) => ({
    student: students.find((s) => s.id === r.studentId),
    points: r._sum.points || 0,
  }));
}
