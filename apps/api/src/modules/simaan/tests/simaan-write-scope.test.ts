import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WriteActor } from '@/utils/write-scope';

// #1025 — the simaan write surface must follow the yayasan write-scope rule
// (owner decision 2026-11-09): Super Admin for any unit, every other account
// for its own unit or a santri it reaches through a Relasi_Pengajaran (a)–(c).
//
// It used to run on the *read* scope (`studentScope`): a musyrif/ustadz who
// reads across units (seesAllUnits) could file, edit or delete another unit's
// exam, because read breadth was taken as write authority (R13.8), and a
// teacher with a genuine relation to a santri of another unit could not write
// at all. A record outside the caller's write reach now answers 404 with the
// same content as one that does not exist. These tests drive the real service;
// the prisma mock answers from a small fixture, so the scope decision is what
// is under test.

const STUDENTS: Record<string, { id: string; unitId: string; enrollments: { classId: string }[] }> =
  {
    's-smp': { id: 's-smp', unitId: 'unit-smp', enrollments: [{ classId: 'c-smp' }] },
    's-other': { id: 's-other', unitId: 'unit-other', enrollments: [{ classId: 'c-other' }] },
  };

/** Whether a fixture santri matches a `studentWriteWhere` filter. */
function inScope(student: { unitId: string }, scope: Record<string, any>): boolean {
  if (Object.keys(scope).length === 0) return true;
  if (scope.id?.in?.length === 0) return false;
  if (scope.unitId) return student.unitId === scope.unitId;
  return false;
}

vi.mock('@/lib/prisma', () => {
  // Two clients with *separate* spies over the same behavior, so a test can
  // tell which one a read went through. `prisma` is the pool; `tx` is the
  // handle `$transaction` hands its callback. #1025: a scope read inside a
  // transaction must use `tx` — reading the pool there borrows a second
  // connection while the transaction still holds one.
  //
  // The `student.findMany` implementation covers both shapes that reach it: the
  // write-scope check (`where.AND`) and the relation read inside
  // `teachingRelations` (`where.id.in`).
  const studentFindManyImpl = async (args: any) => {
    const where = args?.where ?? {};
    if (Array.isArray(where.AND)) {
      const ids: string[] = where.AND[0]?.id?.in ?? [];
      const scope = where.AND[1] ?? {};
      return ids
        .map((id) => STUDENTS[id])
        .filter(Boolean)
        .filter((s) => inScope(s!, scope))
        .map((s) => ({ id: s!.id }));
    }
    const ids: string[] = where.id?.in ?? [];
    return ids.map((id) => STUDENTS[id]).filter(Boolean);
  };

  const prisma: any = {
    student: { findMany: vi.fn(studentFindManyImpl) },
    teacher: { findFirst: vi.fn().mockResolvedValue({ id: 't-1', unitId: 'unit-smp' }) },
    teacherSubject: { findMany: vi.fn().mockResolvedValue([]) },
    takhosusEnrollment: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    musyrif: { findFirst: vi.fn().mockResolvedValue(null) },
    class: { findMany: vi.fn().mockResolvedValue([]) },
    hafidzStudent: { findUnique: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
    sanadRecord: { count: vi.fn().mockResolvedValue(0) },
    halaqoh: { findUnique: vi.fn().mockResolvedValue(null) },
    simaanExam: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({
        id: 'e-new',
        studentId: 's-smp',
        juzStart: 1,
        juzEnd: 1,
      }),
      update: vi.fn().mockResolvedValue({ id: 'e-smp' }),
      delete: vi.fn().mockResolvedValue({ id: 'e-smp' }),
    },
    simaanExaminer: {
      findFirst: vi.fn(),
      create: vi.fn().mockResolvedValue({ id: 'x-new' }),
      update: vi.fn().mockResolvedValue({ id: 'x-1' }),
      delete: vi.fn().mockResolvedValue({ id: 'x-1' }),
    },
  };

  const tx: any = {
    student: { findMany: vi.fn(studentFindManyImpl) },
    teacher: { findFirst: vi.fn().mockResolvedValue({ id: 't-1', unitId: 'unit-smp' }) },
    teacherSubject: { findMany: vi.fn().mockResolvedValue([]) },
    takhosusEnrollment: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    musyrif: { findFirst: vi.fn().mockResolvedValue(null) },
    class: { findMany: vi.fn().mockResolvedValue([]) },
    hafidzStudent: { findUnique: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
    sanadRecord: { count: vi.fn().mockResolvedValue(0) },
    halaqoh: { findUnique: vi.fn().mockResolvedValue(null) },
    simaanExam: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({
        id: 'e-new',
        studentId: 's-smp',
        juzStart: 1,
        juzEnd: 1,
      }),
      update: vi.fn().mockResolvedValue({ id: 'e-smp' }),
      delete: vi.fn().mockResolvedValue({ id: 'e-smp' }),
    },
    simaanExaminer: {
      findFirst: vi.fn(),
      create: vi.fn().mockResolvedValue({ id: 'x-new' }),
      update: vi.fn().mockResolvedValue({ id: 'x-1' }),
      delete: vi.fn().mockResolvedValue({ id: 'x-1' }),
    },
  };

  prisma.$transaction = vi.fn((cb: any) => cb(tx));

  return { prisma, tx };
});

