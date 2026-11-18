import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WriteActor } from '@/utils/write-scope';

// A passing simaan moves the student's Takhosus progress — completing the
// programme on a 30-juz pass, advancing `currentJuz` on a partial one — and a
// re-grade to failed or a delete must undo it. That logic lived only on
// `/takhosus/simaan/:id/grade` (`updateResult`), so the same `passed: true`
// reached two different states depending on the door it came through: the
// dialog's `PATCH /simaan/:id` marked the exam passed and left the enrollment
// ACTIVE with no hafidz record (#1125). It now runs on every simaan write, in
// the write's transaction. These tests drive the real service and read the
// enrollment/hafidz writes it makes.

vi.mock('@/lib/prisma', () => ({
  prisma: {
    student: { findFirst: vi.fn(), findMany: vi.fn() },
    teacher: { findFirst: vi.fn() },
    teacherSubject: { findMany: vi.fn().mockResolvedValue([]) },
    musyrif: { findFirst: vi.fn().mockResolvedValue(null) },
    class: { findMany: vi.fn().mockResolvedValue([]) },
    simaanExam: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    simaanExaminer: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    halaqoh: { findUnique: vi.fn().mockResolvedValue(null) },
    takhosusEnrollment: {
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
    },
    hafidzStudent: { findUnique: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
    sanadRecord: { count: vi.fn().mockResolvedValue(0) },
    $transaction: vi.fn((callback) => callback(prisma)),
  },
}));

import { prisma } from '@/lib/prisma';
import { simaanService } from '../simaan.service';

const guru: WriteActor = { sub: 'u-guru', roleCode: 'SMPIT_GURU', unitId: 'unit-smp' };

const enrollmentFind = vi.mocked(prisma.takhosusEnrollment.findUnique);
const enrollmentUpdate = vi.mocked(prisma.takhosusEnrollment.update);
const hafidzFind = vi.mocked(prisma.hafidzStudent.findUnique);
const hafidzCreate = vi.mocked(prisma.hafidzStudent.create);
const hafidzDelete = vi.mocked(prisma.hafidzStudent.deleteMany);
const examFindFirst = vi.mocked(prisma.simaanExam.findFirst);

const enrollment = {
  id: 'enr-1',
  studentId: 's-1',
  status: 'ACTIVE',
  currentJuz: 5,
  targetJuz: 30,
  completedJuz: 0,
  completedAt: null,
  notes: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.student.findFirst).mockResolvedValue({ id: 's-1' } as never);
  // #1025: the write scope reads the santri of the exam (`studentWriteWhere`).
  // The santri is in the caller's unit, so the relation read is not reached.
  vi.mocked(prisma.student.findMany).mockResolvedValue([{ id: 's-1' }] as never);
  examFindFirst.mockResolvedValue({
    id: 'e-1',
    studentId: 's-1',
    juzStart: 1,
    juzEnd: 30,
    passed: false,
  } as never);
  enrollmentFind.mockResolvedValue({ ...enrollment } as never);
  enrollmentUpdate.mockResolvedValue({} as never);
  hafidzFind.mockResolvedValue(null as never);
  hafidzCreate.mockResolvedValue({} as never);
  hafidzDelete.mockResolvedValue({ count: 0 } as never);
});

/**
 * The scoped lookup (`where.id === 'e-1'`) and the revert helper's "is there
 * another passed exam" probes (no string id) both hit `simaanExam.findFirst`.
 * Answer the first with the exam under test and every probe with null, so a
 * revert is not skipped by a mock that answers every `findFirst` with the record.
 */
function examFindFirstReturns(exam: { passed: boolean; juzStart: number; juzEnd: number }) {
  examFindFirst.mockImplementation((async (args: { where?: { id?: unknown } }) => {
    if (args?.where?.id !== 'e-1') return null;
    return { id: 'e-1', studentId: 's-1', ...exam };
  }) as never);
}

const createBody = {
  studentId: 's-1',
  simaanType: 'BIN_NAZHR' as const,
  examDate: '2026-11-20',
  juzStart: 1,
  juzEnd: 30,
};

describe('create with passed: true — the progress moves here too', () => {
  beforeEach(() => {
    vi.mocked(prisma.simaanExam.create).mockResolvedValue({
      id: 'e-new',
      studentId: 's-1',
      juzStart: 1,
      juzEnd: 30,
    } as never);
  });

  it('completes the enrollment and writes the hafidz record for a 30-juz pass', async () => {
    await simaanService.create({ ...createBody, passed: true }, guru);

    expect(enrollmentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { studentId: 's-1' },
        data: expect.objectContaining({ status: 'COMPLETED', currentJuz: 30 }),
      })
    );
    expect(hafidzCreate).toHaveBeenCalled();
  });

  it('leaves the progress alone when the exam is not a pass', async () => {
    await simaanService.create({ ...createBody, passed: false }, guru);

    expect(enrollmentUpdate).not.toHaveBeenCalled();
    expect(hafidzCreate).not.toHaveBeenCalled();
  });

  it('advances currentJuz on a partial pass that covers the frontier', async () => {
    vi.mocked(prisma.simaanExam.create).mockResolvedValue({
      id: 'e-new',
      studentId: 's-1',
      juzStart: 5,
      juzEnd: 7,
    } as never);

    await simaanService.create({ ...createBody, juzStart: 5, juzEnd: 7, passed: true }, guru);

    expect(enrollmentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ currentJuz: 8 }) })
    );
  });
});

