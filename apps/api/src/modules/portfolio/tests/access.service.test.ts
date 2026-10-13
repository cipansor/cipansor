import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A portfolio is about one santri, so every read and write follows the santri
 * an account reaches (`studentScope`): a santri their own, a wali their
 * children (read and comment, never write), a school's staff their unit, the
 * cross-unit roles every unit. Anything else answers 404, as for an id that
 * does not exist.
 *
 * Before, the routes checked only that the caller was signed in, and the
 * service looked records up by id alone: any account could read, change or
 * delete any santri's portfolio, its files and its comments, and create one
 * under any santri.
 */

const SMP = 'unit-smp';
const SMA = 'unit-sma';

type Row = Record<string, any>;
const STUDENTS: Row[] = [
  { id: 's-smp', unitId: SMP, userId: 'u-santri-smp', parents: ['u-wali-smp'] },
  { id: 's-sma', unitId: SMA, userId: 'u-santri-sma', parents: ['u-wali-sma'] },
];
const PORTFOLIOS: Row[] = [
  { id: 'p-smp', studentId: 's-smp' },
  { id: 'p-sma', studentId: 's-sma' },
];
const FILES: Row[] = [{ id: 'f-sma', portfolioId: 'p-sma' }];
const COMMENTS: Row[] = [
  { id: 'c-wali-sma', portfolioId: 'p-sma', userId: 'u-wali-sma' },
  { id: 'c-guru-smp', portfolioId: 'p-smp', userId: 'u-guru-smp' },
  // Staff of one unit commented on another unit's portfolio.
  { id: 'c-guru-smp-sma', portfolioId: 'p-sma', userId: 'u-guru-smp' },
];

const ACTORS = {
  guruSmp: { sub: 'u-guru-smp', roleCode: 'SMPIT_GURU', unitId: SMP },
  santriSmp: { sub: 'u-santri-smp', roleCode: 'SMPIT_SISWA', unitId: SMP },
  waliSma: { sub: 'u-wali-sma', roleCode: 'SMAQ_ORANG_TUA', unitId: SMA },
  ketua: { sub: 'u-ketua', roleCode: 'YAYASAN_KETUA', unitId: null },
};

/** The `where` shapes `studentScope` and the service build, over a student. */
function studentMatches(s: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, value]) => {
    if (key === 'AND') return (value as Row[]).every((w) => studentMatches(s, w));
    if (key === 'id') return typeof value === 'string' ? s.id === value : value.in.includes(s.id);
    if (key === 'parents') return s.parents.includes(value.some.parentId);
    return s[key] === value;
  });
}
const studentOf = (portfolioId: string) =>
  STUDENTS.find((s) => s.id === PORTFOLIOS.find((p) => p.id === portfolioId)?.studentId)!;
const portfolioMatches = (p: Row, where: Row) =>
  (!where.id || p.id === where.id) &&
  (!where.student || studentMatches(studentOf(p.id), where.student));
function commentMatches(c: Row, where: Row): boolean {
  if (where.OR) {
    const { OR, ...rest } = where;
    return (
      commentMatches(c, rest) &&
      (OR as Row[]).some((w) => commentMatches(c, { ...w, id: where.id }))
    );
  }
  return (
    (!where.id || c.id === where.id) &&
    (!where.userId || c.userId === where.userId) &&
    (!where.portfolio || studentMatches(studentOf(c.portfolioId), where.portfolio.student))
  );
}

