import { prisma } from '../../lib/prisma';
import { ApiError, ErrorCode } from '../../middleware/error';
import { Prisma, AttendanceStatus, Invoice, StudentParent } from '@prisma/client';
import { getStudentIbadahStats } from '../ibadah/ibadah.service';
import * as DormitoryService from '../dormitories/dormitories.service';
import { recentAnnouncements as announcementsAddressedTo } from '@/modules/announcements';
import { todayWib, wibWeekRange } from '../../utils/wib';

type StudentParentWithStudent = Awaited<ReturnType<typeof prisma.studentParent.findMany>>[0];
type GradeWithRelations = Awaited<ReturnType<typeof prisma.grade.findMany>>[0];

export class ParentService {
  /**
   * Get all children linked to a parent
   */
  async getChildren(parentId: string) {
    const children = await prisma.studentParent.findMany({
      where: { parentId },
      include: {
        student: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                isActive: true,
              },
            },
            unit: {
              select: {
                id: true,
                name: true,
                type: true,
              },
            },
            enrollments: {
              where: { status: 'active' },
              include: {
                class: {
                  select: {
                    id: true,
                    name: true,
                    level: true,
                    academicYear: {
                      select: {
                        id: true,
                        name: true,
                        isActive: true,
                      },
                    },
                    homeroomTeacher: {
                      select: {
                        id: true,
                        user: {
                          select: {
                            // The parent's "kirim pesan ke wali kelas" flow needs
                            // the teacher's *User* id as the recipient; the
                            // Teacher id is a different entity.
                            id: true,
                            name: true,
                          },
                        },
                      },
                    },
                  },
                },
              },
              take: 1,
              orderBy: { enrolledAt: 'desc' },
            },
          },
        },
      },
    });

    // `id` is deliberately the *student* id, not the StudentParent link id:
    // every downstream route is `/parent/children/{studentId}/…`.
    //
    // The biodata below (nisn, birth details, contact) is what the "Data Anak"
    // page renders. It used to call `/parent/children/{id}` for it — a route
    // that was never built — so those fields were always blank. Returning them
    // here costs one row per child and removes a request.
    return children.map((sp: (typeof children)[0]) => ({
      id: sp.student.id,
      name: sp.student.user.name,
      nis: sp.student.nis,
      nisn: sp.student.nisn,
      gender: sp.student.gender,
      birthPlace: sp.student.birthPlace,
      birthDate: sp.student.birthDate,
      address: sp.student.address,
      // Student has no phone/email of its own — the contact on file is the
      // guardian's, plus the login email on the linked user.
      phone: sp.student.parentPhone,
      email: sp.student.user.email,
      photoUrl: sp.student.photoUrl,
      status: sp.student.status,
      relation: sp.relation,
      isPrimary: sp.isPrimary,
      unitId: sp.student.unitId,
      unit: sp.student.unit,
      currentClass: sp.student.enrollments[0]?.class || null,
    }));
  }

  /**
   * Verify parent has access to student
   */
  async verifyParentAccess(parentId: string, studentId: string) {
    const link = await prisma.studentParent.findUnique({
      where: {
        studentId_parentId: { studentId, parentId },
      },
    });

    if (!link) {
      throw new ApiError(ErrorCode.FORBIDDEN, 'Anda tidak memiliki akses ke data anak ini');
    }

    return link;
  }

  /**
   * Get child profile with full details
   */
  async getChildProfile(parentId: string, studentId: string) {
    await this.verifyParentAccess(parentId, studentId);

    const student = await prisma.student.findUnique({
      where: { id: studentId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            isActive: true,
          },
        },
        unit: {
          select: {
            id: true,
            name: true,
            type: true,
            address: true,
            phone: true,
          },
        },
        enrollments: {
          where: { status: 'active' },
          include: {
            class: {
              include: {
                academicYear: true,
                homeroomTeacher: {
                  include: {
                    user: {
                      select: {
                        name: true,
                        phone: true,
                      },
                    },
                  },
                },
              },
            },
          },
          orderBy: { enrolledAt: 'desc' },
        },
        roomAssignments: {
          where: { isActive: true },
          include: {
            room: {
              include: {
                dormitory: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
          take: 1,
        },
      },
    });

    if (!student) {
      throw new ApiError(ErrorCode.NOT_FOUND, 'Data anak tidak ditemukan');
    }

    return {
      ...student,
      currentClass: student.enrollments[0]?.class || null,
      currentRoom: student.roomAssignments[0]?.room || null,
    };
  }

  /**
   * Get child attendance summary
   */
  async getChildAttendance(
    parentId: string,
    studentId: string,
    query: {
      startDate?: string;
      endDate?: string;
      academicYearId?: string;
    }
  ) {
    await this.verifyParentAccess(parentId, studentId);

    const where: Prisma.AttendanceWhereInput = { studentId };

    if (query.startDate || query.endDate) {
      const dateFilter: Prisma.DateTimeFilter = {};
      if (query.startDate) dateFilter.gte = new Date(query.startDate);
      if (query.endDate) dateFilter.lte = new Date(query.endDate);
      where.date = dateFilter;
    }

    const attendances = await prisma.attendance.findMany({
      where,
      include: {
        class: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { date: 'desc' },
      take: 30,
    });

    // Calculate summary
    const summary = await prisma.attendance.groupBy({
      by: ['status'],
      where,
      _count: { id: true },
    });

    type SummaryMap = {
      present: number;
      absent: number;
      late: number;
      sick: number;
      excused: number;
    };
    const summaryMap = summary.reduce<SummaryMap>(
      (acc, item) => ({
        ...acc,
        [item.status.toLowerCase()]: item._count.id,
      }),
      { present: 0, absent: 0, late: 0, sick: 0, excused: 0 }
    );

    return {
      records: attendances,
      summary: summaryMap,
      total: Object.values(summaryMap).reduce((a, b) => a + b, 0),
    };
  }

  /**
   * Aggregated weekly progress for one child (attendance + tahfidz + behavior +
   * academic), used by the parent "Buku Penghubung" weekly tab. Defaults to the
   * current Monday–Sunday week; `weekStart` (any date in the desired week) can
   * override it.
   */
  async getChildWeeklyProgress(
    parentId: string,
    studentId: string,
    query: { weekStart?: string } = {}
  ) {
    await this.verifyParentAccess(parentId, studentId);

    // Monday 00:00 WIB of the reference week → exclusive next Monday. The
    // reference is the WIB calendar day, so 00:00–06:59 WIB (still the previous
    // day on the UTC server clock) does not roll the window back a week.
    const refDay = todayWib(query.weekStart ? new Date(query.weekStart) : new Date());
    const { start, end, prevStart } = wibWeekRange(refDay);

    const [attendanceGroups, tahfidzRecords, weekGrades, prevGrades, rewards, violations] =
      await Promise.all([
        prisma.attendance.groupBy({
          by: ['status'],
          where: { studentId, date: { gte: start, lt: end } },
          _count: { id: true },
        }),
        prisma.tahfidzRecord.findMany({
          where: { studentId, recordedAt: { gte: start, lt: end } },
          select: { activityType: true, totalAyah: true, score: true },
        }),
        prisma.grade.findMany({
          where: { studentId, gradedAt: { gte: start, lt: end } },
          select: { percentage: true, score: true, maxScore: true },
        }),
        prisma.grade.findMany({
          where: { studentId, gradedAt: { gte: prevStart, lt: start } },
          select: { percentage: true, score: true, maxScore: true },
        }),
        prisma.reward.findMany({
          where: { studentId, givenAt: { gte: start, lt: end } },
          orderBy: { givenAt: 'desc' },
        }),
        prisma.violation.findMany({
          where: { studentId, occurredAt: { gte: start, lt: end } },
          orderBy: { occurredAt: 'desc' },
        }),
      ]);

    // Attendance
    const att = { PRESENT: 0, ABSENT: 0, LATE: 0, SICK: 0, EXCUSED: 0 };
    for (const g of attendanceGroups) {
      att[g.status as keyof typeof att] = g._count.id;
    }

    // Tahfidz
    let newMemorization = 0;
    let review = 0;
    const tahfidzScores: number[] = [];
    for (const r of tahfidzRecords) {
      if (r.activityType === 'ZIYADAH') newMemorization += r.totalAyah;
      else if (r.activityType === 'MUROJAAH') review += r.totalAyah;
      if (r.score != null) tahfidzScores.push(Number(r.score));
    }
    const tahfidzAvg =
      tahfidzScores.length > 0
        ? tahfidzScores.reduce((a, b) => a + b, 0) / tahfidzScores.length
        : null;
    const grade =
      tahfidzAvg == null
        ? '—'
        : tahfidzAvg >= 90
          ? 'Mumtaz'
          : tahfidzAvg >= 80
            ? 'Jayyid Jiddan'
            : tahfidzAvg >= 70
              ? 'Jayyid'
              : 'Maqbul';

    // Academic
    const pct = (g: { percentage: unknown; score: unknown; maxScore: unknown }) =>
      Number(g.percentage ?? (g.maxScore ? (Number(g.score) / Number(g.maxScore)) * 100 : 0));
    const avg = (arr: typeof weekGrades) =>
      arr.length > 0 ? arr.reduce((a, g) => a + pct(g), 0) / arr.length : null;
    const weekAvg = avg(weekGrades);
    const prevAvg = avg(prevGrades);
    let improvement = '';
    if (weekAvg != null && prevAvg != null) {
      const diff = weekAvg - prevAvg;
      improvement =
        Math.abs(diff) < 0.05
          ? 'Stabil dari minggu sebelumnya'
          : diff > 0
            ? `Naik ${diff.toFixed(1)} poin dari minggu sebelumnya`
            : `Turun ${Math.abs(diff).toFixed(1)} poin dari minggu sebelumnya`;
    }

    const weekLabel = `${start.toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'short',
      timeZone: 'Asia/Jakarta',
    })} – ${new Date(end.getTime() - 1).toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'Asia/Jakarta',
    })}`;

    return {
      week: weekLabel,
      attendance: {
        present: att.PRESENT,
        absent: att.ABSENT,
        sick: att.SICK,
        permitted: att.EXCUSED,
      },
      tahfidz: { newMemorization, review, grade },
      behavior: {
        positive: rewards.length,
        negative: violations.length,
        notes: rewards[0]?.description || violations[0]?.description || '',
      },
      academic: {
        averageScore: weekAvg != null ? Math.round(weekAvg * 10) / 10 : 0,
        improvement,
      },
    };
  }

  /**
   * Get child tahfidz progress
   */
  async getChildTahfidz(
    parentId: string,
    studentId: string,
    query: {
      activityType?: string;
      page?: number;
      limit?: number;
    }
  ) {
    await this.verifyParentAccess(parentId, studentId);

    const page = query.page || 1;
    const limit = query.limit || 20;

    const where: Prisma.TahfidzRecordWhereInput = { studentId };
    if (query.activityType) {
      where.activityType = query.activityType as Prisma.TahfidzRecordWhereInput['activityType'];
    }

    const [records, total] = await Promise.all([
      prisma.tahfidzRecord.findMany({
        where,
        include: {
          recordedBy: {
            select: {
              name: true,
            },
          },
        },
        orderBy: { recordedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.tahfidzRecord.count({ where }),
    ]);

    // Get summary
    const summaryByType = await prisma.tahfidzRecord.groupBy({
      by: ['activityType'],
      where: { studentId },
      _count: { id: true },
      _sum: { totalAyah: true },
    });

    // Calculate total juz memorized
    const ziyadahRecords = await prisma.tahfidzRecord.findMany({
      where: {
        studentId,
        activityType: 'ZIYADAH',
      },
      select: { juz: true },
      distinct: ['juz'],
    });

    return {
      records,
      summary: {
        byType: summaryByType,
        totalJuzMemorized: ziyadahRecords.length,
      },
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get child ibadah stats
   */
  async getChildIbadah(
    parentId: string,
    studentId: string,
    query: {
      startDate: string;
      endDate: string;
    }
  ) {
    await this.verifyParentAccess(parentId, studentId);

    return getStudentIbadahStats({
      studentId,
      startDate: new Date(query.startDate),
      endDate: new Date(query.endDate),
    });
  }

  /**
   * Get child grades
   */
  async getChildGrades(
    parentId: string,
    studentId: string,
    query: {
      academicYearId?: string;
      subjectId?: string;
    }
  ) {
    await this.verifyParentAccess(parentId, studentId);

    const where: Prisma.GradeWhereInput = { studentId };
    if (query.academicYearId) {
      where.academicYearId = query.academicYearId;
    }
    if (query.subjectId) {
      where.subjectId = query.subjectId;
    }

    const grades = await prisma.grade.findMany({
      where,
      include: {
        subject: {
          select: {
            id: true,
            name: true,
            code: true,
            type: true,
          },
        },
        exam: {
          select: {
            id: true,
            title: true,
            type: true,
            scheduledAt: true,
          },
        },
        academicYear: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { gradedAt: 'desc' },
    });

    type SubjectGrades = {
      subject: (typeof grades)[0]['subject'];
      grades: typeof grades;
      averageScore: number;
    };

    // Group by subject
    const bySubject = grades.reduce<Record<string, SubjectGrades>>((acc, grade) => {
      const subjectId = grade.subject.id;
      if (!acc[subjectId]) {
        acc[subjectId] = {
          subject: grade.subject,
          grades: [],
          averageScore: 0,
        };
      }
      acc[subjectId].grades.push(grade);
      return acc;
    }, {});

    // Calculate averages
    Object.values(bySubject).forEach((subjectGrades) => {
      const scores = subjectGrades.grades.map((g) =>
        Number(g.percentage || (Number(g.score) / Number(g.maxScore)) * 100)
      );
      subjectGrades.averageScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    });

    return {
      grades,
      bySubject: Object.values(bySubject),
    };
  }

  /**
   * Get child report cards
   */
  async getChildReportCards(parentId: string, studentId: string) {
    await this.verifyParentAccess(parentId, studentId);

    const reportCards = await prisma.reportCard.findMany({
      where: {
        studentId,
        isPublished: true, // Only show published report cards to parents
      },
      include: {
        class: {
          select: {
            id: true,
            name: true,
            level: true,
          },
        },
        academicYear: {
          select: {
            id: true,
            name: true,
          },
        },
        details: {
          orderBy: { subjectName: 'asc' },
        },
      },
      orderBy: [{ academicYear: { name: 'desc' } }, { semester: 'desc' }],
    });

    return reportCards;
  }

  /**
   * Get child financial summary
   */
  async getChildFinance(parentId: string, studentId: string) {
    await this.verifyParentAccess(parentId, studentId);

    const invoices = await prisma.invoice.findMany({
      where: { studentId },
      include: {
        paymentType: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
        payments: {
          orderBy: { paidAt: 'desc' },
        },
      },
      orderBy: { dueDate: 'desc' },
    });

    const summary = {
      totalInvoices: invoices.length,
      totalAmount: invoices.reduce((sum, inv) => sum + Number(inv.amount), 0),
      totalPaid: invoices.reduce((sum, inv) => sum + Number(inv.paidAmount), 0),
      totalOutstanding: 0,
      pendingCount: 0,
      overdueCount: 0,
    };

    summary.totalOutstanding = summary.totalAmount - summary.totalPaid;
    summary.pendingCount = invoices.filter(
      (inv) => inv.status === 'PENDING' || inv.status === 'PARTIAL'
    ).length;
    summary.overdueCount = invoices.filter((inv) => inv.status === 'OVERDUE').length;

    return {
      invoices,
      summary,
    };
  }

  /**
   * Get child counseling summaries shared with parents.
   * PRIVACY: only sessions explicitly flagged for parents
   * (parentNotified) or non-confidential ones are returned, and the
   * structured psychological observations (psychologyData) plus internal
   * notes are NEVER exposed here — only summary and recommendations.
   */
  async getChildCounseling(parentId: string, studentId: string) {
    await this.verifyParentAccess(parentId, studentId);

    const sessions = await prisma.counselingSession.findMany({
      where: {
        studentId,
        OR: [{ parentNotified: true }, { isConfidential: false }],
      },
      orderBy: { scheduledAt: 'desc' },
      take: 30,
      select: {
        id: true,
        scheduledAt: true,
        status: true,
        summary: true,
        recommendations: true,
        counselor: {
          select: { user: { select: { name: true } } },
        },
      },
    });

    return sessions.map((session) => ({
      id: session.id,
      scheduledAt: session.scheduledAt,
      status: session.status,
      summary: session.summary,
      recommendations: session.recommendations,
      counselorName: session.counselor?.user?.name ?? null,
    }));
  }

  /**
   * Get child violations
   */
  async getChildViolations(parentId: string, studentId: string) {
    await this.verifyParentAccess(parentId, studentId);

    const violations = await prisma.violation.findMany({
      where: { studentId },
      orderBy: { occurredAt: 'desc' },
      take: 50,
    });

    const summary = await prisma.violation.aggregate({
      where: { studentId },
      _sum: { points: true },
      _count: { id: true },
    });

    const byType = await prisma.violation.groupBy({
      by: ['type'],
      where: { studentId },
      _count: { id: true },
      _sum: { points: true },
    });

    return {
      violations,
      summary: {
        totalViolations: summary._count.id,
        totalPoints: summary._sum.points || 0,
        byType,
      },
    };
  }

  /**
   * Get child rewards
   */
  async getChildRewards(parentId: string, studentId: string) {
    await this.verifyParentAccess(parentId, studentId);

    const rewards = await prisma.reward.findMany({
      where: { studentId },
      orderBy: { givenAt: 'desc' },
      take: 50,
    });

    const summary = await prisma.reward.aggregate({
      where: { studentId },
      _sum: { points: true },
      _count: { id: true },
    });

    const byCategory = await prisma.reward.groupBy({
      by: ['category'],
      where: { studentId },
      _count: { id: true },
      _sum: { points: true },
    });

    return {
      rewards,
      summary: {
        totalRewards: summary._count.id,
        totalPoints: summary._sum.points || 0,
        byCategory,
      },
    };
  }

  /**
   * Get child health records
   */
  async getChildHealth(parentId: string, studentId: string) {
    await this.verifyParentAccess(parentId, studentId);

    const records = await prisma.medicalRecord.findMany({
      where: { studentId },
      include: {
        recordedBy: {
          select: {
            name: true,
          },
        },
      },
      orderBy: { visitDate: 'desc' },
      take: 20,
    });

    const summary = await prisma.medicalRecord.groupBy({
      by: ['type'],
      where: { studentId },
      _count: { id: true },
    });

    return {
      records,
      summary,
    };
  }

  /**
   * Get notifications for parent
   */
  async getNotifications(
    parentId: string,
    query: { status?: string; page?: number; limit?: number }
  ) {
    const page = query.page || 1;
    const limit = query.limit || 20;

    const where: Prisma.NotificationWhereInput = { userId: parentId };
    if (query.status) {
      where.status = query.status as Prisma.NotificationWhereInput['status'];
    }

    const [notifications, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({
        where: { userId: parentId, status: 'UNREAD' },
      }),
    ]);

    return {
      notifications,
      unreadCount,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Mark notification as read
   */
  async markNotificationRead(parentId: string, notificationId: string) {
    const notification = await prisma.notification.findFirst({
      where: { id: notificationId, userId: parentId },
    });

    if (!notification) {
      throw new ApiError(ErrorCode.NOT_FOUND, 'Notifikasi tidak ditemukan');
    }

    return prisma.notification.update({
      where: { id: notificationId },
      data: {
        status: 'READ',
        readAt: new Date(),
      },
    });
  }

  /**
   * Get parent dashboard summary
   */
  async getDashboardSummary(parentId: string) {
    const children = await this.getChildren(parentId);
    const childrenIds = children.map((c) => c.id);

    // If no children, return empty early
    if (childrenIds.length === 0) {
      // Get unread notifications
      const unreadNotifications = await prisma.notification.count({
        where: { userId: parentId, status: 'UNREAD' },
      });

      return {
        children: [],
        unreadNotifications,
        recentAnnouncements: [],
      };
    }

    // 1. Bulk fetch attendance (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const allAttendances = await prisma.attendance.findMany({
      where: {
        studentId: { in: childrenIds },
        date: { gte: thirtyDaysAgo },
      },
      orderBy: { date: 'desc' },
    });

    // 2. Bulk count pending invoices
    const pendingInvoices = await prisma.invoice.groupBy({
      by: ['studentId'],
      where: {
        studentId: { in: childrenIds },
        status: { in: ['PENDING', 'PARTIAL', 'OVERDUE'] },
      },
      _count: { id: true },
    });

    // 3. Bulk count active permits
    const activePermits = await prisma.permit.groupBy({
      by: ['studentId'],
      where: {
        studentId: { in: childrenIds },
        status: { in: ['PENDING', 'APPROVED'] },
        endDate: { gte: new Date() },
      },
      _count: { id: true },
    });

    // 4. Bulk fetch recent tahfidz (last one per student)
    const lastTahfidzRecords = await prisma.tahfidzRecord.findMany({
      where: {
        studentId: { in: childrenIds },
      },
      distinct: ['studentId'],
      orderBy: [{ studentId: 'asc' }, { recordedAt: 'desc' }],
    });

    // 5. Bulk fetch active academic years for all units involved
    // AcademicYear is global (not scoped by unit), so just fetch active years.
    const activeYears = await prisma.academicYear.findMany({
      where: { isActive: true },
    });

    // 6. Bulk fetch room assignments
    const roomAssignments = await prisma.roomAssignment.findMany({
      where: { studentId: { in: childrenIds }, isActive: true },
      select: { studentId: true, roomId: true },
    });

    // 7. Batch fetch average academic grade per student for their active year
    const activeYearIds = activeYears.map((ay) => ay.id);
    const studentGradeScores = await prisma.grade.groupBy({
      by: ['studentId'],
      where: { studentId: { in: childrenIds }, academicYearId: { in: activeYearIds } },
      _avg: { percentage: true },
    });

    // 8. Batch fetch total violation points per student
    const studentViolationPoints = await prisma.violation.groupBy({
      by: ['studentId'],
      where: { studentId: { in: childrenIds } },
      _sum: { points: true },
    });

    // 9. Fetch room social analytics once per unique room (avoid N+1)
    const uniqueRoomIds = [...new Set(roomAssignments.map((ra) => ra.roomId))];
    const roomAnalyticsEntries = await Promise.all(
      uniqueRoomIds.map(async (roomId) => {
        const analytics = await DormitoryService.getRoomSocialAnalytics(roomId);
        return [roomId, analytics] as const;
      })
    );
    const roomAnalyticsMap = new Map(roomAnalyticsEntries);

    // Map data back to children (synchronous now – no per-child DB calls)
    const summary = children.map((child) => {
      // Filter recent attendance for this child, take 7
      const recentAttendance = allAttendances.filter((a) => a.studentId === child.id).slice(0, 7);

      const pendingInvoiceCount =
        pendingInvoices.find((p) => p.studentId === child.id)?._count.id || 0;

      const activePermitCount = activePermits.find((p) => p.studentId === child.id)?._count.id || 0;

      const lastTahfidz = lastTahfidzRecords.find((t) => t.studentId === child.id);

      // Compute holistic score from bulk-fetched data (academic + behavior + tahfidz)
      const gradeAvg = studentGradeScores.find((g) => g.studentId === child.id)?._avg.percentage;
      const violationPts = Number(
        studentViolationPoints.find((v) => v.studentId === child.id)?._sum.points || 0
      );
      const academicScore = gradeAvg != null ? Number(gradeAvg) : null;
      const behaviorScore = Math.max(0, 100 - violationPts);
      const maxJuz = lastTahfidz?.juz || 0;
      const tahfidzScore = maxJuz > 0 ? Math.min(100, (maxJuz / 30) * 100) : null;
      const holisticDims = [academicScore, tahfidzScore, behaviorScore].filter(
        (d): d is number => d !== null
      );
      const holisticScore =
        holisticDims.length > 0
          ? holisticDims.reduce((sum, d) => sum + d, 0) / holisticDims.length
          : null;

      // Boarding harmony from deduplicated room analytics map
      const assignment = roomAssignments.find((ra) => ra.studentId === child.id);
      const boardingHarmony = assignment ? (roomAnalyticsMap.get(assignment.roomId) ?? null) : null;

      return {
        child,
        recentAttendance,
        pendingInvoices: pendingInvoiceCount,
        activePermits: activePermitCount,
        lastTahfidz: lastTahfidz || null,
        holisticScore: holisticScore !== null ? Math.round(holisticScore * 10) / 10 : null,
        holisticInterpretation: null,
        boardingHarmonyScore: boardingHarmony?.harmonyScore ?? null,
      };
    });

    // Get unread notifications
    const unreadNotifications = await prisma.notification.count({
      where: { userId: parentId, status: 'UNREAD' },
    });

    // The same rule as the board: what is addressed to this wali — the
    // yayasan's, their children's units', classes' and kamar's — live now.
    const recentAnnouncements = (
      await announcementsAddressedTo({ sub: parentId, roleCode: null, unitId: null }, 5)
    ).map((a) => ({
      id: a.id,
      title: a.title,
      content: a.content,
      createdAt: a.publishedAt ?? a.createdAt,
      priority: a.priority,
    }));

    return {
      children: summary,
      unreadNotifications,
      recentAnnouncements,
    };
  }
}

export const parentService = new ParentService();
