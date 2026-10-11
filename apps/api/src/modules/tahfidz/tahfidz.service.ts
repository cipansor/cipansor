import { prisma } from '@/lib/prisma';
import { STUDENT_SAFE_SELECT, studentScope, type ScopeActor } from '@/utils/student-scope';
import { certificateVerificationUrl } from '@/utils/verification-url';
import { logger } from '@/lib/logger';
import { Errors } from '@/middleware/error';
import { UserRole, TahfidzActivityType, Prisma } from '@prisma/client';
import { eventBus } from '@/lib/event-bus';
import type { ListTahfidzQuery, GenerateCertificateInput } from './tahfidz.schema';
import type {
  CreateTahfidzInput,
  UpdateTahfidzInput,
  TahfidzStudentSummary,
  TahfidzDashboardStats,
  TahfidzRecord,
} from '@cipansor/shared';

/** Total ayah in the Qur'an (Kufi count), the tahfidz completion target. */
const TOTAL_QURAN_AYAH = 6236;

/** How far back to look when measuring a student's memorization pace. */
export const COMPLETION_PACE_WINDOW_DAYS = 90;

export interface TahfidzCompletionEstimate {
  status: 'COMPLETED' | 'INSUFFICIENT_DATA' | 'PROJECTED';
  totalAyahMemorized: number;
  remainingAyah: number;
  /** Observed ayah/day over the pace window; null unless PROJECTED. */
  ayahPerDay: number | null;
  estimatedDays: number | null;
  estimatedDate: Date | null;
  recordsInWindow: number;
}

/**
 * Estimate when a student will finish all 30 juz, extrapolating the pace
 * actually observed in the recent window (total ayah setoran divided by the
 * days elapsed since the first record in the window). Requires at least 3
 * ziyadah records in the window — fewer yields INSUFFICIENT_DATA rather than
 * a made-up projection.
 */
export function calculateCompletionEstimate(
  totalAyahMemorized: number,
  windowRecords: { recordedAt: Date; totalAyah: number }[],
  now: Date = new Date()
): TahfidzCompletionEstimate {
  const remainingAyah = Math.max(0, TOTAL_QURAN_AYAH - totalAyahMemorized);

  if (remainingAyah === 0) {
    return {
      status: 'COMPLETED',
      totalAyahMemorized,
      remainingAyah: 0,
      ayahPerDay: null,
      estimatedDays: 0,
      estimatedDate: now,
      recordsInWindow: windowRecords.length,
    };
  }

  if (windowRecords.length < 3) {
    return {
      status: 'INSUFFICIENT_DATA',
      totalAyahMemorized,
      remainingAyah,
      ayahPerDay: null,
      estimatedDays: null,
      estimatedDate: null,
      recordsInWindow: windowRecords.length,
    };
  }

  const firstRecordedAt = windowRecords[0].recordedAt;
  const daysSpanned = Math.max(
    1,
    Math.ceil((now.getTime() - firstRecordedAt.getTime()) / (1000 * 60 * 60 * 24))
  );
  const ayahInWindow = windowRecords.reduce((sum, r) => sum + r.totalAyah, 0);
  const ayahPerDay = ayahInWindow / daysSpanned;

  if (ayahPerDay <= 0) {
    return {
      status: 'INSUFFICIENT_DATA',
      totalAyahMemorized,
      remainingAyah,
      ayahPerDay: null,
      estimatedDays: null,
      estimatedDate: null,
      recordsInWindow: windowRecords.length,
    };
  }

  const estimatedDays = Math.ceil(remainingAyah / ayahPerDay);
  const estimatedDate = new Date(now);
  estimatedDate.setDate(estimatedDate.getDate() + estimatedDays);

  return {
    status: 'PROJECTED',
    totalAyahMemorized,
    remainingAyah,
    ayahPerDay: Math.round(ayahPerDay * 10) / 10,
    estimatedDays,
    estimatedDate,
    recordsInWindow: windowRecords.length,
  };
}

