/**
 * Dashboard headline metrics — students, teachers, today's attendance, tahfidz —
 * for the whole yayasan or one unit, cached in Redis for a minute.
 *
 * Read by the dashboard module and by the per-minute history job; event handlers
 * call `invalidateDashboardCache` when the figures they touch change. The web
 * keeps itself fresh by polling (React Query), so nothing here is pushed to a
 * browser. `.claude/memory/decisions/realtime-polling.md` has why, and what a
 * push channel must satisfy if one is ever built.
 *
 * The cache is an optimisation only: when Redis is not connected the figures
 * come straight from the database, and nobody waits for a reconnect.
 */

import type { DashboardMetrics, DashboardAlert } from '@cipansor/shared';
import { STUDENT_STATUS } from '@cipansor/shared';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { redis } from '@/lib/redis';
import { dayOf, todayWib } from '@/utils/wib';

export type { DashboardMetrics, DashboardAlert };

const CACHE_TTL_SECONDS = 60;

export function dashboardCacheKey(unitId?: string): string {
  return unitId ? `metrics:unit:${unitId}` : 'metrics:global';
}

function cacheReady(): boolean {
  return redis.status === 'ready';
}

/**
 * Current dashboard metrics.
 * @param unitId Limit the figures to one unit; omit for the whole yayasan.
 * @param options.fresh Compute from the database even when a cached copy
 *   exists (the result still refreshes the cache). The history job needs this:
 *   it runs every minute against a 60-second cache and would otherwise record
 *   the previous minute's figures again.
 */
export async function getCurrentDashboardMetrics(
  unitId?: string,
  options: { fresh?: boolean } = {}
): Promise<DashboardMetrics> {
  const cacheKey = dashboardCacheKey(unitId);

  if (!options.fresh && cacheReady()) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached) as DashboardMetrics;
    } catch (cacheError) {
      logger.warn('Redis cache read error, falling back to database', { error: cacheError });
    }
  }

  const unitFilter = unitId ? { unitId } : {};
  const studentInUnit = unitId ? { student: { unitId } } : {};

  const totalStudents = await prisma.student.count({ where: unitFilter });
  const activeStudents = await prisma.student.count({
    where: { ...unitFilter, status: STUDENT_STATUS.ACTIVE },
  });
  const totalTeachers = await prisma.teacher.count({ where: unitFilter });

  // `Attendance.date` is a `@db.Date` holding the WIB day, so the day it is
  // compared against is the WIB day too — a local `setHours(0,0,0,0)` on the
  // UTC container yields the previous one until 07:00 WIB.
  const today = dayOf(todayWib());
  const todayAttendance = await prisma.attendance.count({
    where: { date: today, status: 'PRESENT', ...studentInUnit },
  });
  const attendanceRate =
    activeStudents > 0 ? Math.round((todayAttendance / activeStudents) * 100) : 0;

  // Students who completed 30 juz, from the tracking table.
  const totalHafidz = await prisma.hafidzStudent.count({ where: studentInUnit });

  const avgQuality = await prisma.murojaahRecord.aggregate({
    _avg: { qualityScore: true },
    where: {
      createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      ...studentInUnit,
    },
  });

  const metrics: DashboardMetrics = {
    students: { total: totalStudents, active: activeStudents, change: 0 },
    teachers: { total: totalTeachers },
    attendance: { rate: attendanceRate, present: todayAttendance, total: activeStudents },
    tahfidz: {
      totalHafidz,
      avgQuality: Number(avgQuality._avg.qualityScore || 0),
    },
    timestamp: new Date().toISOString(),
  };

  if (cacheReady()) {
    try {
      await redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(metrics));
    } catch (cacheError) {
      logger.warn('Redis cache write error', { error: cacheError });
    }
  }

  return metrics;
}

/**
 * Drop the cached metrics so the next read recomputes them.
 * @param unitId The unit whose figures changed; omit for the yayasan-wide entry.
 */
export async function invalidateDashboardCache(unitId?: string): Promise<void> {
  if (!cacheReady()) return;
  try {
    await redis.del(dashboardCacheKey(unitId));
  } catch (error) {
    logger.error('Error invalidating dashboard cache:', error);
  }
}
