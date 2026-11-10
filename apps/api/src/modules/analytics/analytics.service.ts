import { prisma } from '@/lib/prisma';
import { Prisma, Gender } from '@prisma/client';
import { todayWib } from '@/utils/wib';
import { wibDayEnd, wibDayStart, wibMonthRange, wibMonthYear } from '@/utils/wib-day';
import type {
  DashboardSummary,
  StudentStatistics,
  TahfidzProgress,
  FinanceReport,
  AnalyticsAttendanceSummary,
  AcademicPerformance,
  HealthSummary,
  ViolationSummary,
  LibrarySummary,
  PsbSummary,
  SpmbSummary,
} from '@cipansor/shared';
import { STUDENT_STATUS } from '@cipansor/shared';

interface DateRange {
  startDate?: string;
  endDate?: string;
}

// ==================== DASHBOARD OVERVIEW ====================

export async function getDashboardStats(unitId?: string): Promise<DashboardSummary> {
  const unitFilter = unitId ? { unitId } : {};
  const studentFilter = { ...unitFilter, deletedAt: null };
  // "Hari ini" and "bulan ini" are calendar periods on the pesantren's clock.
  // The container runs UTC, so `new Date().setHours(0,0,0,0)` yields the UTC
  // day — the previous WIB day for the whole 00:00–06:59 WIB stretch — and
  // `new Date(y, m, 1)` yields the UTC month, so a 1st-morning read landed on
  // the previous month. `Attendance.date` is a `@db.Date` filled with the WIB
  // day, so its bound has to be that same WIB day.
  const today = todayWib();
  const { year, month } = wibMonthYear(new Date());
  const startOfMonth = wibMonthRange(year, month).start;
  const startOfDay = wibDayStart(today);
  const endOfDay = wibDayEnd(today);
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [
    totalStudents,
    activeStudents,
    newStudentsThisMonth,
    attendanceTodayPresent,
    attendanceWeeklyTotal,
    attendanceWeeklyPresent,
    financeStats,
    financeOutstanding,
    tahfidzAvgJuz,
  ] = await Promise.all([
    prisma.student.count({ where: studentFilter }),
    prisma.student.count({ where: { ...studentFilter, status: 'active' } }),
    prisma.student.count({
      where: {
        ...studentFilter,
        createdAt: { gte: startOfMonth },
      },
    }),
    // Attendance Today
    prisma.attendance.count({
      where: {
        ...unitFilter,
        date: { gte: startOfDay, lte: endOfDay },
        status: 'PRESENT',
      },
    }),
    // Attendance Weekly
    prisma.attendance.count({
      where: {
        ...unitFilter,
        date: { gte: oneWeekAgo },
      },
    }),
    prisma.attendance.count({
      where: {
        ...unitFilter,
        date: { gte: oneWeekAgo },
        status: 'PRESENT',
      },
    }),
    // Finance (Monthly Revenue)
    prisma.payment.aggregate({
      where: {
        paidAt: { gte: startOfMonth },
        invoice: unitId ? { student: { unitId } } : undefined,
      },
      _sum: { amount: true },
    }),
    // Finance (Outstanding)
    prisma.invoice.aggregate({
      where: {
        ...unitFilter,
        status: { in: ['PENDING', 'PARTIAL'] },
      },
      _sum: { amount: true, paidAmount: true },
    }),
    // Tahfidz
    prisma.tahfidzRecord.aggregate({
      where: unitId ? { student: { unitId } } : {},
      _avg: { juz: true },
    }),
  ]);

  const outstandingAmount =
    (Number(financeOutstanding._sum.amount) || 0) -
    (Number(financeOutstanding._sum.paidAmount) || 0);

  const totalInvoicedOutstanding = Number(financeOutstanding._sum.amount) || 0;
  const collectionRate =
    totalInvoicedOutstanding > 0 ? 100 - (outstandingAmount / totalInvoicedOutstanding) * 100 : 100;

  return {
    students: {
      total: totalStudents,
      active: activeStudents,
      newThisMonth: newStudentsThisMonth,
    },
    attendance: {
      todayRate:
        activeStudents > 0
          ? Number(((attendanceTodayPresent / activeStudents) * 100).toFixed(2))
          : 0,
      weeklyAverage:
        attendanceWeeklyTotal > 0
          ? Number(((attendanceWeeklyPresent / attendanceWeeklyTotal) * 100).toFixed(2))
          : 0,
    },
    finance: {
      monthlyRevenue: Number(financeStats._sum.amount) || 0,
      outstandingBills: outstandingAmount,
      collectionRate: Number(collectionRate.toFixed(2)),
    },
    tahfidz: {
      averageJuz: Number(tahfidzAvgJuz._avg?.juz?.toFixed(2)) || 0,
      completedHafidz: 0,
    },
  };
}