export class TahfidzService {
  /**
   * Get tahfidz records with pagination
   */
  async findAll(query: ListTahfidzQuery, currentUser: ScopeActor) {
    const { page, limit, studentId, activityType, startDate, endDate, surah } = query;
    const skip = (page - 1) * limit;

    // A muhafidz teaches santri from every academic unit that boards, so
    // pinning them to their own unitId silently hid the SD IT santri they
    // teach; studentScope() gives them (and the yayasan board) every unit. A
    // santri sees their own setoran and a wali their children's — filtering by
    // unit alone gave a santri 5,089 rows of the whole school.
    const where: Prisma.TahfidzRecordWhereInput = { student: studentScope(currentUser) };

    if (studentId) {
      where.studentId = studentId;
    }

    if (activityType) {
      where.activityType = activityType as TahfidzActivityType;
    }

    if (surah) {
      where.surahName = { contains: surah, mode: 'insensitive' };
    }

    // Date filtering
    if (startDate && endDate) {
      where.recordedAt = {
        gte: new Date(startDate),
        lte: new Date(endDate),
      };
    }

    const [records, total] = await Promise.all([
      prisma.tahfidzRecord.findMany({
        where,
        skip,
        take: limit,
        orderBy: { recordedAt: 'desc' },
        include: {
          student: {
            select: { ...STUDENT_SAFE_SELECT, unit: { select: { id: true, name: true } } },
          },
          recordedBy: {
            select: { id: true, name: true },
          },
        },
      }),
      prisma.tahfidzRecord.count({ where }),
    ]);

    return {
      records,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get tahfidz record by ID
   */
  async findById(id: string, currentUser: ScopeActor) {
    const record = await prisma.tahfidzRecord.findFirst({
      where: { id, student: studentScope(currentUser) },
      include: {
        student: {
          select: { ...STUDENT_SAFE_SELECT, unit: { select: { id: true, name: true } } },
        },
        recordedBy: { select: { id: true, name: true } },
      },
    });

    if (!record) {
      throw Errors.notFound('Tahfidz record');
    }

    return record;
  }

  /**
   * Create tahfidz record
   */
  async create(input: CreateTahfidzInput, recordedById: string) {
    // Verify student exists
    const student = await prisma.student.findFirst({
      where: { id: input.studentId, deletedAt: null },
    });

    if (!student) {
      throw Errors.notFound('Student');
    }

    // Calculate total ayah if not provided
    const totalAyah = input.totalAyah || input.ayahEnd - input.ayahStart + 1;

    const record = await prisma.tahfidzRecord.create({
      data: {
        studentId: input.studentId,
        activityType: input.activityType as TahfidzActivityType,
        surahNumber: input.surahNumber,
        surahName: input.surahName,
        ayahStart: input.ayahStart,
        ayahEnd: input.ayahEnd,
        juz: input.juz,
        totalAyah,
        score: input.score,
        notes: input.notes,
        audioUrl: input.audioUrl,
        recordedAt: input.recordedAt || new Date(),
        recordedById,
      },
      include: {
        student: {
          include: {
            user: { select: { id: true, name: true } },
            unit: { select: { id: true, name: true } },
          },
        },
      },
    });

    // Emit event for cross-module integration
    eventBus.emit('tahfidz:created', {
      id: record.id,
      studentId: record.studentId,
      studentName: record.student.user?.name || 'Unknown',
      unitId: record.student.unitId,
      unitName: record.student.unit?.name || '',
      activityType: record.activityType as 'ZIYADAH' | 'MUROJAAH' | 'TASMI',
      surahName: record.surahName,
      surahNumber: record.surahNumber,
      ayahStart: record.ayahStart,
      ayahEnd: record.ayahEnd,
      totalAyah: record.totalAyah,
      juz: record.juz || undefined,
      score: record.score || undefined,
      recordedById,
      recordedAt: record.recordedAt,
    });

    // Check if student became Hafidz
    this.checkAndRegisterHafidz(input.studentId).catch((err) => {
      // Log error but don't fail the request
      logger.error('Error checking hafidz status:', err);
    });

    return record;
  }

  /**
   * Update tahfidz record
   */
  async update(id: string, input: UpdateTahfidzInput) {
    const record = await prisma.tahfidzRecord.findUnique({
      where: { id },
    });

    if (!record) {
      throw Errors.notFound('Tahfidz record');
    }

    // Recalculate total ayah if ayah range changed
    let totalAyah = input.totalAyah;
    if (input.ayahStart !== undefined || input.ayahEnd !== undefined) {
      const ayahStart = input.ayahStart ?? record.ayahStart;
      const ayahEnd = input.ayahEnd ?? record.ayahEnd;
      totalAyah = totalAyah ?? ayahEnd - ayahStart + 1;
    }

    const updated = await prisma.tahfidzRecord.update({
      where: { id },
      data: {
        activityType: input.activityType as TahfidzActivityType | undefined,
        surahNumber: input.surahNumber,
        surahName: input.surahName,
        ayahStart: input.ayahStart,
        ayahEnd: input.ayahEnd,
        juz: input.juz,
        totalAyah,
        score: input.score,
        notes: input.notes,
      },
      include: {
        student: {
          include: {
            user: { select: { id: true, name: true } },
          },
        },
      },
    });

    // Check if student became Hafidz
    this.checkAndRegisterHafidz(updated.studentId).catch((err) => {
      logger.error('Error checking hafidz status:', err);
    });

    return updated;
  }

  /**
   * Delete tahfidz record
   */
  async delete(id: string) {
    const record = await prisma.tahfidzRecord.findUnique({
      where: { id },
    });

    if (!record) {
      throw Errors.notFound('Tahfidz record');
    }

    await prisma.tahfidzRecord.delete({
      where: { id },
    });

    return { message: 'Tahfidz record deleted' };
  }

  /**
   * Get student tahfidz summary/progress
   * Optimized with Promise.all for parallel execution
   */
  async getStudentSummary(studentId: string, currentUser: ScopeActor) {
    const student = await prisma.student.findFirst({
      where: { AND: [{ id: studentId, deletedAt: null }, studentScope(currentUser)] },
      include: {
        user: { select: { id: true, name: true } },
        unit: { select: { id: true, name: true } },
      },
    });

    if (!student) {
      throw Errors.notFound('Student');
    }

    const paceWindowStart = new Date();
    paceWindowStart.setDate(paceWindowStart.getDate() - COMPLETION_PACE_WINDOW_DAYS);

    const [
      activityCounts,
      totalRecords,
      totalAyahZiyadah,
      juzCovered,
      surahCovered,
      avgScore,
      recentRecords,
      paceRecords,
    ] = await Promise.all([
      // 1. Get activity type counts
      prisma.tahfidzRecord.groupBy({
        by: ['activityType'],
        where: { studentId },
        _count: { _all: true },
        _sum: { totalAyah: true },
      }),
      // 2. Get total records
      prisma.tahfidzRecord.count({
        where: { studentId },
      }),
      // 3. Get total ayah memorized (ziyadah only)
      prisma.tahfidzRecord.aggregate({
        where: { studentId, activityType: 'ZIYADAH' },
        _sum: { totalAyah: true },
      }),
      // 4. Get unique juz covered
      prisma.tahfidzRecord.findMany({
        where: { studentId },
        select: { juz: true },
        distinct: ['juz'],
      }),
      // 5. Get unique surah covered
      prisma.tahfidzRecord.findMany({
        where: { studentId },
        select: { surahNumber: true, surahName: true },
        distinct: ['surahNumber'],
      }),
      // 6. Get average score from assessments
      prisma.tahfidzRecord.aggregate({
        where: { studentId, activityType: 'ASSESSMENT', score: { not: null } },
        _avg: { score: true },
      }),
      // 7. Get recent records
      prisma.tahfidzRecord.findMany({
        where: { studentId },
        orderBy: { recordedAt: 'desc' },
        take: 5,
        include: {
          recordedBy: { select: { id: true, name: true } },
        },
      }),
      // 8. Ziyadah records inside the pace window, for completion estimation
      prisma.tahfidzRecord.findMany({
        where: {
          studentId,
          activityType: 'ZIYADAH',
          recordedAt: { gte: paceWindowStart },
        },
        select: { recordedAt: true, totalAyah: true },
        orderBy: { recordedAt: 'asc' },
      }),
    ]);

    return {
      student,
      summary: {
        totalRecords,
        totalAyahMemorized: totalAyahZiyadah._sum?.totalAyah || 0,
        juzCoveredCount: juzCovered.length,
        surahCoveredCount: surahCovered.length,
        averageScore: avgScore._avg?.score ? Number(avgScore._avg.score.toFixed(1)) : null,
      },
      byActivity: activityCounts.map((ac) => ({
        type: ac.activityType,
        count: ac._count._all,
        totalAyah: ac._sum?.totalAyah || 0,
      })),
      juzCovered: juzCovered.map((j) => j.juz).sort((a, b) => a - b),
      surahCovered: surahCovered.sort((a, b) => a.surahNumber - b.surahNumber),
      recentRecords,
      estimation: calculateCompletionEstimate(totalAyahZiyadah._sum?.totalAyah || 0, paceRecords),
    };
  }

  /**
   * Get tahfidz dashboard stats for visualization
   */
  async getDashboardStats(params: {
    unitId?: string;
    year?: number;
    month?: number;
  }): Promise<TahfidzDashboardStats & { recentRecords: any[] }> {
    const { unitId, year, month } = params;
    const currentYear = year || new Date().getFullYear();

    // Date range for the entire year
    const startOfYear = new Date(currentYear, 0, 1);
    const endOfYear = new Date(currentYear, 11, 31, 23, 59, 59);

    // Build Prisma where clause for standard queries
    const where: Prisma.TahfidzRecordWhereInput = {};
    if (unitId) {
      where.student = { unitId };
    }
    where.recordedAt = {
      gte: startOfYear,
      lte: endOfYear,
    };
    if (month !== undefined && month >= 0 && month <= 11) {
      where.recordedAt = {
        gte: new Date(currentYear, month, 1),
        lte: new Date(currentYear, month + 1, 0, 23, 59, 59),
      };
    }

    // --- Optimized Aggregations ---

    // 1. Total records and unique students
    const [totalRecords, uniqueStudents] = await Promise.all([
      prisma.tahfidzRecord.count({ where }),
      prisma.tahfidzRecord.findMany({
        where,
        select: { studentId: true },
        distinct: ['studentId'],
      }),
    ]);

    // 2. Records by activity type
    const recordsByType = await prisma.tahfidzRecord.groupBy({
      by: ['activityType'],
      where,
      _count: { _all: true },
    });

    // 3. Monthly Activity (Optimized using Raw SQL)
    // We filter by year and unitId if provided.
    // NOTE: 'tahfidz_records' is the mapped table name.
    const monthlyActivityRaw = await prisma.$queryRaw<
      Array<{ month: number; type: string; count: bigint }>
    >`
      SELECT
        CAST(EXTRACT(MONTH FROM tr.recorded_at) AS INTEGER) as month,
        tr.activity_type as type,
        COUNT(*)::bigint as count
      FROM tahfidz_records tr
      ${unitId ? Prisma.sql`JOIN students s ON tr.student_id = s.id` : Prisma.empty}
      WHERE tr.recorded_at >= ${startOfYear} AND tr.recorded_at <= ${endOfYear}
      ${unitId ? Prisma.sql`AND s.unit_id = ${unitId}` : Prisma.empty}
      GROUP BY EXTRACT(MONTH FROM tr.recorded_at), tr.activity_type
      ORDER BY month
    `;

    // Process raw results into the expected format
    const monthNames = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    const monthlyActivity = monthNames.map((name, index) => {
      const monthNum = index + 1;
      const records = monthlyActivityRaw.filter((r) => r.month === monthNum);
      const getCount = (type: string) => Number(records.find((r) => r.type === type)?.count || 0);

      return {
        month: name,
        setoran: getCount('ZIYADAH'),
        murajaah: getCount('MUROJAAH'),
        tasmi: getCount('TASMI') + getCount('ASSESSMENT'), // Count both TASMI and ASSESSMENT
      };
    });

    // 4. Progress by Juz (Optimized using Raw SQL)
    // We count distinct students per juz and those who passed assessment for that juz
    const progressByJuzRaw = await prisma.$queryRaw<
      Array<{ juz: number; student_count: bigint; completed_count: bigint }>
    >`
      SELECT
        tr.juz,
        COUNT(DISTINCT tr.student_id)::bigint as student_count,
        COUNT(DISTINCT CASE
          WHEN tr.activity_type IN ('ASSESSMENT', 'TASMI') AND tr.score >= 60
          THEN tr.student_id
        END)::bigint as completed_count
      FROM tahfidz_records tr
      ${unitId ? Prisma.sql`JOIN students s ON tr.student_id = s.id` : Prisma.empty}
      WHERE tr.recorded_at >= ${startOfYear} AND tr.recorded_at <= ${endOfYear}
      ${unitId ? Prisma.sql`AND s.unit_id = ${unitId}` : Prisma.empty}
      ${
        month !== undefined
          ? Prisma.sql`AND tr.recorded_at >= ${new Date(currentYear, month, 1)} AND tr.recorded_at <= ${new Date(currentYear, month + 1, 0, 23, 59, 59)}`
          : Prisma.empty
      }
      GROUP BY tr.juz
      ORDER BY tr.juz
    `;

    const progressByJuz = Array.from({ length: 30 }, (_, i) => {
      const juz = i + 1;
      const record = progressByJuzRaw.find((r) => r.juz === juz);
      return {
        juz,
        studentCount: Number(record?.student_count || 0),
        completedCount: Number(record?.completed_count || 0),
      };
    });

    // 5. Records by Grade (Optimized using Raw SQL)
    // Based on score: >=90 Mumtaz, >=80 Jayyid Jiddan, >=70 Jayyid, >=60 Maqbul, <60 Rasib
    const recordsByGradeRaw = await prisma.$queryRaw<Array<{ grade: string; count: bigint }>>`
      SELECT
        CASE
          WHEN score >= 90 THEN 'MUMTAZ'
          WHEN score >= 80 THEN 'JAYYID_JIDDAN'
          WHEN score >= 70 THEN 'JAYYID'
          WHEN score >= 60 THEN 'MAQBUL'
          ELSE 'RASIB'
        END as grade,
        COUNT(*)::bigint as count
      FROM tahfidz_records tr
      ${unitId ? Prisma.sql`JOIN students s ON tr.student_id = s.id` : Prisma.empty}
      WHERE tr.score IS NOT NULL
      AND tr.recorded_at >= ${startOfYear} AND tr.recorded_at <= ${endOfYear}
      ${unitId ? Prisma.sql`AND s.unit_id = ${unitId}` : Prisma.empty}
      ${
        month !== undefined
          ? Prisma.sql`AND tr.recorded_at >= ${new Date(currentYear, month, 1)} AND tr.recorded_at <= ${new Date(currentYear, month + 1, 0, 23, 59, 59)}`
          : Prisma.empty
      }
      GROUP BY grade
    `;

    const recordsByGrade = recordsByGradeRaw.map((r) => ({
      grade: r.grade,
      count: Number(r.count),
    }));

    // 6. Top students
    const topStudentsData = await prisma.tahfidzRecord.groupBy({
      by: ['studentId'],
      where: {
        ...(unitId && { student: { unitId } }),
        activityType: 'ZIYADAH',
        recordedAt: { gte: startOfYear, lte: endOfYear },
      },
      _sum: { totalAyah: true },
      orderBy: { _sum: { totalAyah: 'desc' } },
      take: 10,
    });

    const topStudentIds = topStudentsData.map((s) => s.studentId);

    // Fetch details and juz counts in bulk to avoid N+1
    const [topStudentDetails, allJuzCounts] = await Promise.all([
      prisma.student.findMany({
        where: { id: { in: topStudentIds } },
        select: { id: true, nis: true, user: { select: { name: true } } },
      }),
      prisma.tahfidzRecord.groupBy({
        by: ['studentId', 'juz'],
        where: { studentId: { in: topStudentIds } },
        _count: { juz: true }, // Just to satisfy groupBy, we only need the groups
      }),
    ]);

    // Map the results
    const topStudentsWithJuz = topStudentsData.map((ts) => {
      const studentDetail = topStudentDetails.find((s) => s.id === ts.studentId);
      // Filter juz counts for this student
      const studentJuzCounts = allJuzCounts.filter((j) => j.studentId === ts.studentId);

      return {
        studentId: ts.studentId,
        studentName: studentDetail?.user?.name || '-',
        nis: studentDetail?.nis || '-',
        totalAyah: ts._sum.totalAyah || 0,
        completedJuz: studentJuzCounts.length,
      };
    });

    // 7. Recent records
    const recentRecords = await prisma.tahfidzRecord.findMany({
      where: unitId ? { student: { unitId } } : {},
      orderBy: { recordedAt: 'desc' },
      take: 10,
      include: {
        student: {
          select: { ...STUDENT_SAFE_SELECT, unit: { select: { id: true, name: true } } },
        },
        recordedBy: { select: { id: true, name: true } },
      },
    });

    return {
      totalRecords,
      totalStudents: uniqueStudents.length,
      recordsByType: recordsByType.map((r) => ({
        type: r.activityType,
        count: r._count._all,
      })),
      recordsByGrade,
      progressByJuz,
      monthlyActivity,
      topStudents: topStudentsWithJuz,
      recentRecords: recentRecords as unknown as TahfidzRecord[],
    };
  }

  /**
   * Generate or retrieve certificate
   */
  async generateCertificate(input: GenerateCertificateInput, createdById: string) {
    const { studentId, certificateType, issueDate = new Date() } = input;
    const date = new Date(issueDate);

    // Check if certificate already exists
    const existing = await prisma.digitalCertificate.findFirst({
      where: {
        studentId,
        certificateType,
      },
      include: {
        student: true,
      },
    });

    if (existing) {
      // Update details if needed (e.g. reprint with corrections), but keep number
      const updated = await prisma.digitalCertificate.update({
        where: { id: existing.id },
        data: {
          grade: input.grade,
          signatoryName: input.musyrifName || existing.signatoryName,
          description: input.notes,
          // We could store more details in description or dedicated fields if model allowed
        },
        include: {
          student: true,
        },
      });
      return updated;
    }

    // Generate new Number
    // Format: [SEQ]/[TYPE]/CPN/[MM]/[YYYY]
    // SEQ resets every month

    // Determine the TYPE code
    let typeCode = 'TAHFIDZ';
    if (certificateType === 'TAHFIDZ_JUZ_AMMA') typeCode = 'JUZ30';
    else if (certificateType === 'TAHFIDZ_5_JUZ') typeCode = '5JUZ';
    else if (certificateType === 'TAHFIDZ_10_JUZ') typeCode = '10JUZ';
    else if (certificateType === 'TAHFIDZ_30_JUZ') typeCode = '30JUZ';
    else if (certificateType === 'SANAD_QIRAAH') typeCode = 'QIRAAH';

    // Get month and year for formatting
    const month = date.getMonth() + 1; // 1-12
    const year = date.getFullYear();
    const monthStr = month.toString().padStart(2, '0');

    // Retry logic for sequence generation
    let retries = 0;
    const maxRetries = 5;

    while (retries < maxRetries) {
      try {
        // Optimized: Find the latest certificate number for this month/year pattern
        const pattern = `%/${typeCode}/CPN/${monthStr}/${year}`;
        const latestCert = await prisma.digitalCertificate.findFirst({
          where: {
            certificateNumber: {
              endsWith: `/${typeCode}/CPN/${monthStr}/${year}`,
            },
          },
          orderBy: {
            certificateNumber: 'desc',
          },
          select: {
            certificateNumber: true,
          },
        });

        let nextSeq = 1;
        if (latestCert) {
          const parts = latestCert.certificateNumber.split('/');
          const lastSeq = parseInt(parts[0], 10);
          if (!isNaN(lastSeq)) {
            nextSeq = lastSeq + 1 + retries; // Add retries to jump over gaps/collisions in loop
          }
        }

        const seq = nextSeq.toString().padStart(3, '0');
        const certificateNumber = `${seq}/${typeCode}/CPN/${monthStr}/${year}`;

        // Generate generic placeholder values for required fields
        const cert = await prisma.digitalCertificate.create({
          data: {
            studentId,
            certificateType,
            certificateNumber,
            title: 'Sertifikat Tahfidz',
            grade: input.grade,
            issueDate: date,
            qrCode: crypto.randomUUID(), // Placeholder unique QR code
            // Was `https://cipansor.com/verify/${crypto.randomUUID()}`, marked
            // "// Placeholder" — a domain the yayasan does not own, a path this
            // app has never had, and a fresh random UUID that identified
            // nothing, so the link could not have verified the certificate it
            // was printed on even if the page had existed. Now the real page,
            // keyed by the number actually stored on this row.
            verificationUrl: certificateVerificationUrl(certificateNumber),
            signatoryName: input.musyrifName || 'Administrator',
            signatoryTitle: 'Musyrif Tahfidz',
            description: input.notes,
            // The qira'ah, completed juz and silsilah printed on the syahadah.
            // Stored so the public download reproduces the issued document
            // instead of the generic certificate.
            metadata: {
              qiraahType: input.qiraahType,
              completedJuz: input.completedJuz,
              musyrifName: input.musyrifName,
              sanadChain: input.sanadChain,
            },
            // Explicit, never the column default: the syahadah's printed URL
            // points at the public page, so a private row could not verify the
            // document it was printed on. `generateCertificateSchema` defaults
            // this to `true`; pass `false` for an internal-only record.
            isPublic: input.isPublic ?? true,
            createdById,
          },
          include: {
            student: true,
          },
        });

        return cert;
      } catch (e: any) {
        if (e.code === 'P2002') {
          // Unique constraint failed
          retries++;
          continue;
        }
        throw e;
      }
    }
    throw new Error('Failed to generate unique certificate number after multiple retries');
  }

  /**
   * Check and register student as Hafidz if they completed 30 Juz
   */
  private async checkAndRegisterHafidz(studentId: string) {
    try {
      // 1. Check if already registered
      const exists = await prisma.hafidzStudent.findUnique({
        where: { studentId },
      });
      if (exists) return;

      // 2. Count completed Juz
      // Distinct juz where score >= 60 and activity is ASSESSMENT or TASMI
      const completedJuzList = await prisma.tahfidzRecord.findMany({
        where: {
          studentId,
          activityType: { in: ['ASSESSMENT', 'TASMI'] },
          score: { gte: 60 },
        },
        select: { juz: true },
        distinct: ['juz'],
      });

      if (completedJuzList.length >= 30) {
        // 3. Register as Hafidz
        await prisma.hafidzStudent.create({
          data: {
            studentId,
            completedAt: new Date(),
            notes: 'Automatically registered by system upon completing 30 Juz',
          },
        });
        logger.info(`Student ${studentId} registered as Hafidz automatically`);
      }
    } catch (error) {
      logger.error('Error in checkAndRegisterHafidz:', error);
      // Do not throw, this is a background check
    }
  }
}

export const tahfidzService = new TahfidzService();
