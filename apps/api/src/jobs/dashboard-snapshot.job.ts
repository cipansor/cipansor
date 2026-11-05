import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { dashboardService } from '@/modules/dashboard-enhancement/dashboard.service';
import { dayOf, todayWib } from '@/utils/wib';
import { Prisma } from '@prisma/client';

/**
 * Dashboard Snapshot Job
 * Creates daily metric snapshots for each unit
 */

// Type for metric types
type MetricType =
  | 'STUDENT_COUNT'
  | 'ATTENDANCE_RATE'
  | 'TAHFIDZ_PROGRESS'
  | 'MUROJAAH_PROGRESS'
  | 'SIMAAN_RESULT'
  | 'TEACHER_COUNT'
  | 'CLASS_COUNT'
  | 'CUSTOM';

const CHUNK_SIZE = 5;

/**
 * Create daily metric snapshots for all units
 */
export async function createDailySnapshots(): Promise<void> {
  const jobName = 'createDailySnapshots';
  const startTime = Date.now();
  logger.info(`[${jobName}] Starting daily metric snapshot job`);

  try {
    // Get all units (no isActive field in schema, use deletedAt)
    const units = await prisma.unit.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
    });

    // Get current academic year (field is isActive, not isCurrent)
    const academicYear = await prisma.academicYear.findFirst({
      where: { isActive: true, deletedAt: null },
      select: { id: true },
    });

    if (!academicYear) {
      logger.warn(`[${jobName}] No active academic year found, skipping snapshot`);
      return;
    }

    // The job runs at 01:00 WIB (18:00 UTC the day before), so the UTC day is
    // a day behind: stamp the WIB calendar day the snapshot represents.
    const today = dayOf(todayWib());

    let successCount = 0;
    let errorCount = 0;

    // Process units in chunks to manage database load
    for (let i = 0; i < units.length; i += CHUNK_SIZE) {
      const chunk = units.slice(i, i + CHUNK_SIZE);

      await Promise.all(
        chunk.map(async (unit) => {
          try {
            // Get overview data for this unit
            const overview = await dashboardService.getOverview({ unitId: unit.id });

            // Create snapshots for different metrics
            const metricsToSnapshot: Array<{
              type: MetricType;
              value: number;
              data: Record<string, unknown>;
            }> = [
              {
                type: 'STUDENT_COUNT',
                value: overview.students.total,
                data: {
                  active: overview.students.active,
                  inactive: overview.students.inactive,
                },
              },
              {
                type: 'ATTENDANCE_RATE',
                value: overview.attendance.rate,
                data: {
                  total: overview.attendance.total,
                  present: overview.attendance.present,
                },
              },
              {
                type: 'TAHFIDZ_PROGRESS',
                value: overview.tahfidz.avgScore,
                data: {
                  totalRecords: overview.tahfidz.totalRecords,
                  totalAyah: overview.tahfidz.totalAyah,
                },
              },
              {
                type: 'MUROJAAH_PROGRESS',
                value: overview.murojaah.avgQuality,
                data: {
                  totalRecords: overview.murojaah.totalRecords,
                  totalPages: overview.murojaah.totalPages,
                },
              },
              {
                type: 'SIMAAN_RESULT',
                value: overview.simaan.passRate,
                data: {
                  totalExams: overview.simaan.totalExams,
                  passedExams: overview.simaan.passedExams,
                },
              },
              {
                type: 'TEACHER_COUNT',
                value: overview.teachers.total,
                data: {},
              },
              {
                type: 'CLASS_COUNT',
                value: overview.classes.total,
                data: {},
              },
            ];

            // Create snapshots using upsert to avoid duplicates
            await Promise.all(
              metricsToSnapshot.map((metric) =>
                prisma.dashboardMetricSnapshot.upsert({
                  where: {
                    unitId_metricType_periodType_periodDate: {
                      unitId: unit.id,
                      metricType: metric.type,
                      periodDate: today,
                      periodType: 'DAILY',
                    },
                  },
                  update: {
                    metricValue: metric.value,
                    metricData: metric.data as Prisma.JsonObject,
                  },
                  create: {
                    unitId: unit.id,
                    academicYearId: academicYear.id,
                    metricType: metric.type,
                    metricValue: metric.value,
                    metricData: metric.data as Prisma.JsonObject,
                    periodType: 'DAILY',
                    periodDate: today,
                  },
                })
              )
            );

            successCount++;
            logger.debug(`[${jobName}] Created snapshots for unit: ${unit.name}`);
          } catch (unitError) {
            errorCount++;
            logger.error(`[${jobName}] Error creating snapshots for unit ${unit.name}:`, unitError);
          }
        })
      );
    }

    const duration = Date.now() - startTime;
    logger.info(
      `[${jobName}] Daily snapshot job completed in ${duration}ms: ${successCount} success, ${errorCount} errors`
    );
  } catch (error) {
    logger.error(`[${jobName}] Fatal error in daily snapshot job:`, error);
    throw error;
  }
}

