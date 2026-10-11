import { describe, it, expect, vi, beforeEach } from 'vitest';
import { STUDENT_SAFE_SELECT, TEACHER_SAFE_SELECT } from '@/utils/student-scope';
import {
  ACTORS,
  SANTRI_SMA,
  SANTRI_SMP,
  SMP,
  findStudentLike,
} from '../../../../tests/mocks/santri-fixture';

/**
 * Whose kitab kuning progress an account reaches. The ustadz who teaches a
 * kitab serves santri of every school while their own unit is the pesantren;
 * a school's staff reach their school; a santri their own, a wali their
 * children's.
 */

const prismaMock = vi.hoisted(() => ({
  student: { findUnique: vi.fn(), findFirst: vi.fn() },
  kitabKuning: { findUnique: vi.fn() },
  kitabProgress: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    count: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { kitabProgressService } from '../kitab-progress.service';

const progress = (studentId: string) => ({
  kitabId: 'k1',
  studentId,
  teacherId: 't1',
  academicYearId: 'y1',
  currentPage: 12,
});

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.student.findFirst.mockImplementation(findStudentLike);
  prismaMock.student.findUnique.mockImplementation(async (args: { where: { id: string } }) =>
    findStudentLike({ where: { id: args.where.id } })
  );
  prismaMock.kitabKuning.findUnique.mockResolvedValue({ id: 'k1', title: 'Safinatun Najah' });
  prismaMock.kitabProgress.upsert.mockImplementation(async (args: object) => args);
  prismaMock.kitabProgress.findMany.mockResolvedValue([]);
  prismaMock.kitabProgress.count.mockResolvedValue(0);
});

describe('the progress list', () => {
  const whereFor = async (actor: (typeof ACTORS)[keyof typeof ACTORS]) => {
    vi.clearAllMocks();
    prismaMock.kitabProgress.findMany.mockResolvedValue([]);
    prismaMock.kitabProgress.count.mockResolvedValue(0);
    await kitabProgressService.listProgress({ page: 1, limit: 20 }, actor);
    return prismaMock.kitabProgress.findMany.mock.calls[0][0].where;
  };

  it('spans every school for the ustadz, one school for its teacher', async () => {
    expect(await whereFor(ACTORS.ustadz)).toEqual({});
    expect(await whereFor(ACTORS.guruSmp)).toEqual({ student: { unitId: SMP } });
  });

  it('gives a santri their own and a wali their children’s', async () => {
    expect(await whereFor(ACTORS.santriSmp)).toEqual({
      student: { userId: ACTORS.santriSmp.sub },
    });
    expect(await whereFor(ACTORS.waliSmp)).toEqual({
      student: { parents: { some: { parentId: ACTORS.waliSmp.sub } } },
    });
  });

  it("carries the santri's name, not their whole record", async () => {
    await kitabProgressService.listProgress({ page: 1, limit: 20 }, ACTORS.ustadz);
    const include = prismaMock.kitabProgress.findMany.mock.calls[0][0].include;
    expect(include.student).toEqual({ select: STUDENT_SAFE_SELECT });
    expect(include.teacher).toEqual({ select: TEACHER_SAFE_SELECT });
  });
});

describe('recording progress', () => {
  it("an ustadz records an SMA Qur'an santri's page", async () => {
    await kitabProgressService.updateProgress(progress(SANTRI_SMA.id), ACTORS.ustadz);
    expect(prismaMock.kitabProgress.upsert).toHaveBeenCalledTimes(1);
  });

  it("a school's teacher cannot record another school's santri", async () => {
    await expect(
      kitabProgressService.updateProgress(progress(SANTRI_SMA.id), ACTORS.guruSmp)
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(prismaMock.kitabProgress.upsert).not.toHaveBeenCalled();
  });

  it('marking a kitab finished follows the same rule', async () => {
    prismaMock.kitabProgress.findUnique.mockResolvedValue({ studentId: SANTRI_SMA.id });
    prismaMock.kitabProgress.update.mockResolvedValue({ id: 'p1' });
    await expect(
      kitabProgressService.markCompleted('p1', 'A', ACTORS.guruSmp)
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(kitabProgressService.markCompleted('p1', 'A', ACTORS.ustadz)).resolves.toEqual({
      id: 'p1',
    });
  });
});

describe("a santri's report", () => {
  it('opens for their wali and not for another santri’s', async () => {
    await expect(
      kitabProgressService.getStudentReport(SANTRI_SMP.id, ACTORS.waliSmp)
    ).resolves.toMatchObject({ studentId: SANTRI_SMP.id });
    await expect(
      kitabProgressService.getStudentReport(SANTRI_SMP.id, ACTORS.waliSma)
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