// ==================== STUDENT STATISTICS ====================

export async function getStudentStats(unitId?: string): Promise<StudentStatistics> {
  const unitFilter = unitId ? { unitId } : {};

  const [byStatus, byGender, byUnit, enrollmentTrendRaw, activeStudents, graduatedThisYear] =
    await Promise.all([
      prisma.student.groupBy({
        by: ['status'],
        where: { ...unitFilter, deletedAt: null },
        _count: true,
      }),
      prisma.student.groupBy({
        by: ['gender'],
        where: { ...unitFilter, deletedAt: null },
        _count: true,
      }),
      prisma.student.groupBy({
        by: ['unitId'],
        where: { deletedAt: null },
        _count: true,
      }),
      // Enrollment by month (using mapped table and column names)
      prisma.$queryRaw<Array<{ month: string; count: bigint }>>`
      SELECT
        TO_CHAR(created_at, 'YYYY-MM') as month,
        COUNT(*)::bigint as count
      FROM students
      WHERE created_at >= NOW() - INTERVAL '12 months'
      GROUP BY TO_CHAR(created_at, 'YYYY-MM')
      ORDER BY month DESC
    `,
      prisma.student.count({ where: { ...unitFilter, status: 'active' } }),
      prisma.student.count({
        where: {
          ...unitFilter,
          // Dulu 'graduated' — nilai yang TIDAK PERNAH ditulis siapa pun.
          // Satu-satunya penulisnya, `alumni.service`, menulis 'alumni', jadi
          // "alumni tahun ini" permanen nol. Cacat yang sama keluarganya dengan
          // 39 penyaring huruf besar di PR ini: satu fakta, beberapa ejaan.
          status: STUDENT_STATUS.ALUMNI,
          updatedAt: { gte: new Date(new Date().getFullYear(), 0, 1) },
        },
      }),
    ]);

  // Get unit names for stats
  const unitIds = byUnit.map((u) => u.unitId);
  const units = await prisma.unit.findMany({
    where: { id: { in: unitIds } },
    select: { id: true, name: true, type: true },
  });

  const totalStudents = byStatus.reduce((acc, curr) => acc + curr._count, 0);

  // Approximate "new students this month"
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  const newStudentsThisMonth = await prisma.student.count({
    where: {
      ...unitFilter,
      createdAt: { gte: startOfMonth },
    },
  });

  return {
    totalStudents,
    activeStudents,
    newStudentsThisMonth,
    graduatedThisYear,
    byGender: {
      male: byGender.find((g) => g.gender === Gender.MALE)?._count || 0,
      female: byGender.find((g) => g.gender === Gender.FEMALE)?._count || 0,
    },
    byUnit: byUnit.map((u) => ({
      unitId: u.unitId,
      unitName: units.find((unit) => unit.id === u.unitId)?.name || 'Unknown',
      count: u._count,
    })),
    byClass: [], // Placeholder
    trend: enrollmentTrendRaw.map((e) => ({
      month: e.month,
      count: Number(e.count),
    })),
  };
}

// ==================== TAHFIDZ STATISTICS ====================