describe('update flipping passed — effects apply and revert', () => {
  beforeEach(() => {
    vi.mocked(prisma.simaanExam.update).mockResolvedValue({
      id: 'e-1',
      studentId: 's-1',
      juzStart: 1,
      juzEnd: 30,
    } as never);
  });

  it('applies the progress when passed goes false → true', async () => {
    examFindFirst.mockResolvedValue({
      id: 'e-1',
      studentId: 's-1',
      juzStart: 1,
      juzEnd: 30,
      passed: false,
    } as never);

    await simaanService.update('e-1', { passed: true }, guru);

    expect(enrollmentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) })
    );
  });

  it('reverts the progress when passed goes true → false', async () => {
    examFindFirstReturns({ passed: true, juzStart: 1, juzEnd: 30 });
    enrollmentFind.mockResolvedValue({ ...enrollment, status: 'COMPLETED' } as never);

    await simaanService.update('e-1', { passed: false }, guru);

    expect(enrollmentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ACTIVE' }) })
    );
    expect(hafidzDelete).toHaveBeenCalledWith({ where: { studentId: 's-1' } });
  });

  it('editing only the notes of a passed exam touches no progress', async () => {
    examFindFirstReturns({ passed: true, juzStart: 1, juzEnd: 30 });
    enrollmentFind.mockResolvedValue({ ...enrollment, status: 'COMPLETED' } as never);

    await simaanService.update('e-1', { notes: 'catatan diperbaiki' }, guru);

    // A notes-only edit keeps the pass over the same 1–30 range: the hafidz
    // record and its custom notes, `completedAt` and the progress must stand.
    expect(hafidzDelete).not.toHaveBeenCalled();
    expect(hafidzCreate).not.toHaveBeenCalled();
    expect(enrollmentUpdate).not.toHaveBeenCalled();
  });

  it('un-passing while shrinking the range still revokes the old completion', async () => {
    examFindFirstReturns({ passed: true, juzStart: 1, juzEnd: 30 });
    enrollmentFind.mockResolvedValue({ ...enrollment, status: 'COMPLETED' } as never);
    vi.mocked(prisma.simaanExam.update).mockResolvedValue({
      id: 'e-1',
      studentId: 's-1',
      juzStart: 1,
      juzEnd: 10,
    } as never);

    await simaanService.update('e-1', { passed: false, juzStart: 1, juzEnd: 10 }, guru);

    // The revert runs against the range that *was* passed (1–30), so the
    // completion the old pass justified is revoked — not left standing because
    // the new range is partial.
    expect(enrollmentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ACTIVE' }) })
    );
    expect(hafidzDelete).toHaveBeenCalledWith({ where: { studentId: 's-1' } });
  });
});

describe('submitScores with passed: true — the same effects', () => {
  beforeEach(() => {
    vi.mocked(prisma.simaanExam.update).mockResolvedValue({
      id: 'e-1',
      studentId: 's-1',
      juzStart: 1,
      juzEnd: 30,
    } as never);
  });

  it('completes the enrollment and writes the hafidz record', async () => {
    await simaanService.submitScores(
      { simaanId: 'e-1', overallScore: 90, grade: 'MUMTAZ', passed: true },
      guru
    );

    expect(enrollmentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) })
    );
    expect(hafidzCreate).toHaveBeenCalled();
  });
});

describe('delete of a passed exam — the progress reverts', () => {
  it('reverts the enrollment and removes the hafidz record', async () => {
    examFindFirstReturns({ passed: true, juzStart: 1, juzEnd: 30 });
    enrollmentFind.mockResolvedValue({ ...enrollment, status: 'COMPLETED' } as never);

    await simaanService.delete('e-1', guru);

    expect(enrollmentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ACTIVE' }) })
    );
    expect(hafidzDelete).toHaveBeenCalledWith({ where: { studentId: 's-1' } });
  });

  it('leaves the progress alone when the deleted exam was not a pass', async () => {
    examFindFirstReturns({ passed: false, juzStart: 1, juzEnd: 30 });

    await simaanService.delete('e-1', guru);

    expect(enrollmentUpdate).not.toHaveBeenCalled();
  });
});
