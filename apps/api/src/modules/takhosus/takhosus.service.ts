import { prisma } from '@/lib/prisma';
import { Prisma, TakhosusStatus, HalaqohDay } from '@prisma/client';
import {
  assertStudentInScope,
  onlyScopedStudents,
  studentScope,
  type ScopeActor,
} from '@/utils/student-scope';
import {
  CreateHalaqohInput,
  UpdateHalaqohInput,
  CreateEnrollmentInput,
  UpdateEnrollmentInput,
  CreateSanadInput,
  UpdateSanadInput,
} from './takhosus.schema';
import { targetService } from './target.service';

// =====================================
// HALAQOH SERVICE
// =====================================

export const halaqohService = {
  /**
   * Get all halaqoh with pagination
   */
  async findAll(params: {
    page: number;
    limit: number;
    unitId?: string;
    teacherId?: string;
    isActive?: boolean;
    level?: number;
  }) {
    const { page, limit, unitId, teacherId, isActive, level } = params;
    const skip = (page - 1) * limit;

    const where = {
      deletedAt: null,
      ...(unitId && { unitId }),
      ...(teacherId && { teacherId }),
      ...(isActive !== undefined && { isActive }),
      ...(level && { level }),
    };

    const [data, total] = await Promise.all([
      prisma.halaqoh.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          unit: { select: { id: true, name: true } },
          teacher: { select: { id: true, name: true } },
          _count: { select: { enrollments: true } },
        },
      }),
      prisma.halaqoh.count({ where }),
    ]);

    return {
      data: data.map((h) => ({
        ...h,
        studentCount: h._count.enrollments,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  },

  /**
   * Get halaqoh by ID
   */
  async findById(id: string) {
    return prisma.halaqoh.findUnique({
      where: { id },
      include: {
        unit: { select: { id: true, name: true } },
        teacher: { select: { id: true, name: true, email: true } },
        enrollments: {
          where: { status: 'ACTIVE' },
          include: {
            student: {
              include: {
                user: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });
  },

  /**
   * Create halaqoh
   */
  async create(input: CreateHalaqohInput) {
    return prisma.halaqoh.create({
      data: {
        ...input,
        scheduleDay: input.scheduleDay as HalaqohDay[],
      } as any,
      include: {
        unit: { select: { id: true, name: true } },
        teacher: { select: { id: true, name: true } },
      },
    });
  },

  /**
   * Update halaqoh
   */
  async update(id: string, input: UpdateHalaqohInput) {
    return prisma.halaqoh.update({
      where: { id },
      // input is a validated UpdateHalaqohInput (zod); cast to the Prisma
      // update shape (scheduleDay normalised to the enum array).
      data: {
        ...input,
        ...(input.scheduleDay && { scheduleDay: input.scheduleDay as HalaqohDay[] }),
      } as Prisma.HalaqohUpdateInput,
      include: {
        unit: { select: { id: true, name: true } },
        teacher: { select: { id: true, name: true } },
      },
    });
  },

  /**
   * Soft delete halaqoh
   */
  async delete(id: string) {
    return prisma.halaqoh.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  },
};

// =====================================
// ENROLLMENT SERVICE
// =====================================

/**
 * The takhosus enrolments a reader may see: only the santri inside the
 * caller's Cakupan_Santri (`studentScope`), whatever `studentId` or
 * `halaqohId` the request names — those narrow inside the scope, never widen
 * it (R27.7). The list and its metadata count both use this `where`.
 */
export function takhosusEnrollmentWhere(
  actor: ScopeActor,
  filters: { halaqohId?: string; status?: string; studentId?: string } = {}
): Prisma.TakhosusEnrollmentWhereInput {
  const { halaqohId, status, studentId } = filters;
  return {
    ...onlyScopedStudents(studentScope(actor)),
    ...(halaqohId && { halaqohId }),
    ...(status && { status: status as TakhosusStatus }),
    ...(studentId && { studentId }),
  };
}

export const enrollmentService = {
  /**
   * Get all enrollments with pagination
   */
  async findAll(params: {
    page: number;
    limit: number;
    actor: ScopeActor;
    halaqohId?: string;
    status?: string;
    studentId?: string;
  }) {
    const { page, limit, actor, halaqohId, status, studentId } = params;
    const skip = (page - 1) * limit;

    // Only the santri the caller reaches, whatever `studentId`/`halaqohId` ask
    // for; the count below is over the same set (R27.7).
    const where = takhosusEnrollmentWhere(actor, { halaqohId, status, studentId });

    const [data, total] = await Promise.all([
      prisma.takhosusEnrollment.findMany({
        where,
        skip,
        take: limit,
        orderBy: { enrolledAt: 'desc' },
        include: {
          student: {
            include: {
              user: { select: { id: true, name: true } },
              unit: { select: { id: true, name: true } },
            },
          },
          halaqoh: {
            select: { id: true, name: true, code: true },
          },
          _count: { select: { sanadRecords: true } },
        },
      }),
      prisma.takhosusEnrollment.count({ where }),
    ]);

    // OPTIMIZATION: Bulk fetch targets and progress to avoid N+1 queries
    const studentIds = data.map((e) => e.studentId);

    // 1. Get active academic year
    const activeYear = await prisma.academicYear.findFirst({ where: { isActive: true } });

    // 2. Bulk fetch targets
    const targets = activeYear
      ? await prisma.tahfidzTarget.findMany({
          where: {
            studentId: { in: studentIds },
            academicYearId: activeYear.id,
          },
        })
      : [];

    // 3. Bulk fetch completed juz counts (distinct juz with score >= 60)
    // Note: Prisma doesn't support complex distinct count in groupBy easily, so we use findMany with distinct
    const completedJuzRecords = await prisma.tahfidzRecord.findMany({
      where: {
        studentId: { in: studentIds },
        activityType: { in: ['ASSESSMENT', 'TASMI'] },
        score: { gte: 60 },
      },
      select: { studentId: true, juz: true },
      distinct: ['studentId', 'juz'],
    });

    return {
      data: data.map((e) => {
        const target = targets.find((t) => t.studentId === e.studentId);
        const completedJuzCount = completedJuzRecords.filter(
          (r) => r.studentId === e.studentId
        ).length;

        // Use live target if available, otherwise fallback to enrollment data
        const finalTargetJuz = target?.targetJuz ?? e.targetJuz;
        // Use live completed count
        const finalCompletedJuz = completedJuzCount; // Prefer calculation over stored value in enrollment for accuracy

        const progressPercentage = Math.min(
          100,
          Math.round((finalCompletedJuz / finalTargetJuz) * 100)
        );
        const isOnTrack = finalCompletedJuz >= finalTargetJuz;

        return {
          ...e,
          sanadCount: e._count.sanadRecords,
          progressPercentage,
          targetJuz: finalTargetJuz,
          completedJuz: finalCompletedJuz,
          isOnTrack,
        };
      }),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  },

  /**
   * Get enrollment by ID
   */
  async findById(id: string) {
    return prisma.takhosusEnrollment.findUnique({
      where: { id },
      include: {
        student: {
          include: {
            user: { select: { id: true, name: true, email: true } },
            unit: { select: { id: true, name: true } },
          },
        },
        halaqoh: {
          include: {
            teacher: { select: { id: true, name: true } },
          },
        },
        sanadRecords: {
          include: {
            teacher: { select: { id: true, name: true } },
          },
          orderBy: { juz: 'asc' },
        },
      },
    });
  },

  /**
   * Get enrollment by student ID
   */
  async findByStudentId(studentId: string) {
    return prisma.takhosusEnrollment.findUnique({
      where: { studentId },
      include: {
        student: {
          include: {
            user: { select: { id: true, name: true } },
          },
        },
        halaqoh: {
          include: {
            teacher: { select: { id: true, name: true } },
          },
        },
        sanadRecords: {
          include: {
            teacher: { select: { id: true, name: true } },
          },
          orderBy: { juz: 'asc' },
        },
      },
    });
  },

  /**
   * Create enrollment
   */
  async create(input: CreateEnrollmentInput) {
    // Check if student already enrolled
    const existing = await prisma.takhosusEnrollment.findUnique({
      where: { studentId: input.studentId },
    });

    if (existing) {
      throw new Error('Student is already enrolled in Takhosus program');
    }

    return prisma.takhosusEnrollment.create({
      data: {
        ...input,
        targetCompletionDate: input.targetCompletionDate
          ? new Date(input.targetCompletionDate)
          : undefined,
      } as any,
      include: {
        student: {
          include: {
            user: { select: { id: true, name: true } },
          },
        },
        halaqoh: { select: { id: true, name: true } },
      },
    });
  },

  /**
   * Update enrollment
   */
  async update(id: string, input: UpdateEnrollmentInput) {
    const data: any = { ...input };

    if (input.targetCompletionDate) {
      data.targetCompletionDate = new Date(input.targetCompletionDate);
    }

    if (input.status === 'COMPLETED' && !data.completedAt) {
      data.completedAt = new Date();
    }

    return prisma.takhosusEnrollment.update({
      where: { id },
      data,
      include: {
        student: {
          include: {
            user: { select: { id: true, name: true } },
          },
        },
        halaqoh: { select: { id: true, name: true } },
      },
    });
  },

  /**
   * Delete enrollment
   */
  async delete(id: string) {
    return prisma.takhosusEnrollment.delete({
      where: { id },
    });
  },

  /**
   * Get enrollment statistics
   */
  async getStats(unitId?: string) {
    const where = unitId ? { student: { unitId } } : {};

    const [total, active, completed, dropped] = await Promise.all([
      prisma.takhosusEnrollment.count({ where }),
      prisma.takhosusEnrollment.count({ where: { ...where, status: 'ACTIVE' } }),
      prisma.takhosusEnrollment.count({ where: { ...where, status: 'COMPLETED' } }),
      prisma.takhosusEnrollment.count({ where: { ...where, status: 'DROPPED' } }),
    ]);

    // Get average progress
    const avgProgress = await prisma.takhosusEnrollment.aggregate({
      where: { ...where, status: 'ACTIVE' },
      _avg: { completedJuz: true },
    });

    return {
      total,
      active,
      completed,
      dropped,
      averageProgress: Math.round(((avgProgress._avg.completedJuz || 0) / 30) * 100),
    };
  },
};

// =====================================
// SANAD SERVICE
// =====================================

export const sanadService = {
  /**
   * Get all sanad records with pagination
   */
  async findAll(params: {
    page: number;
    limit: number;
    enrollmentId?: string;
    teacherId?: string;
    studentId?: string;
  }) {
    const { page, limit, enrollmentId, teacherId, studentId } = params;
    const skip = (page - 1) * limit;

    const where = {
      ...(enrollmentId && { enrollmentId }),
      ...(teacherId && { teacherId }),
      ...(studentId && { enrollment: { studentId } }),
    };

    const [data, total] = await Promise.all([
      prisma.sanadRecord.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ enrollmentId: 'asc' }, { juz: 'asc' }],
        include: {
          enrollment: {
            include: {
              student: {
                include: {
                  user: { select: { id: true, name: true } },
                },
              },
            },
          },
          teacher: { select: { id: true, name: true } },
        },
      }),
      prisma.sanadRecord.count({ where }),
    ]);

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  },

  /**
   * Get sanad by ID
   */
  async findById(id: string) {
    return prisma.sanadRecord.findUnique({
      where: { id },
      include: {
        enrollment: {
          include: {
            student: {
              include: {
                user: { select: { id: true, name: true } },
              },
            },
          },
        },
        teacher: { select: { id: true, name: true, email: true } },
      },
    });
  },

  /**
   * Create sanad record
   */
  async create(input: CreateSanadInput) {
    // Wrap sanad creation and enrollment progress update in a single transaction
    // to prevent race conditions with concurrent simaanService.updateResult calls
    // and to ensure the uniqueness check is consistent with the create.
    const sanad = await prisma.$transaction(async (tx) => {
      // Check if sanad for this juz already exists (inside transaction to prevent TOCTOU race)
      const existing = await tx.sanadRecord.findUnique({
        where: {
          enrollmentId_juz: {
            enrollmentId: input.enrollmentId,
            juz: input.juz,
          },
        },
      });

      if (existing) {
        throw new Error(`Sanad for Juz ${input.juz} already exists`);
      }

      const created = await tx.sanadRecord.create({
        data: {
          ...input,
          certifiedAt: input.certifiedAt ? new Date(input.certifiedAt) : new Date(),
        } as any,
        include: {
          enrollment: {
            include: {
              student: {
                include: { user: { select: { name: true } } },
              },
              halaqoh: { select: { name: true } },
            },
          },
          teacher: { select: { id: true, name: true } },
        },
      });

      // Update enrollment progress within the same transaction
      const enrollmentId = input.enrollmentId;
      const sanadCount = await tx.sanadRecord.count({
        where: { enrollmentId },
      });

      const enrollment = await tx.takhosusEnrollment.findUnique({
        where: { id: enrollmentId },
      });

      if (enrollment) {
        let completedJuz = sanadCount;
        if (enrollment.status === 'COMPLETED' && enrollment.completedJuz > sanadCount) {
          const has30JuzSimaan = await tx.simaanExam.findFirst({
            where: {
              studentId: enrollment.studentId,
              passed: true,
              juzStart: 1,
              juzEnd: 30,
            },
            select: { id: true },
          });
          if (has30JuzSimaan) {
            completedJuz = Math.max(sanadCount, enrollment.completedJuz);
          }
        }

        const shouldAutoComplete =
          enrollment.status === 'ACTIVE' && completedJuz >= enrollment.targetJuz;
        const status = shouldAutoComplete ? 'COMPLETED' : enrollment.status;

        await tx.takhosusEnrollment.update({
          where: { id: enrollmentId },
          data: {
            completedJuz,
            status,
            ...(shouldAutoComplete && !enrollment.completedAt && { completedAt: new Date() }),
          },
        });
      }

      return created;
    });

    // Emit event for RaporPesantren integration (fire-and-forget, outside transaction)
    import('@/lib/event-bus')
      .then(({ eventBus }) => {
        eventBus.emit('takhosus:sanad_assessed', {
          studentId: sanad.enrollment.studentId,
          studentName: sanad.enrollment.student.user?.name || 'Unknown',
          halaqohName: sanad.enrollment.halaqoh?.name ?? 'Unknown',
          juz: sanad.juz,
          grade: sanad.grade,
          certifiedAt: sanad.certifiedAt,
        });
      })
      .catch(console.error);

    // Certificate eligibility check: if certain juz count reached
    await this.checkCertificateEligibility(sanad.enrollment.studentId);

    return sanad;
  },

  /**
   * Update sanad record
   */
  async update(id: string, input: UpdateSanadInput) {
    // Wrap update and enrollment progress recalculation in a single transaction
    // for consistency with create/delete. UpdateSanadInput allows changing `juz`,
    // which can affect enrollment progress (completedJuz / auto-completion).
    const sanad = await prisma.$transaction(async (tx) => {
      const updated = await tx.sanadRecord.update({
        where: { id },
        data: {
          ...input,
          ...(input.certifiedAt && { certifiedAt: new Date(input.certifiedAt) }),
        },
        include: {
          enrollment: {
            include: {
              student: {
                include: { user: { select: { name: true } } },
              },
              halaqoh: { select: { name: true } },
            },
          },
          teacher: { select: { id: true, name: true } },
        },
      });

      // Inline enrollment progress update within the transaction
      const enrollmentId = updated.enrollmentId;
      const sanadCount = await tx.sanadRecord.count({
        where: { enrollmentId },
      });

      const enrollment = await tx.takhosusEnrollment.findUnique({
        where: { id: enrollmentId },
      });

      if (enrollment) {
        let completedJuz = sanadCount;
        if (enrollment.status === 'COMPLETED' && enrollment.completedJuz > sanadCount) {
          const has30JuzSimaan = await tx.simaanExam.findFirst({
            where: {
              studentId: enrollment.studentId,
              passed: true,
              juzStart: 1,
              juzEnd: 30,
            },
            select: { id: true },
          });
          if (has30JuzSimaan) {
            completedJuz = Math.max(sanadCount, enrollment.completedJuz);
          }
        }

        const shouldAutoComplete =
          enrollment.status === 'ACTIVE' && completedJuz >= enrollment.targetJuz;
        const status = shouldAutoComplete ? 'COMPLETED' : enrollment.status;

        await tx.takhosusEnrollment.update({
          where: { id: enrollmentId },
          data: {
            completedJuz,
            status,
            ...(shouldAutoComplete && !enrollment.completedAt && { completedAt: new Date() }),
          },
        });
      }

      return updated;
    });

    // Emit event for RaporPesantren integration (fire-and-forget, outside transaction)
    import('@/lib/event-bus')
      .then(({ eventBus }) => {
        eventBus.emit('takhosus:sanad_assessed', {
          studentId: sanad.enrollment.studentId,
          studentName: sanad.enrollment.student.user?.name || 'Unknown',
          halaqohName: sanad.enrollment.halaqoh?.name ?? 'Unknown',
          juz: sanad.juz,
          grade: sanad.grade,
          certifiedAt: sanad.certifiedAt,
        });
      })
      .catch(console.error);

    return sanad;
  },

  /**
   * Delete sanad record
   */
  async delete(id: string) {
    // Wrap delete and enrollment progress update in a single transaction
    // to prevent race conditions with concurrent simaan grading.
    const sanad = await prisma.$transaction(async (tx) => {
      const deleted = await tx.sanadRecord.delete({
        where: { id },
      });

      const enrollmentId = deleted.enrollmentId;
      const sanadCount = await tx.sanadRecord.count({
        where: { enrollmentId },
      });

      const enrollment = await tx.takhosusEnrollment.findUnique({
        where: { id: enrollmentId },
      });

      if (enrollment) {
        let completedJuz = sanadCount;
        let status: string = enrollment.status;

        // Check once whether a passed 30-juz simaan justifies the COMPLETED state
        const has30JuzSimaan =
          enrollment.status === 'COMPLETED'
            ? await tx.simaanExam.findFirst({
                where: {
                  studentId: enrollment.studentId,
                  passed: true,
                  juzStart: 1,
                  juzEnd: 30,
                },
                select: { id: true },
              })
            : null;

        if (enrollment.status === 'COMPLETED' && enrollment.completedJuz > sanadCount) {
          if (has30JuzSimaan) {
            completedJuz = Math.max(sanadCount, enrollment.completedJuz);
          }
        }

        // If the enrollment was completed purely via sanad count (no simaan)
        // and the count has now dropped below the target, revert to ACTIVE.
        if (enrollment.status === 'COMPLETED' && completedJuz < enrollment.targetJuz) {
          if (!has30JuzSimaan) {
            status = 'ACTIVE';
          }
        }

        const shouldAutoComplete =
          enrollment.status === 'ACTIVE' && completedJuz >= enrollment.targetJuz;
        if (shouldAutoComplete) {
          status = 'COMPLETED';
        }

        await tx.takhosusEnrollment.update({
          where: { id: enrollmentId },
          data: {
            completedJuz,
            status: status as TakhosusStatus,
            ...(shouldAutoComplete && !enrollment.completedAt && { completedAt: new Date() }),
            ...(status === 'ACTIVE' && enrollment.status === 'COMPLETED' && { completedAt: null }),
          },
        });
      }

      return deleted;
    });

    return sanad;
  },

  /**
   * Check tahfidz milestones for a student and notify staff when the student
   * becomes eligible for a certificate that has not yet been issued.
   *
   * We deliberately notify rather than auto-issue: a DigitalCertificate needs a
   * signatory, QR/verification code, and an issuing user — context this
   * progress hook does not have. Staff issue the certificate from the
   * certificate module after the notification.
   */
  async checkCertificateEligibility(studentId: string) {
    const enrollment = await prisma.takhosusEnrollment.findUnique({
      where: { studentId },
      include: {
        sanadRecords: { select: { juz: true } },
        student: { select: { unitId: true, user: { select: { name: true } } } },
      },
    });

    if (!enrollment) return;

    const count = enrollment.sanadRecords.length;
    const hasJuzAmma = enrollment.sanadRecords.some((s) => s.juz === 30);
    const studentName = enrollment.student.user?.name ?? 'Santri';

    // Check all milestones (don't stop at the highest) so lower milestones are
    // also flagged when a higher one is reached.
    const targets = [
      { type: 'TAHFIDZ_30_JUZ', title: 'Hafidz 30 Juz', eligible: count >= 30 },
      { type: 'TAHFIDZ_10_JUZ', title: 'Hafidz 10 Juz', eligible: count >= 10 },
      { type: 'TAHFIDZ_5_JUZ', title: 'Hafidz 5 Juz', eligible: count >= 5 },
      { type: 'TAHFIDZ_JUZ_AMMA', title: 'Hafidz Juz Amma', eligible: hasJuzAmma },
    ];

    const eligibleTargets = targets.filter((t) => t.eligible);
    if (eligibleTargets.length === 0) return;

    const { eventBus } = await import('@/lib/event-bus');

    for (const target of eligibleTargets) {
      const existing = await prisma.digitalCertificate.findFirst({
        where: { studentId, certificateType: target.type },
        select: { id: true },
      });
      if (existing) continue;

      eventBus.emit('notification:send', {
        unitId: enrollment.student.unitId,
        broadcast: true,
        type: 'ACHIEVEMENT',
        title: 'Santri Berhak Menerima Sertifikat',
        message: `${studentName} telah memenuhi syarat sertifikat "${target.title}". Silakan terbitkan sertifikat tahfidz.`,
        data: { studentId, certificateType: target.type },
      });
    }
  },
};

// =====================================
// PROGRESS SERVICE
// =====================================

export const progressService = {
  /**
   * Get student's takhosus progress. A santri outside the caller's
   * Cakupan_Santri is answered 404, the same as one that does not exist
   * (R27.6). `actor` is required: a caller that forgets it must not silently
   * skip the scope check.
   */
  async getStudentProgress(studentId: string, actor: ScopeActor) {
    await assertStudentInScope(studentId, actor);

    const enrollment = await prisma.takhosusEnrollment.findUnique({
      where: { studentId },
      include: {
        student: {
          include: {
            user: { select: { id: true, name: true } },
          },
        },
        halaqoh: {
          include: {
            teacher: { select: { id: true, name: true } },
          },
        },
        sanadRecords: {
          include: {
            teacher: { select: { id: true, name: true } },
          },
          orderBy: { juz: 'asc' },
        },
      },
    });

    if (!enrollment) {
      return null;
    }

    // Get tahfidz records for this student
    const tahfidzRecords = await prisma.tahfidzRecord.findMany({
      where: { studentId },
      orderBy: { recordedAt: 'desc' },
      take: 10,
    });

    // Get Target Info
    const targetInfo = await targetService.getProgress(studentId);

    // Calculate progress by juz
    const juzProgress = Array.from({ length: 30 }, (_, i) => {
      const juz = i + 1;
      const sanad = enrollment.sanadRecords.find((s) => s.juz === juz);
      return {
        juz,
        certified: !!sanad,
        certifiedAt: sanad?.certifiedAt,
        grade: sanad?.grade,
        teacherName: sanad?.teacher.name,
      };
    });

    return {
      enrollment: {
        id: enrollment.id,
        status: enrollment.status,
        enrolledAt: enrollment.enrolledAt,
        targetJuz: enrollment.targetJuz,
        completedJuz: enrollment.completedJuz,
        currentJuz: enrollment.currentJuz,
        progressPercentage: Math.round((enrollment.completedJuz / enrollment.targetJuz) * 100),
        targetCompletionDate: enrollment.targetCompletionDate,
        completedAt: enrollment.completedAt,
      },
      target: targetInfo,
      student: enrollment.student,
      halaqoh: enrollment.halaqoh,
      juzProgress,
      recentActivity: tahfidzRecords.map((r) => ({
        id: r.id,
        type: r.activityType,
        surah: r.surahName,
        ayahStart: r.ayahStart,
        ayahEnd: r.ayahEnd,
        juz: r.juz,
        score: r.score,
        recordedAt: r.recordedAt,
      })),
    };
  },

  /**
   * Get halaqoh progress summary
   */
  async getHalaqohProgress(halaqohId: string) {
    const halaqoh = await prisma.halaqoh.findUnique({
      where: { id: halaqohId },
      include: {
        teacher: { select: { id: true, name: true } },
        enrollments: {
          where: { status: 'ACTIVE' },
          include: {
            student: {
              include: {
                user: { select: { id: true, name: true } },
              },
            },
            sanadRecords: true,
          },
        },
      },
    });

    if (!halaqoh) {
      return null;
    }

    const students = halaqoh.enrollments.map((e) => ({
      id: e.student.id,
      name: e.student.user.name,
      enrolledAt: e.enrolledAt,
      targetJuz: e.targetJuz,
      completedJuz: e.completedJuz,
      currentJuz: e.currentJuz,
      progressPercentage: Math.round((e.completedJuz / e.targetJuz) * 100),
      sanadCount: e.sanadRecords.length,
    }));

    const totalProgress = students.reduce((acc, s) => acc + s.progressPercentage, 0);
    const averageProgress = students.length > 0 ? Math.round(totalProgress / students.length) : 0;

    return {
      halaqoh: {
        id: halaqoh.id,
        name: halaqoh.name,
        code: halaqoh.code,
        level: halaqoh.level,
        scheduleDay: halaqoh.scheduleDay,
        scheduleTime: halaqoh.scheduleTime,
        location: halaqoh.location,
      },
      teacher: halaqoh.teacher,
      studentCount: students.length,
      averageProgress,
      students: students.sort((a, b) => b.progressPercentage - a.progressPercentage),
    };
  },
};

// =====================================
// DASHBOARD SERVICE
// =====================================

export const dashboardService = {
  async getStats(unitId?: string) {
    const enrollmentWhere = {
      ...(unitId && { student: { unitId } }),
      status: 'ACTIVE' as TakhosusStatus,
    };

    const halaqohWhere = {
      ...(unitId && { unitId }),
      isActive: true,
    };

    const [
      totalActiveStudents,
      totalHalaqohs,
      totalSanads,
      progressAgg,
      recentSanads,
      topHalaqohs,
    ] = await Promise.all([
      prisma.takhosusEnrollment.count({ where: enrollmentWhere }),
      prisma.halaqoh.count({ where: halaqohWhere }),
      prisma.sanadRecord.count({
        where: unitId ? { enrollment: { student: { unitId } } } : {},
      }),
      prisma.takhosusEnrollment.aggregate({
        where: enrollmentWhere,
        _sum: { completedJuz: true },
        _avg: { completedJuz: true },
      }),
      prisma.sanadRecord.findMany({
        where: unitId ? { enrollment: { student: { unitId } } } : {},
        take: 5,
        orderBy: { certifiedAt: 'desc' },
        include: {
          enrollment: {
            include: {
              student: {
                include: { user: { select: { name: true } } },
              },
            },
          },
        },
      }),
      prisma.halaqoh.findMany({
        where: halaqohWhere,
        take: 5,
        include: {
          enrollments: {
            // Halaqoh.enrollments adalah TakhosusEnrollment, yang statusnya enum
            // Prisma `TakhosusStatus` — huruf besar di sini BENAR. Nama relasi
            // `enrollments` dimiliki tujuh model dengan enam tipe berbeda, jadi
            // namanya sendiri tidak pernah cukup untuk menentukan kosakatanya.
            where: { status: 'ACTIVE' as TakhosusStatus },
            select: { completedJuz: true },
          },
          teacher: { select: { name: true } },
        },
      }),
    ]);

    // Process top halaqohs by avg progress
    const halaqohPerformance = topHalaqohs
      .map((h) => {
        const totalJuz = h.enrollments.reduce((sum, e) => sum + e.completedJuz, 0);
        const avgJuz = h.enrollments.length > 0 ? totalJuz / h.enrollments.length : 0;
        return {
          id: h.id,
          name: h.name,
          teacherName: h.teacher.name,
          studentCount: h.enrollments.length,
          averageJuz: avgJuz,
        };
      })
      .sort((a, b) => b.averageJuz - a.averageJuz);

    return {
      activeStudents: totalActiveStudents,
      activeHalaqohs: totalHalaqohs,
      totalSanadsIssued: totalSanads,
      totalJuzMemorized: progressAgg._sum.completedJuz || 0,
      averageJuzPerStudent: progressAgg._avg.completedJuz || 0,
      recentSanads: recentSanads.map((s) => ({
        id: s.id,
        studentName: s.enrollment.student.user.name,
        juz: s.juz,
        certifiedAt: s.certifiedAt,
        grade: s.grade,
      })),
      topHalaqohs: halaqohPerformance,
    };
  },
};

export default {
  halaqoh: halaqohService,
  enrollment: enrollmentService,
  sanad: sanadService,
  progress: progressService,
  dashboard: dashboardService,
};