export async function getTahfidzStats(
  unitId?: string,
  dateRange?: DateRange
): Promise<TahfidzProgress> {
  const where: Prisma.TahfidzRecordWhereInput = {
    ...(unitId && { student: { unitId } }),
    ...(dateRange?.startDate &&
      dateRange?.endDate && {
        createdAt: {
          gte: new Date(dateRange.startDate),
          lte: new Date(dateRange.endDate),
        },
      }),
  };

  const [totalStudents, avgJuz, topStudents] = await Promise.all([
    prisma.student.count({ where: unitId ? { unitId } : {} }),
    prisma.tahfidzRecord.aggregate({
      where,
      _avg: { juz: true },
    }),
    // Top students by total ayah
    prisma.tahfidzRecord.groupBy({
      by: ['studentId'],
      where,
      _sum: { totalAyah: true },
      orderBy: { _sum: { totalAyah: 'desc' } },
      take: 5,
    }),
  ]);

  // Completed Hafidz = students who have records spanning all 30 juz.
  // tahfidz_records has no soft-delete column, so don't filter on one.
  const completedHafidzCount = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint as count FROM (
          SELECT student_id FROM tahfidz_records
          GROUP BY student_id
          HAVING COUNT(DISTINCT juz) >= 30
      ) as hafidz
  `;
  const realCompletedHafidz = Number(completedHafidzCount[0]?.count || 0);

  // Optimized: Parallel execution for juz ranges
  const rangePromises = [
    prisma.tahfidzRecord.count({ where: { ...where, juz: { gte: 1, lte: 5 } } }),
    prisma.tahfidzRecord.count({ where: { ...where, juz: { gte: 6, lte: 10 } } }),
    prisma.tahfidzRecord.count({ where: { ...where, juz: { gte: 11, lte: 15 } } }),
    prisma.tahfidzRecord.count({ where: { ...where, juz: { gte: 16, lte: 20 } } }),
    prisma.tahfidzRecord.count({ where: { ...where, juz: { gte: 21, lte: 25 } } }),
    prisma.tahfidzRecord.count({ where: { ...where, juz: { gte: 26, lte: 30 } } }),
  ];

  const [r1, r2, r3, r4, r5, r6] = await Promise.all(rangePromises);

  const byJuzRange = [
    { range: '1-5', count: r1 },
    { range: '6-10', count: r2 },
    { range: '11-15', count: r3 },
    { range: '16-20', count: r4 },
    { range: '21-25', count: r5 },
    { range: '26-30', count: r6 },
  ];

  // Get student names for top students
  const studentIds = topStudents.map((s) => s.studentId);
  const students = await prisma.student.findMany({
    where: { id: { in: studentIds } },
    include: { user: { select: { name: true } } },
  });

  // Monthly progress - Using recorded_at (snake_case)
  const monthlyProgress = await prisma.$queryRaw<Array<{ month: string; count: bigint }>>`
      SELECT
        TO_CHAR(recorded_at, 'YYYY-MM') as month,
        COUNT(*)::bigint as count
      FROM tahfidz_records
      WHERE recorded_at >= NOW() - INTERVAL '6 months'
      GROUP BY TO_CHAR(recorded_at, 'YYYY-MM')
      ORDER BY month DESC
  `;

  return {
    totalStudents,
    averageJuz: Number(avgJuz._avg.juz?.toFixed(2)) || 0,
    completedHafidz: realCompletedHafidz,
    byJuzRange,
    topPerformers: topStudents.map((s) => {
      const student = students.find((st) => st.id === s.studentId);
      return {
        studentId: s.studentId,
        studentName: student?.user.name || 'Unknown',
        totalJuz: 0,
        totalAyat: s._sum.totalAyah || 0,
      };
    }),
    monthlyProgress: monthlyProgress.map((m) => ({
      month: m.month,
      newMemorization: Number(m.count),
      murajaah: 0,
    })),
  };
}

// ==================== FINANCE STATISTICS ====================

export async function getFinanceStats(
  unitId?: string,
  dateRange?: DateRange
): Promise<FinanceReport> {
  const invoiceWhere: Prisma.InvoiceWhereInput = {
    ...(unitId && { student: { unitId } }),
    ...(dateRange?.startDate &&
      dateRange?.endDate && {
        createdAt: {
          gte: new Date(dateRange.startDate),
          lte: new Date(dateRange.endDate),
        },
      }),
  };

  const paymentWhere: Prisma.PaymentWhereInput = {
    ...(dateRange?.startDate &&
      dateRange?.endDate && {
        paidAt: {
          gte: new Date(dateRange.startDate),
          lte: new Date(dateRange.endDate),
        },
      }),
  };

  const [invoiceStats, paymentStats, byStatus, byMethod, monthlyRevenue] = await Promise.all([
    prisma.invoice.aggregate({
      where: invoiceWhere,
      _sum: { amount: true, paidAmount: true },
      _count: true,
    }),
    prisma.payment.aggregate({
      where: paymentWhere,
      _sum: { amount: true },
      _count: true,
    }),
    prisma.invoice.groupBy({
      by: ['status'],
      where: invoiceWhere,
      _count: true,
      _sum: { amount: true },
    }),
    prisma.payment.groupBy({
      by: ['method'],
      where: paymentWhere,
      _count: true,
      _sum: { amount: true },
    }),
    // Monthly revenue for last 12 months using mapped table/column
    prisma.$queryRaw<Array<{ month: string; total: bigint }>>`
      SELECT 
        TO_CHAR(paid_at, 'YYYY-MM') as month,
        COALESCE(SUM(amount), 0)::bigint as total
      FROM payments
      WHERE paid_at >= NOW() - INTERVAL '12 months'
      GROUP BY TO_CHAR(paid_at, 'YYYY-MM')
      ORDER BY month DESC
      LIMIT 12
    `,
  ]);

  const totalRevenue = Number(paymentStats._sum.amount) || 0;
  // Expense logic is missing in current schema, placeholder 0
  const totalExpense = 0;

  return {
    totalRevenue,
    totalExpense,
    netIncome: totalRevenue - totalExpense,
    outstandingBills:
      (Number(invoiceStats._sum.amount) || 0) - (Number(invoiceStats._sum.paidAmount) || 0),
    collectionRate:
      invoiceStats._sum.amount && Number(invoiceStats._sum.amount) > 0
        ? Number(
            (
              ((Number(invoiceStats._sum.paidAmount) || 0) / Number(invoiceStats._sum.amount)) *
              100
            ).toFixed(2)
          )
        : 0,
    revenueByCategory: [],
    expenseByCategory: [],
    monthlyTrend: monthlyRevenue.map((m) => ({
      month: m.month,
      revenue: Number(m.total),
      expense: 0,
    })),
  };
}

// ==================== ATTENDANCE STATISTICS ====================

export async function getAttendanceStats(
  unitId?: string,
  dateRange?: DateRange
): Promise<AnalyticsAttendanceSummary> {
  const where: Prisma.AttendanceWhereInput = {
    ...(unitId && { student: { unitId } }),
    ...(dateRange?.startDate &&
      dateRange?.endDate && {
        date: {
          gte: new Date(dateRange.startDate),
          lte: new Date(dateRange.endDate),
        },
      }),
  };

  const startDate = dateRange?.startDate ? new Date(dateRange.startDate) : undefined;
  const endDate = dateRange?.endDate ? new Date(dateRange.endDate) : undefined;

  const [byStatus, dailyTrend, classStatsRaw] = await Promise.all([
    prisma.attendance.groupBy({
      by: ['status'],
      where,
      _count: true,
    }),
    // Daily attendance for last 30 days
    prisma.$queryRaw<
      Array<{ date: Date; present: bigint; total: bigint; absent: bigint; late: bigint }>
    >`
      SELECT 
        date::date as date,
        COUNT(CASE WHEN status = 'PRESENT' THEN 1 END)::bigint as present,
        COUNT(CASE WHEN status = 'ABSENT' THEN 1 END)::bigint as absent,
        COUNT(CASE WHEN status = 'LATE' THEN 1 END)::bigint as late,
        COUNT(*)::bigint as total
      FROM attendances
      WHERE date >= NOW() - INTERVAL '30 days'
      GROUP BY date::date
      ORDER BY date DESC
    `,
    // Optimized: By class stats using single query
    prisma.$queryRaw<Array<{ classId: string; total: number; present: number }>>`
      SELECT
        a.class_id as "classId",
        COUNT(*)::int as total,
        COUNT(CASE WHEN a.status = 'PRESENT' THEN 1 END)::int as present
      FROM attendances a
      JOIN students s ON a.student_id = s.id
      WHERE 1=1
      ${unitId ? Prisma.sql`AND s.unit_id = ${unitId}` : Prisma.empty}
      ${startDate && endDate ? Prisma.sql`AND a.date >= ${startDate} AND a.date <= ${endDate}` : Prisma.empty}
      GROUP BY a.class_id
    `,
  ]);

  const totalRecords = byStatus.reduce((sum, s) => sum + s._count, 0);
  const presentCount = byStatus.find((s) => s.status === 'PRESENT')?._count || 0;
  const absentCount = byStatus.find((s) => s.status === 'ABSENT')?._count || 0;
  const lateCount = byStatus.find((s) => s.status === 'LATE')?._count || 0;
  const sickCount = byStatus.find((s) => s.status === 'SICK')?._count || 0;
  const permittedCount = byStatus.find((s) => s.status === 'EXCUSED')?._count || 0; // EXCUSED is the enum value in schema

  const classIds = classStatsRaw.map((s) => s.classId).filter(Boolean);
  const classes = await prisma.class.findMany({
    where: { id: { in: classIds } },
    select: { id: true, name: true, level: true },
  });

  const classRates = classStatsRaw.map((stats) => {
    const cid = stats.classId;
    return {
      classId: cid,
      className: classes.find((c) => c.id === cid)?.name || 'Unknown',
      presentRate: stats.total > 0 ? Number(((stats.present / stats.total) * 100).toFixed(2)) : 0,
    };
  });

  return {
    totalDays: totalRecords,
    presentRate: totalRecords > 0 ? Number(((presentCount / totalRecords) * 100).toFixed(2)) : 0,
    absentRate: totalRecords > 0 ? Number(((absentCount / totalRecords) * 100).toFixed(2)) : 0,
    lateRate: totalRecords > 0 ? Number(((lateCount / totalRecords) * 100).toFixed(2)) : 0,
    sickRate: totalRecords > 0 ? Number(((sickCount / totalRecords) * 100).toFixed(2)) : 0,
    permittedRate:
      totalRecords > 0 ? Number(((permittedCount / totalRecords) * 100).toFixed(2)) : 0,
    byClass: classRates,
    trend: dailyTrend.map((d) => ({
      date: new Date(d.date).toISOString().split('T')[0],
      present: Number(d.present),
      absent: Number(d.absent),
      late: Number(d.late),
    })),
  };
}

// ==================== ACADEMIC STATISTICS ====================

export async function getAcademicStats(unitId?: string): Promise<AcademicPerformance> {
  const unitFilter = unitId ? { unitId } : {};

  // Filter subject performance by unit if unitId is provided
  const subjectPerformanceFilter = unitId ? { subject: { unitId } } : {};

  const [examStats, gradeDistribution, subjectPerformance, topPerformersData] = await Promise.all([
    // Exam statistics
    prisma.exam.aggregate({
      where: unitFilter,
      _count: true,
    }),
    // Grade distribution
    prisma.grade.groupBy({
      by: ['letterGrade'],
      _count: true,
    }),
    // Average performance by subject
    prisma.grade.groupBy({
      by: ['subjectId'],
      where: subjectPerformanceFilter,
      _avg: { percentage: true }, // Using percentage column from schema
      _count: true,
    }),
    // Top performers (by GPA approximation from grades)
    prisma.grade.groupBy({
      by: ['studentId'],
      _avg: { score: true }, // Using score for now as GPA needs credits weighting
      orderBy: { _avg: { score: 'desc' } },
      take: 5,
    }),
  ]);

  // Get subject names
  const subjectIds = subjectPerformance.map((s) => s.subjectId);
  const subjects = await prisma.subject.findMany({
    where: { id: { in: subjectIds } },
    select: { id: true, name: true, code: true },
  });

  // Get student details for top performers
  const topStudentIds = topPerformersData.map((s) => s.studentId);
  const topStudents = await prisma.student.findMany({
    where: { id: { in: topStudentIds } },
    include: {
      user: { select: { name: true } },
      enrollments: {
        where: { status: 'active' },
        include: { class: { select: { id: true, name: true } } },
        take: 1,
      },
    },
  });

  // Calculate total grades for distribution percentage
  const totalGrades = gradeDistribution.reduce((acc, curr) => acc + curr._count, 0);

  // Calculate average GPA (Estimate based on average scores of top performers or general average)
  // Real GPA requires credit hours. Here we map score to 4.0 scale roughly:
  // >90: 4.0, >80: 3.0, >70: 2.0, >60: 1.0
  // Or just use the average percentage/score scaled.
  const overallAvgScore = await prisma.grade.aggregate({
    _avg: { score: true },
  });
  const avgScoreVal = Number(overallAvgScore._avg.score) || 0;
  const estimatedGPA = avgScoreVal / 25; // Rough 0-4 scale from 0-100

  // Calculate Pass Rate
  // Calculate exact number of passing grades by joining Grade, Exam (optional), and Subject.
  // Priority: Exam.passingScore > Subject.passingScore > 70 (default)
  // We use queryRaw for this complex join condition not easily expressible in Prisma findMany/aggregate
  // We also group by subject_id to calculate per-subject pass rate efficiently in one query.
  const passingGradesBySubjectResult = await prisma.$queryRaw<
    Array<{ subject_id: string; count: bigint }>
  >`
    SELECT g.subject_id, COUNT(*)::bigint as count
    FROM grades g
    LEFT JOIN exams e ON g.exam_id = e.id
    JOIN subjects s ON g.subject_id = s.id
    WHERE g.score >= COALESCE(e.passing_score, s.passing_score, 70)
    ${unitId ? Prisma.sql`AND s.unit_id = ${unitId}` : Prisma.empty}
    GROUP BY g.subject_id
  `;

  // Calculate global passing count by summing up subject counts
  // Note: This assumes that only grades associated with subjects in the current unit are returned, which the SQL enforces.
  const passingGradesCount = passingGradesBySubjectResult.reduce(
    (acc, curr) => acc + Number(curr.count),
    0
  );
  const passRate = totalGrades > 0 ? (passingGradesCount / totalGrades) * 100 : 0;

  // Create a map for quick lookup of passing counts per subject
  const passingMap = new Map<string, number>();
  passingGradesBySubjectResult.forEach((row) => {
    passingMap.set(row.subject_id, Number(row.count));
  });

  return {
    averageGpa: Number(estimatedGPA.toFixed(2)),
    passRate: Number(passRate.toFixed(2)),
    topPerformers: topPerformersData.map((p) => {
      const student = topStudents.find((s) => s.id === p.studentId);
      // Estimate GPA from average score
      const gpa = (Number(p._avg.score) || 0) / 25;
      return {
        studentId: p.studentId,
        studentName: student?.user.name || 'Unknown',
        classId: student?.enrollments[0]?.class.id || '',
        className: student?.enrollments[0]?.class.name || '-',
        gpa: Number(gpa.toFixed(2)),
      };
    }),
    bySubject: subjectPerformance
      .map((s) => {
        const subject = subjects.find((sub) => sub.id === s.subjectId);
        const passingCount = passingMap.get(s.subjectId) || 0;
        const totalCount = s._count;
        const subjectPassRate = totalCount > 0 ? (passingCount / totalCount) * 100 : 0;

        return {
          subjectId: s.subjectId,
          subjectName: subject?.name || 'Unknown',
          averageScore: Number(s._avg.percentage?.toFixed(2)) || 0, // Schema has percentage column in Grade
          passRate: Number(subjectPassRate.toFixed(2)),
        };
      })
      .sort((a, b) => b.averageScore - a.averageScore),
    gradeDistribution: gradeDistribution
      .filter((g) => g.letterGrade)
      .map((g) => ({
        grade: g.letterGrade || '?',
        count: g._count,
        percentage: totalGrades > 0 ? Number(((g._count / totalGrades) * 100).toFixed(2)) : 0,
      }))
      .sort((a, b) => (a.grade || '').localeCompare(b.grade || '')),
    trend: [], // Still empty as semester trend needs complex historical data
  };
}

export async function getLibraryStats(unitId?: string): Promise<LibrarySummary> {
  const where: Prisma.BookWhereInput = unitId ? { unitId } : {};
  const borrowingWhere: Prisma.BorrowingWhereInput = {
    ...(unitId && { book: { unitId } }),
  };

  const [totalBooks, totalCopies, availableCopies, borrowingStats, overdueCount, popularBooks] =
    await Promise.all([
      // Total titles
      prisma.book.count({ where }),
      // Total physical copies
      prisma.book.aggregate({
        where,
        _sum: { quantity: true },
      }),
      // Available copies
      prisma.book.aggregate({
        where,
        _sum: { available: true },
      }),
      // Borrowings by status
      prisma.borrowing.groupBy({
        by: ['status'],
        where: borrowingWhere,
        _count: true,
      }),
      // Overdue count
      prisma.borrowing.count({
        where: {
          ...borrowingWhere,
          status: 'OVERDUE',
        },
      }),
      // Popular books (most borrowed)
      prisma.borrowing.groupBy({
        by: ['bookId'],
        where: borrowingWhere,
        _count: true,
        orderBy: { _count: { bookId: 'desc' } },
        take: 5,
      }),
    ]);

  // Fetch book details for popular books
  const popularBookIds = popularBooks.map((b) => b.bookId);
  const books = await prisma.book.findMany({
    where: { id: { in: popularBookIds } },
    select: { id: true, title: true, author: true },
  });

  const popularBooksData = popularBooks.map((item) => {
    const book = books.find((b) => b.id === item.bookId);
    return {
      bookId: item.bookId,
      title: book?.title || 'Unknown',
      author: book?.author || 'Unknown',
      borrowCount: item._count,
    };
  });

  const borrowings = borrowingStats.reduce(
    (acc, curr) => {
      acc[curr.status] = curr._count;
      return acc;
    },
    {} as Record<string, number>
  );

  return {
    books: {
      totalBooks: totalBooks,
      totalCopies: totalCopies._sum.quantity || 0,
      available: availableCopies._sum.available || 0,
    },
    borrowings,
    overdue: overdueCount,
    popularBooks: popularBooksData,
  };
}

export async function getSPMBStats(unitId?: string): Promise<SpmbSummary> {
  // Check for a *currently running* admission period. Picking the period with
  // the latest startDate alone is wrong: a future-dated `isActive` period would
  // then shadow the intake that is actually running today. A period counts as
  // active only when `isActive` is true AND `now` falls inside its
  // [startDate, endDate] window.
  const now = new Date();
  const activePeriod = await prisma.admissionPeriod.findFirst({
    where: {
      isActive: true,
      startDate: { lte: now },
      endDate: { gte: now },
      ...(unitId && { unitId }),
    },
    orderBy: { startDate: 'desc' },
  });

  const periodFilter = activePeriod ? { admissionPeriodId: activePeriod.id } : {};

  // Combine unit filter and period filter
  const where: Prisma.RegistrantWhereInput = {
    ...periodFilter,
    ...(unitId ? { admissionPeriod: { unitId } } : {}),
  };

  const [totalRegistrants, byStatus, admissionPeriods] = await Promise.all([
    prisma.registrant.count({ where }),
    prisma.registrant.groupBy({
      by: ['status'],
      where,
      _count: true,
    }),
    prisma.admissionPeriod.findMany({
      where: unitId ? { unitId } : {},
      orderBy: { startDate: 'desc' },
      take: 5,
      include: {
        _count: {
          select: { registrants: true },
        },
      },
    }),
  ]);

  const statusCounts = byStatus.reduce(
    (acc, curr) => {
      acc[curr.status] = curr._count;
      return acc;
    },
    {} as Record<string, number>
  );

  const periodsData = admissionPeriods.map((p) => ({
    periodId: p.id,
    periodName: p.name,
    quota: p.quota,
    registrantCount: p._count.registrants,
    startDate: p.startDate,
    endDate: p.endDate,
    isActive: p.isActive,
  }));

  return {
    totalRegistrants,
    byStatus: statusCounts,
    byPeriod: periodsData,
  };
}

export const getPSBStats = getSPMBStats;