// The mock adds `tx`; the real module has no such export, so read it through a
// cast (only `prisma` is a real export).
import * as prismaModule from '@/lib/prisma';
import { simaanService } from '../simaan.service';

const { prisma, tx } = prismaModule as unknown as { prisma: any; tx: any };

const txStudentFindMany = vi.mocked((tx as any).student.findMany);
const txExamFindFirst = vi.mocked((tx as any).simaanExam.findFirst);
const txExamCreate = vi.mocked((tx as any).simaanExam.create);
const txExamUpdate = vi.mocked((tx as any).simaanExam.update);
const txExamDelete = vi.mocked((tx as any).simaanExam.delete);

const guruSmp: WriteActor = { sub: 'u-guru', roleCode: 'SMPIT_GURU', unitId: 'unit-smp' };
// A Pembaca_Lintas_Unit: reads every unit (seesAllUnits), so it must NOT get
// write breadth from that (R13.8).
const musyrif: WriteActor = { sub: 'u-musyrif', roleCode: 'MUSYRIF', unitId: 'unit-smp' };
const superAdmin: WriteActor = { sub: 'u-super', roleCode: 'SUPER_ADMIN', unitId: null };

const examFindFirst = vi.mocked(prisma.simaanExam.findFirst);
const examinerFindFirst = vi.mocked(prisma.simaanExaminer.findFirst);
const examCreate = vi.mocked(prisma.simaanExam.create);
const examinerCreate = vi.mocked(prisma.simaanExaminer.create);
const examinerUpdate = vi.mocked(prisma.simaanExaminer.update);
const examinerDelete = vi.mocked(prisma.simaanExaminer.delete);
const takhosusFindMany = vi.mocked(prisma.takhosusEnrollment.findMany);

const notFound = { code: 'NOT_FOUND' };

/** The exam row `findExamInScope`/`assertExamWritable` reads, for `studentId`. */
const examRow = (studentId: string) => ({
  id: 'e-1',
  studentId,
  juzStart: 1,
  juzEnd: 1,
  passed: false,
});

/** Point both clients' relation reads at "no relation" and both exam reads at `studentId`. */
function resetScope(studentId = 's-smp') {
  for (const client of [prisma, tx]) {
    const c = client as any;
    c.teacher.findFirst.mockResolvedValue({ id: 't-1', unitId: 'unit-smp' });
    c.teacherSubject.findMany.mockResolvedValue([]);
    c.takhosusEnrollment.findMany.mockResolvedValue([]);
    c.musyrif.findFirst.mockResolvedValue(null);
    c.class.findMany.mockResolvedValue([]);
    c.simaanExam.findFirst.mockResolvedValue(examRow(studentId));
    c.simaanExaminer.findFirst.mockResolvedValue({ id: 'x-1', simaan: { studentId } });
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  resetScope();
});

const createBody = (studentId: string) => ({
  studentId,
  simaanType: 'BIN_NAZHR' as const,
  examDate: '2026-11-20',
  juzStart: 1,
  juzEnd: 1,
});

describe('simaanService.create — the santri must be in the caller’s write reach', () => {
  it('scopes the santri check by the caller’s unit, and creates', async () => {
    await simaanService.create(createBody('s-smp'), guruSmp);

    const where = vi.mocked(prisma.student.findMany).mock.calls[0][0]?.where as any;
    expect(where).toEqual({ AND: [{ id: { in: ['s-smp'] } }, { unitId: 'unit-smp' }] });
    expect(txExamCreate).toHaveBeenCalled();
  });

  it('Super Admin reaches a santri of any unit', async () => {
    await simaanService.create(createBody('s-other'), superAdmin);

    const where = vi.mocked(prisma.student.findMany).mock.calls[0][0]?.where as any;
    expect(where).toEqual({ AND: [{ id: { in: ['s-other'] } }, {}] });
    expect(txExamCreate).toHaveBeenCalled();
  });

  it('a cross-unit reader with no relation is refused 404 (R13.8)', async () => {
    // On the pre-fix code the read scope widened with `seesAllUnits`, so this
    // account wrote the exam; the write scope must not.
    await expect(simaanService.create(createBody('s-other'), musyrif)).rejects.toMatchObject(
      notFound
    );
    expect(txExamCreate).not.toHaveBeenCalled();
  });

  it('reaches a santri of another unit through a relation (b) — a Halaqoh it leads', async () => {
    takhosusFindMany.mockResolvedValue([{ studentId: 's-other' }] as never);

    await simaanService.create(createBody('s-other'), guruSmp);

    expect(txExamCreate).toHaveBeenCalled();
  });

  it('refuses a santri with no relation to the caller, and creates nothing', async () => {
    await expect(simaanService.create(createBody('s-other'), guruSmp)).rejects.toMatchObject(
      notFound
    );
    expect(txExamCreate).not.toHaveBeenCalled();
  });
});

