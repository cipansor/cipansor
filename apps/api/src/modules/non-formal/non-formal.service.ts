import { prisma } from '../../lib/prisma';
import { CreateCourseInput, UpdateCourseInput, EnrollCourseInput } from './non-formal.schema';
import { Prisma } from '@prisma/client';
import { wibMonthYear } from '../../utils/wib-day';

export const courseService = {
  async findAll(unitId?: string) {
    return prisma.course.findMany({
      where: {
        ...(unitId && { unitId }),
        status: 'PUBLISHED',
      },
      include: {
        instructor: { select: { id: true, name: true } },
      },
    });
  },

  async findById(id: string) {
    return prisma.course.findUnique({
      where: { id },
      include: {
        instructor: { select: { id: true, name: true } },
        enrollments: {
          include: {
            student: { include: { user: { select: { name: true } } } },
          },
        },
      },
    });
  },

  async create(data: CreateCourseInput) {
    return prisma.course.create({
      data: {
        ...data,
        price: new Prisma.Decimal(data.price),
        startDate: data.startDate ? new Date(data.startDate) : null,
        endDate: data.endDate ? new Date(data.endDate) : null,
      } as any,
    });
  },

  async update(id: string, data: UpdateCourseInput) {
    return prisma.course.update({
      where: { id },
      data: {
        ...data,
        ...(data.price && { price: new Prisma.Decimal(data.price) }),
        ...(data.startDate && { startDate: new Date(data.startDate) }),
        ...(data.endDate && { endDate: new Date(data.endDate) }),
      } as any,
    });
  },

  async enroll(data: EnrollCourseInput) {
    return prisma.$transaction(async (tx) => {
      const course = await tx.course.findUnique({
        where: { id: data.courseId },
        include: { _count: { select: { enrollments: true } } },
      });

      if (!course) throw new Error('Course not found');
      if (course.maxParticipants != null && course._count.enrollments >= course.maxParticipants) {
        throw new Error('Kuota peserta kursus sudah penuh');
      }

      // 1. Create Enrollment
      const enrollment = await tx.courseEnrollment.create({
        data: {
          courseId: data.courseId,
          studentId: data.studentId,
          externalName: data.externalName,
          externalEmail: data.externalEmail,
          externalPhone: data.externalPhone,
          status: 'ACTIVE',
        },
      });

      // 2. Integration with Finance (Invoice)
      if (course.price.gt(0)) {
        let paymentType = await tx.paymentType.findFirst({
          where: { unitId: course.unitId, code: 'COURSE' },
        });

        if (!paymentType) {
          paymentType = await tx.paymentType.create({
            data: {
              unitId: course.unitId,
              name: 'Biaya Kursus',
              code: 'COURSE',
              amount: course.price,
              isActive: true,
            },
          });
        }

        // The WIB month, for the number and for the sequence it continues: on a
        // UTC container `getMonth()` is still the previous month between 00:00
        // and 06:59 WIB on the 1st, so the new month's first invoice took the
        // old month's prefix and sequence.
        const { year, month: m } = wibMonthYear(new Date());
        const month = String(m + 1).padStart(2, '0');
        const lastInvoice = await tx.invoice.findFirst({
          where: { invoiceNumber: { startsWith: `INV-CRS-${year}${month}` } },
          orderBy: { invoiceNumber: 'desc' },
        });
        const sequence = lastInvoice ? parseInt(lastInvoice.invoiceNumber.split('-')[3]) + 1 : 1;
        const invoiceNumber = `INV-CRS-${year}${month}-${String(sequence).padStart(5, '0')}`;

        const invoice = await tx.invoice.create({
          data: {
            invoiceNumber,
            amount: course.price,
            dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            status: 'PENDING',
            studentId: data.studentId || null,
            paymentTypeId: paymentType.id,
            notes: `Biaya pendaftaran kursus ${course.name} untuk ${data.externalName || 'Siswa Internal'}`,
          } as any,
        });

        await tx.courseEnrollment.update({
          where: { id: enrollment.id },
          data: { invoiceId: invoice.id },
        });
      }

      return enrollment;
    });
  },
};
