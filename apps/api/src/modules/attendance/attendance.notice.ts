import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { createNotification } from '@/modules/notifications';
import { musyrifOfBoarders } from '@/modules/dormitories';
import { AttendanceStatus as PrismaAttendanceStatus } from '@prisma/client';
import { todayWib } from '@/utils/wib';

/**
 * The first tier of the attendance follow-up (decisions/absensi-harian.md):
 * the moment a pupil is marked Alpa or Terlambat on today's register, their
 * wali is told — and, for a santri mukim, their musyrif too, because a
 * boarder missing from class should be somewhere inside the pondok.
 *
 * Only a change is told: saving the day again with the same mark tells no
 * one. Only today's register is told: filling in an earlier day is record
 * keeping, not news. A notice that fails is logged; it never undoes the save.
 */

const TOLD: Partial<Record<PrismaAttendanceStatus, string>> = {
  ABSENT: 'tidak hadir tanpa keterangan (Alpa)',
  LATE: 'terlambat',
};

export interface AttendanceMark {
  studentId: string;
  status: PrismaAttendanceStatus;
  /** The mark before this save; undefined when the day had none. */
  before?: PrismaAttendanceStatus;
}

/** The marks that are news: Alpa or Terlambat, and not what was there. */
export const marksToTell = (marks: AttendanceMark[]) =>
  marks.filter((m) => TOLD[m.status] && m.before !== m.status);

const dateLabel = (day: string) =>
  new Date(`${day}T00:00:00.000Z`).toLocaleDateString('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

export async function tellAbsences(classId: string, day: string, marks: AttendanceMark[]) {
  const news = marksToTell(marks);
  if (!news.length || day !== todayWib()) return;

  try {
    const ids = news.map((m) => m.studentId);
    const [cls, students, walis, musyrif] = await Promise.all([
      prisma.class.findUnique({ where: { id: classId }, select: { name: true } }),
      prisma.student.findMany({
        where: { id: { in: ids } },
        select: { id: true, user: { select: { name: true } } },
      }),
      prisma.studentParent.findMany({
        where: { studentId: { in: ids } },
        select: { studentId: true, parentId: true },
      }),
      musyrifOfBoarders(ids),
    ]);
    const nameOf = new Map(students.map((s) => [s.id, s.user.name]));
    const when = dateLabel(day);
    const where = cls ? `kelas ${cls.name}` : 'kelas';

    const sends: Promise<unknown>[] = [];
    for (const mark of news) {
      const name = nameOf.get(mark.studentId) ?? 'Santri';
      const what = TOLD[mark.status]!;
      const data = { studentId: mark.studentId, classId, date: day, status: mark.status };

      for (const w of walis.filter((p) => p.studentId === mark.studentId)) {
        sends.push(
          createNotification({
            userId: w.parentId,
            type: 'ATTENDANCE',
            title: `${name} ${what}`,
            message:
              `${name} tercatat ${what} di ${where} pada ${when}. ` +
              'Bila ada keterangan, sampaikan kepada wali kelas atau ajukan izin di aplikasi.',
            channels: ['IN_APP', 'EMAIL'],
            data,
          })
        );
      }
      for (const m of musyrif.get(mark.studentId) ?? []) {
        sends.push(
          createNotification({
            userId: m.id,
            type: 'ATTENDANCE',
            title: `Santri mukim ${name} ${what}`,
            message:
              `${name} tercatat ${what} di ${where} pada ${when}. ` +
              'Ia santri mukim di asrama Anda — mohon pastikan keberadaannya.',
            channels: ['IN_APP'],
            data,
          })
        );
      }
    }
    const failed = (await Promise.allSettled(sends)).filter((r) => r.status === 'rejected');
    if (failed.length) {
      logger.warn('Attendance notices failed', { classId, day, failed: failed.length });
    }
  } catch (error) {
    logger.warn('Attendance notices could not be prepared', { classId, day, error: String(error) });
  }
}