describe('simaanService.update — the exam’s santri must be writable', () => {
  it('reads the row by id, checks its santri, then updates', async () => {
    await simaanService.update('e-1', { notes: 'x' }, guruSmp);

    expect(txExamFindFirst.mock.calls[0][0]?.where).toEqual({ id: 'e-1' });
    expect(txExamUpdate).toHaveBeenCalled();
  });

  it('reads the row and the santri inside the write’s transaction, not the pool (#1025)', async () => {
    // A scope read on the global client borrows a second pooled connection
    // while the transaction still holds one.
    await simaanService.update('e-1', { notes: 'x' }, guruSmp);

    expect(txExamFindFirst).toHaveBeenCalled();
    expect(examFindFirst).not.toHaveBeenCalled();
    expect(txStudentFindMany).toHaveBeenCalled();
    expect(vi.mocked(prisma.student.findMany)).not.toHaveBeenCalled();
  });

  it('answers 404 and writes nothing for another unit’s exam', async () => {
    resetScope('s-other');

    await expect(simaanService.update('e-other', { notes: 'x' }, guruSmp)).rejects.toMatchObject(
      notFound
    );
    expect(txExamUpdate).not.toHaveBeenCalled();
  });

  it('the out-of-scope 404 reads like a missing id', async () => {
    resetScope('s-other');
    const outOfScope = await simaanService.update('e-1', { notes: 'x' }, guruSmp).catch((e) => e);
    (tx as any).simaanExam.findFirst.mockResolvedValue(null);
    const absent = await simaanService.update('e-1', { notes: 'x' }, guruSmp).catch((e) => e);

    expect(outOfScope.code).toBe('NOT_FOUND');
    expect(absent.code).toBe('NOT_FOUND');
    expect(absent.message).toBe(outOfScope.message);
  });
});

describe('simaanService.delete — the exam’s santri must be writable', () => {
  it('checks the santri, then deletes', async () => {
    await simaanService.delete('e-1', guruSmp);
    expect(txExamDelete).toHaveBeenCalled();
  });

  it('answers 404 and deletes nothing for another unit’s exam', async () => {
    resetScope('s-other');

    await expect(simaanService.delete('e-other', guruSmp)).rejects.toMatchObject(notFound);
    expect(txExamDelete).not.toHaveBeenCalled();
  });
});

describe('simaanService.submitScores — the exam’s santri must be writable', () => {
  const scores = { simaanId: 'e-1', overallScore: 80, grade: 'JAYYID' as const, passed: true };

  it('checks the santri, then writes the scores', async () => {
    await simaanService.submitScores(scores, guruSmp);
    expect(txExamUpdate).toHaveBeenCalled();
  });

  it('answers 404 and writes nothing for another unit’s exam', async () => {
    resetScope('s-other');

    await expect(simaanService.submitScores(scores, guruSmp)).rejects.toMatchObject(notFound);
    expect(txExamUpdate).not.toHaveBeenCalled();
  });
});

describe('simaanService examiner management — scoped to the exam’s santri', () => {
  it('addExaminer checks the parent exam’s santri before creating', async () => {
    await simaanService.addExaminer({ simaanId: 'e-1', examinerId: 'u-1' }, guruSmp);

    expect(examFindFirst.mock.calls[0][0]?.where).toEqual({ id: 'e-1' });
    expect(examinerCreate).toHaveBeenCalled();
  });

  it('addExaminer refuses another unit’s exam with 404 and creates nothing', async () => {
    examFindFirst.mockResolvedValue({ studentId: 's-other' } as never);

    await expect(
      simaanService.addExaminer({ simaanId: 'e-other', examinerId: 'u-1' }, guruSmp)
    ).rejects.toMatchObject(notFound);
    expect(examinerCreate).not.toHaveBeenCalled();
  });

  it('updateExaminer checks the exam’s santri through the examiner row', async () => {
    await simaanService.updateExaminer('x-1', { score: 90 }, guruSmp);

    expect(examinerFindFirst.mock.calls[0][0]?.where).toEqual({ id: 'x-1' });
    expect(examinerUpdate).toHaveBeenCalled();
  });

  it('deleteExaminer refuses an examiner of another unit’s exam with 404', async () => {
    examinerFindFirst.mockResolvedValue({ id: 'x-9', simaan: { studentId: 's-other' } } as never);

    await expect(simaanService.deleteExaminer('x-9', guruSmp)).rejects.toMatchObject(notFound);
    expect(examinerDelete).not.toHaveBeenCalled();
  });
});
