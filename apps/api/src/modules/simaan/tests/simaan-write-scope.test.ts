import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ScopeActor } from '@/utils/student-scope';

// The simaan write surface used to run unscoped: `create` took a `studentId`
// from the body with no check, `update`/`delete` ran `prisma.simaanExam.update({
// where: { id } })`, and the examiner/scores endpoints reached an exam by its
// id alone. A teacher could file, edit or delete another unit's exam by its id,
// and a missing id surfaced as a 500 (P2025) rather than 404. These tests drive
// the real service and read the `where` that reaches Prisma — the write must
// carry the caller's santri scope, and an out-of-scope id must answer 404.

vi.mock('@/lib/prisma', () => ({
  prisma: {
    student: { findFirst: vi.fn() },
    simaanExam: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    simaanExaminer: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    halaqoh: { findUnique: vi.fn().mockResolvedValue(null) },
    // The pass/progress effects (applyPassEffects/revertPassEffects) run inside
    // the write's transaction; `create`/`update`/`delete`/`submitScores` now
    // open one. The transaction handle is this same mocked client.
    takhosusEnrollment: { findUnique: vi.fn().mockResolvedValue(null) },
    hafidzStudent: { findUnique: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
    sanadRecord: { count: vi.fn().mockResolvedValue(0) },
    $transaction: vi.fn((callback) => callback(prisma)),
  },
}));

import { prisma } from '@/lib/prisma';
import { simaanService } from '../simaan.service';

const guru: ScopeActor = { sub: 'u-guru', roleCode: 'SMPIT_GURU', unitId: 'unit-smp' };
const ketua: ScopeActor = { sub: 'u-ketua', roleCode: 'YAYASAN_KETUA', unitId: null };

const studentFindFirst = vi.mocked(prisma.student.findFirst);
const examFindFirst = vi.mocked(prisma.simaanExam.findFirst);
const examinerFindFirst = vi.mocked(prisma.simaanExaminer.findFirst);

const notFound = { code: 'NOT_FOUND' };

beforeEach(() => {
  vi.clearAllMocks();
  studentFindFirst.mockResolvedValue({ id: 's-1' } as never);
  examFindFirst.mockResolvedValue({ id: 'e-1' } as never);
  examinerFindFirst.mockResolvedValue({ id: 'x-1' } as never);
  vi.mocked(prisma.simaanExam.create).mockResolvedValue({ id: 'e-new' } as never);
  vi.mocked(prisma.simaanExam.update).mockResolvedValue({ id: 'e-1' } as never);
  vi.mocked(prisma.simaanExam.delete).mockResolvedValue({ id: 'e-1' } as never);
  vi.mocked(prisma.simaanExaminer.create).mockResolvedValue({ id: 'x-new' } as never);
  vi.mocked(prisma.simaanExaminer.update).mockResolvedValue({ id: 'x-1' } as never);
  vi.mocked(prisma.simaanExaminer.delete).mockResolvedValue({ id: 'x-1' } as never);
});

describe('simaanService.create — the santri must be in the caller’s scope', () => {
  const body = {
    studentId: 's-1',
    simaanType: 'BIN_NAZHR' as const,
    examDate: '2026-11-20',
    juzStart: 1,
    juzEnd: 1,
  };

  it('checks the santri against the caller’s scope before creating', async () => {
    await simaanService.create(body, guru);

    expect(studentFindFirst.mock.calls[0][0]?.where).toEqual({
      AND: [{ id: 's-1' }, { unitId: 'unit-smp' }],
    });
    expect(prisma.simaanExam.create).toHaveBeenCalled();
  });

  it('a yayasan account reaches every santri', async () => {
    await simaanService.create(body, ketua);

    expect(studentFindFirst.mock.calls[0][0]?.where).toEqual({
      AND: [{ id: 's-1' }, {}],
    });
  });

  it('refuses a santri out of scope with 404 and creates nothing', async () => {
    studentFindFirst.mockResolvedValue(null as never);

    await expect(simaanService.create(body, guru)).rejects.toMatchObject(notFound);
    expect(prisma.simaanExam.create).not.toHaveBeenCalled();
  });
});

describe('simaanService.update — scoped lookup, then 404 on a foreign id', () => {
  it('scopes the lookup by the caller’s santri, not by id alone', async () => {
    await simaanService.update('e-1', { notes: 'x' }, guru);

    expect(examFindFirst.mock.calls[0][0]?.where).toEqual({
      id: 'e-1',
      student: { unitId: 'unit-smp' },
    });
    expect(prisma.simaanExam.update).toHaveBeenCalled();
  });

  it('answers 404 and writes nothing for an out-of-scope id', async () => {
    examFindFirst.mockResolvedValue(null as never);

    await expect(simaanService.update('e-x', { notes: 'x' }, guru)).rejects.toMatchObject(notFound);
    expect(prisma.simaanExam.update).not.toHaveBeenCalled();
  });
});

describe('simaanService.delete — scoped lookup, then 404 on a foreign id', () => {
  it('scopes the lookup by the caller’s santri', async () => {
    await simaanService.delete('e-1', guru);

    expect(examFindFirst.mock.calls[0][0]?.where).toEqual({
      id: 'e-1',
      student: { unitId: 'unit-smp' },
    });
    expect(prisma.simaanExam.delete).toHaveBeenCalled();
  });

  it('answers 404 and deletes nothing for an out-of-scope id', async () => {
    examFindFirst.mockResolvedValue(null as never);

    await expect(simaanService.delete('e-x', guru)).rejects.toMatchObject(notFound);
    expect(prisma.simaanExam.delete).not.toHaveBeenCalled();
  });
});

describe('simaanService.submitScores — scoped lookup, then 404', () => {
  const scores = { simaanId: 'e-1', overallScore: 80, grade: 'JAYYID' as const, passed: true };

  it('scopes the exam lookup by the caller’s santri', async () => {
    await simaanService.submitScores(scores, guru);

    expect(examFindFirst.mock.calls[0][0]?.where).toEqual({
      id: 'e-1',
      student: { unitId: 'unit-smp' },
    });
    expect(prisma.simaanExam.update).toHaveBeenCalled();
  });

  it('answers 404 and writes nothing for an out-of-scope exam', async () => {
    examFindFirst.mockResolvedValue(null as never);

    await expect(simaanService.submitScores(scores, guru)).rejects.toMatchObject(notFound);
    expect(prisma.simaanExam.update).not.toHaveBeenCalled();
  });
});

describe('simaanService examiner management — scoped to the exam’s santri', () => {
  it('addExaminer scopes the parent exam before creating', async () => {
    await simaanService.addExaminer({ simaanId: 'e-1', examinerId: 'u-1' }, guru);

    expect(examFindFirst.mock.calls[0][0]?.where).toEqual({
      id: 'e-1',
      student: { unitId: 'unit-smp' },
    });
    expect(prisma.simaanExaminer.create).toHaveBeenCalled();
  });

  it('updateExaminer scopes through its exam’s santri', async () => {
    await simaanService.updateExaminer('x-1', { score: 90 }, guru);

    expect(examinerFindFirst.mock.calls[0][0]?.where).toEqual({
      id: 'x-1',
      simaan: { student: { unitId: 'unit-smp' } },
    });
    expect(prisma.simaanExaminer.update).toHaveBeenCalled();
  });

  it('deleteExaminer scopes through its exam’s santri', async () => {
    await simaanService.deleteExaminer('x-1', guru);

    expect(examinerFindFirst.mock.calls[0][0]?.where).toEqual({
      id: 'x-1',
      simaan: { student: { unitId: 'unit-smp' } },
    });
    expect(prisma.simaanExaminer.delete).toHaveBeenCalled();
  });

  it('deleteExaminer answers 404 and deletes nothing for a foreign examiner', async () => {
    examinerFindFirst.mockResolvedValue(null as never);

    await expect(simaanService.deleteExaminer('x-x', guru)).rejects.toMatchObject(notFound);
    expect(prisma.simaanExaminer.delete).not.toHaveBeenCalled();
  });
});

describe('simaanService.getHalaqohRecords — the halaqoh is still the caller’s santri', () => {
  it('carries the unit scope alongside the halaqoh filter', async () => {
    vi.mocked(prisma.simaanExam.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.simaanExam.count).mockResolvedValue(0 as never);

    await simaanService.getHalaqohRecords({ halaqohId: 'h-1', page: 1, limit: 20 }, guru);

    const where = vi.mocked(prisma.simaanExam.findMany).mock.calls[0][0]?.where;
    expect(where).toMatchObject({ halaqohId: 'h-1', student: { unitId: 'unit-smp' } });
  });
});