const prismaMock = vi.hoisted(() => ({
  student: { findFirst: vi.fn(), findUnique: vi.fn() },
  portfolio: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  portfolioFile: {
    findFirst: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    create: vi.fn(),
  },
  portfolioComment: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  },
  reward: { findMany: vi.fn() },
  tahfidzRecord: { aggregate: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import * as service from '../portfolio.service';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.student.findFirst.mockImplementation(
    async ({ where }: { where: Row }) => STUDENTS.find((s) => studentMatches(s, where)) ?? null
  );
  prismaMock.student.findUnique.mockImplementation(
    async ({ where }: { where: Row }) => STUDENTS.find((s) => s.id === where.id) ?? null
  );
  prismaMock.portfolio.findFirst.mockImplementation(
    async ({ where }: { where: Row }) => PORTFOLIOS.find((p) => portfolioMatches(p, where)) ?? null
  );
  prismaMock.portfolio.findMany.mockImplementation(async ({ where }: { where: Row }) =>
    PORTFOLIOS.filter((p) => portfolioMatches(p, where))
  );
  prismaMock.portfolio.count.mockImplementation(
    async ({ where }: { where: Row }) => PORTFOLIOS.filter((p) => portfolioMatches(p, where)).length
  );
  prismaMock.portfolio.create.mockImplementation(async ({ data }: { data: Row }) => data);
  prismaMock.portfolio.update.mockImplementation(async ({ data }: { data: Row }) => data);
  prismaMock.portfolio.delete.mockResolvedValue({});
  prismaMock.portfolioFile.findFirst.mockImplementation(
    async ({ where }: { where: Row }) =>
      FILES.find(
        (f) =>
          (!where.id || f.id === where.id) &&
          (!where.portfolio || studentMatches(studentOf(f.portfolioId), where.portfolio.student)) &&
          (!where.portfolioId || f.portfolioId === where.portfolioId)
      ) ?? null
  );
  prismaMock.portfolioFile.update.mockResolvedValue({});
  prismaMock.portfolioFile.delete.mockResolvedValue({});
  prismaMock.portfolioFile.create.mockImplementation(async ({ data }: { data: Row }) => data);
  prismaMock.portfolioComment.findFirst.mockImplementation(
    async ({ where }: { where: Row }) => COMMENTS.find((c) => commentMatches(c, where)) ?? null
  );
  prismaMock.portfolioComment.create.mockImplementation(async ({ data }: { data: Row }) => data);
  prismaMock.portfolioComment.update.mockResolvedValue({});
  prismaMock.portfolioComment.delete.mockResolvedValue({});
  prismaMock.reward.findMany.mockResolvedValue([]);
  prismaMock.tahfidzRecord.aggregate.mockResolvedValue({ _count: 0, _sum: { totalAyah: 0 } });
});

const notFound = { statusCode: 404 };
const listed = async (actor: Row, params: Row = {}) =>
  (await service.getPortfolios(params, actor as any)).data.map((p: Row) => p.id);

describe('reading a portfolio', () => {
  it('lists only the santri the account reaches; the unit filter narrows, never widens', async () => {
    expect(await listed(ACTORS.guruSmp)).toEqual(['p-smp']);
    expect(await listed(ACTORS.guruSmp, { unitId: SMA })).toEqual([]);
    expect(await listed(ACTORS.santriSmp)).toEqual(['p-smp']);
    expect(await listed(ACTORS.waliSma)).toEqual(['p-sma']);
    expect(await listed(ACTORS.ketua)).toEqual(['p-smp', 'p-sma']);
  });

  it("another unit's portfolio, its showcase and its statistics are out of reach", async () => {
    expect(await service.getPortfolioById('p-sma', ACTORS.guruSmp as any)).toBeNull();
    expect(await service.getPortfolioById('p-smp', ACTORS.guruSmp as any)).not.toBeNull();
    await expect(service.getStudentShowcase('s-sma', ACTORS.guruSmp as any)).rejects.toMatchObject(
      notFound
    );
    await expect(service.getStudentShowcase('s-smp', ACTORS.guruSmp as any)).resolves.toBeDefined();
    await service.getPortfolioStatistics({}, ACTORS.santriSmp as any);
    const where = prismaMock.portfolio.findMany.mock.calls.at(-1)![0].where;
    expect(PORTFOLIOS.filter((p) => portfolioMatches(p, where)).map((p) => p.id)).toEqual([
      'p-smp',
    ]);
  });
});

describe('writing a portfolio', () => {
  it('a school teacher creates for their own unit only', async () => {
    await expect(
      service.createPortfolio(
        { studentId: 's-smp', title: 'x', type: 'OTHER' },
        ACTORS.guruSmp as any
      )
    ).resolves.toMatchObject({ studentId: 's-smp' });
    await expect(
      service.createPortfolio(
        { studentId: 's-sma', title: 'x', type: 'OTHER' },
        ACTORS.guruSmp as any
      )
    ).rejects.toMatchObject(notFound);
  });

  it('a santri writes their own portfolio, not a classmate’s', async () => {
    await expect(
      service.updatePortfolio('p-smp', { title: 'y' }, ACTORS.santriSmp as any)
    ).resolves.toBeDefined();
    await expect(
      service.updatePortfolio('p-sma', { title: 'y' }, ACTORS.santriSmp as any)
    ).rejects.toMatchObject(notFound);
  });

  it('a wali reads their child’s portfolio but does not change it', async () => {
    expect(await service.getPortfolioById('p-sma', ACTORS.waliSma as any)).not.toBeNull();
    for (const write of [
      () => service.updatePortfolio('p-sma', { title: 'y' }, ACTORS.waliSma as any),
      () => service.deletePortfolio('p-sma', ACTORS.waliSma as any),
      () =>
        service.addPortfolioFile(
          { portfolioId: 'p-sma', fileName: 'a', fileUrl: 'u', fileType: 'image/png' },
          ACTORS.waliSma as any
        ),
      () => service.deletePortfolioFile('f-sma', ACTORS.waliSma as any),
    ]) {
      await expect(write()).rejects.toMatchObject(notFound);
    }
    expect(prismaMock.portfolio.update).not.toHaveBeenCalled();
    expect(prismaMock.portfolio.delete).not.toHaveBeenCalled();
    expect(prismaMock.portfolioFile.delete).not.toHaveBeenCalled();
  });

  it("delete, files and review refuse another unit's portfolio, and write nothing", async () => {
    await expect(service.deletePortfolio('p-sma', ACTORS.guruSmp as any)).rejects.toMatchObject(
      notFound
    );
    await expect(
      service.updatePortfolioFile('f-sma', { isCover: true }, ACTORS.guruSmp as any)
    ).rejects.toMatchObject(notFound);
    await expect(
      service.reviewPortfolio(
        'p-sma',
        { reviewedBy: 'u-guru-smp', score: 90 },
        ACTORS.guruSmp as any
      )
    ).rejects.toMatchObject(notFound);
    expect(prismaMock.portfolio.delete).not.toHaveBeenCalled();
    expect(prismaMock.portfolioFile.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.portfolio.update).not.toHaveBeenCalled();
  });
});

describe('comments', () => {
  it('whoever reads a portfolio comments on it, as themselves', async () => {
    await expect(
      service.addPortfolioComment({ portfolioId: 'p-sma', content: 'Bagus' }, ACTORS.waliSma as any)
    ).resolves.toMatchObject({ userId: 'u-wali-sma' });
    await expect(
      service.addPortfolioComment({ portfolioId: 'p-sma', content: 'x' }, ACTORS.guruSmp as any)
    ).rejects.toMatchObject(notFound);
  });

  it('a comment is changed by its author only', async () => {
    await expect(
      service.updatePortfolioComment('c-wali-sma', 'diubah', ACTORS.waliSma as any)
    ).resolves.toBeDefined();
    await expect(
      service.updatePortfolioComment('c-wali-sma', 'diubah', ACTORS.ketua as any)
    ).rejects.toMatchObject(notFound);
  });

  it('removed by its author, or by staff who write the portfolio — not by anyone else', async () => {
    // Staff of the yayasan reach every unit: they may moderate.
    await expect(
      service.deletePortfolioComment('c-wali-sma', ACTORS.ketua as any)
    ).resolves.toBeDefined();
    // A teacher of another unit may not.
    await expect(
      service.deletePortfolioComment('c-wali-sma', ACTORS.guruSmp as any)
    ).rejects.toMatchObject(notFound);
    // A santri may not remove the teacher's comment on their own portfolio.
    await expect(
      service.deletePortfolioComment('c-guru-smp', ACTORS.santriSmp as any)
    ).rejects.toMatchObject(notFound);
  });

  it('staff remove their own comment only inside the portfolio they reach', async () => {
    // Their own comment on their own unit's portfolio.
    await expect(
      service.deletePortfolioComment('c-guru-smp', ACTORS.guruSmp as any)
    ).resolves.toBeDefined();
    // Their own comment on another unit's portfolio is out of reach.
    await expect(
      service.deletePortfolioComment('c-guru-smp-sma', ACTORS.guruSmp as any)
    ).rejects.toMatchObject(notFound);
  });
});