/**
 * Create weekly summary snapshots (aggregates from daily snapshots)
 */
export async function createWeeklySummary(): Promise<void> {
  const jobName = 'createWeeklySummary';
  logger.info(`[${jobName}] Starting weekly summary job`);

  try {
    const units = await prisma.unit.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
    });

    const academicYear = await prisma.academicYear.findFirst({
      where: { isActive: true, deletedAt: null },
      select: { id: true },
    });

    if (!academicYear) {
      logger.warn(`[${jobName}] No active academic year found`);
      return;
    }

    // Calculate week start (Monday)
    const today = new Date();
    const dayOfWeek = today.getDay();
    const diff = today.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
    const weekStart = new Date(today.setDate(diff));
    weekStart.setHours(0, 0, 0, 0);

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    let successCount = 0;
    let errorCount = 0;

    const processUnit = async (unit: { id: string; name: string }) => {
      // Get daily snapshots for this week
      const dailySnapshots = await prisma.dashboardMetricSnapshot.findMany({
        where: {
          unitId: unit.id,
          academicYearId: academicYear.id,
          periodType: 'DAILY',
          periodDate: {
            gte: weekStart,
            lte: weekEnd,
          },
        },
      });

      // Group by metric type and calculate averages
      const metricGroups = dailySnapshots.reduce(
        (acc, snapshot) => {
          const type = snapshot.metricType;
          if (!acc[type]) {
            acc[type] = [];
          }
          acc[type].push(snapshot.metricValue);
          return acc;
        },
        {} as Record<string, number[]>
      );

      // Create weekly summaries for all metric types of a unit concurrently
      const upsertPromises = Object.entries(metricGroups).map(([metricType, values]) => {
        const avgValue = values.reduce((sum, v) => sum + v, 0) / values.length;

        return prisma.dashboardMetricSnapshot.upsert({
          where: {
            unitId_metricType_periodType_periodDate: {
              unitId: unit.id,
              metricType,
              periodDate: weekStart,
              periodType: 'WEEKLY',
            },
          },
          update: {
            metricValue: avgValue,
            metricData: {
              dataPoints: values.length,
              min: Math.min(...values),
              max: Math.max(...values),
              values,
            },
          },
          create: {
            unitId: unit.id,
            academicYearId: academicYear.id,
            metricType,
            metricValue: avgValue,
            metricData: {
              dataPoints: values.length,
              min: Math.min(...values),
              max: Math.max(...values),
              values,
            },
            periodType: 'WEEKLY',
            periodDate: weekStart,
          },
        });
      });
      await Promise.all(upsertPromises);
    };

    const results = await Promise.allSettled(units.map((unit) => processUnit(unit)));

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        logger.debug(`[${jobName}] Created weekly summary for unit: ${units[index].name}`);
        successCount++;
      } else {
        logger.error(
          `[${jobName}] Error creating weekly summary for unit ${units[index].name}:`,
          result.reason
        );
        errorCount++;
      }
    });

    logger.info(
      `[${jobName}] Weekly summary job completed: ${successCount} success, ${errorCount} errors`
    );
  } catch (error) {
    logger.error(`[${jobName}] Fatal error in weekly summary job:`, error);
    throw error;
  }
}

/**
 * Clean up old snapshots (keep last 365 days)
 */
export async function cleanupOldSnapshots(): Promise<void> {
  const jobName = 'cleanupOldSnapshots';
  logger.info(`[${jobName}] Starting cleanup job`);

  try {
    // Cleanup old snapshots (365 days)
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 365);

    const result = await prisma.dashboardMetricSnapshot.deleteMany({
      where: {
        periodDate: {
          lt: cutoffDate,
        },
      },
    });

    logger.info(`[${jobName}] Deleted ${result.count} old snapshots`);

    // Cleanup high-frequency history (keep last 24 hours)
    const historyCutoff = new Date();
    historyCutoff.setHours(historyCutoff.getHours() - 24);

    const historyResult = await prisma.dashboardHistory.deleteMany({
      where: {
        createdAt: {
          lt: historyCutoff,
        },
      },
    });

    logger.info(`[${jobName}] Deleted ${historyResult.count} old history records`);
  } catch (error) {
    logger.error(`[${jobName}] Error cleaning up old snapshots:`, error);
    throw error;
  }
}
