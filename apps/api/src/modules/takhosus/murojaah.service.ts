import { prisma } from '@/lib/prisma';
import { Prisma, MurojaahType, TahfidzMistakeType } from '@prisma/client';
import { dayDate, wibDayOf } from '@/utils/wib';
import { CreateMurojaahInput, UpdateMurojaahInput } from './takhosus.schema';

/**
 * The WIB calendar day a murojaah date names, as the `@db.Date` column holds
 * it. The form sends a full datetime whose instant can be WIB midnight — whose
 * UTC day is the day before — so storing `new Date(value)` filed an early
 * morning record under the previous day and `getQuickStats` (which counts the
 * WIB day) never saw it.
 */
function murojaahDayDate(value: string): Date {
  return dayDate(wibDayOf(new Date(value)));
}

export const murojaahService = {
  /**
   * Get all murojaah records with pagination
   */
  async findAll(params: {
    page: number;
    limit: number;
    studentId?: string;
    halaqohId?: string;
    startDate?: Date;
    endDate?: Date;
    type?: MurojaahType;
  }) {
    const { page, limit, studentId, halaqohId, startDate, endDate, type } = params;
    const skip = (page - 1) * limit;

    const where: Prisma.MurojaahRecordWhereInput = {
      ...(studentId && { studentId }),
      ...(halaqohId && { halaqohId }),
      ...(type && { murojaahType: type }),
    };

    if (startDate && endDate) {
      where.murojaahDate = {
        gte: startDate,
        lte: endDate,
      };
    } else if (startDate) {
      where.murojaahDate = { gte: startDate };
    } else if (endDate) {
      where.murojaahDate = { lte: endDate };
    }

    const [data, total] = await Promise.all([
      prisma.murojaahRecord.findMany({
        where,
        skip,
        take: limit,
        orderBy: { murojaahDate: 'desc' },
        include: {
          student: {
            include: {
              user: { select: { id: true, name: true } },
            },
          },
          halaqoh: { select: { id: true, name: true } },
          recordedBy: { select: { id: true, name: true } },
          mistakes: true,
        },
      }),
      prisma.murojaahRecord.count({ where }),
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
   * Get murojaah record by ID
   */
  async findById(id: string) {
    return prisma.murojaahRecord.findUnique({
      where: { id },
      include: {
        student: {
          include: {
            user: { select: { id: true, name: true } },
          },
        },
        halaqoh: { select: { id: true, name: true } },
        recordedBy: { select: { id: true, name: true } },
        mistakes: true,
      },
    });
  },

  /**
   * Create murojaah record
   */
  async create(input: CreateMurojaahInput, recordedById: string) {
    const { mistakes, murojaahDate, ...rest } = input;

    // Auto-resolve enrollment and halaqoh if not provided
    let enrollmentId = null;
    let halaqohId = null;

    const activeEnrollment = await prisma.takhosusEnrollment.findUnique({
      where: { studentId: input.studentId },
    });

    if (activeEnrollment) {
      enrollmentId = activeEnrollment.id;
      halaqohId = activeEnrollment.halaqohId;
    }

    const { studentId } = rest;

    return prisma.murojaahRecord.create({
      data: {
        student: { connect: { id: studentId } },
        murojaahDate: murojaahDayDate(murojaahDate),
        murojaahType: input.murojaahType as MurojaahType,
        juzStart: input.juzStart,
        juzEnd: input.juzEnd,
        pagesReviewed: input.pagesReviewed,
        durationMinutes: input.durationMinutes,
        qualityScore: input.qualityScore,
        fluencyLevel: input.fluencyLevel,
        notes: input.notes,
        recordedBy: { connect: { id: recordedById } },
        ...(enrollmentId ? { enrollment: { connect: { id: enrollmentId } } } : {}),
        ...(halaqohId ? { halaqoh: { connect: { id: halaqohId } } } : {}),
        mistakes: mistakes
          ? {
              create: mistakes.map((m) => ({
                mistakeType: m.mistakeType as TahfidzMistakeType,
                juz: m.juz,
                surahNumber: m.surahNumber,
                ayahNumber: m.ayahNumber,
                description: m.description,
              })),
            }
          : undefined,
      },
      include: {
        mistakes: true,
      },
    });
  },

  /**
   * Update murojaah record
   */
  async update(id: string, input: UpdateMurojaahInput) {
    const { mistakes, murojaahDate, ...rest } = input;
    const data: any = { ...rest };

    if (murojaahDate) {
      data.murojaahDate = murojaahDayDate(murojaahDate);
    }

    if (input.murojaahType) {
      data.murojaahType = input.murojaahType as MurojaahType;
    }

    // Handle mistakes update if provided (replace all)
    if (mistakes) {
      // First delete existing mistakes
      await prisma.murojaahMistake.deleteMany({
        where: { murojaahId: id },
      });

      // Then create new ones
      data.mistakes = {
        create: mistakes.map((m) => ({
          mistakeType: m.mistakeType as TahfidzMistakeType,
          juz: m.juz,
          surahNumber: m.surahNumber,
          ayahNumber: m.ayahNumber,
          description: m.description,
        })),
      };
    }

    return prisma.murojaahRecord.update({
      where: { id },
      data,
      include: {
        mistakes: true,
      },
    });
  },

  /**
   * Delete murojaah record
   */
  async delete(id: string) {
    return prisma.murojaahRecord.delete({
      where: { id },
    });
  },

  /**
   * Add a single mistake to a record
   */
  async addMistake(murojaahId: string, mistake: any) {
    return prisma.murojaahMistake.create({
      data: {
        murojaahId,
        mistakeType: mistake.mistakeType as TahfidzMistakeType,
        juz: mistake.juz,
        surahNumber: mistake.surahNumber,
        ayahNumber: mistake.ayahNumber,
        description: mistake.description,
      },
    });
  },

  /**
   * Delete a mistake
   */
  async deleteMistake(mistakeId: string) {
    return prisma.murojaahMistake.delete({
      where: { id: mistakeId },
    });
  },
};
