/**
 * Portfolio Service - Digital Student Portfolio
 *
 * Mengelola portofolio digital siswa yang mencakup:
 * - Karya akademik
 * - Proyek P5
 * - Prestasi ekstrakurikuler
 * - Pencapaian dan penghargaan
 */

import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/client';
import { PARENT_ROLE_CODES, STUDENT_ROLE_CODES } from '@cipansor/shared';
import { Errors } from '@/middleware/error';
import { assertStudentInScope, studentScope, type ScopeActor } from '@/utils/student-scope';

// =====================================
// WHO MAY READ AND WRITE
// =====================================

/** A filter that matches no santri. */
const NO_STUDENT: Prisma.StudentWhereInput = { id: { in: [] } };

/**
 * A portfolio is about one santri, so it follows the santri an account
 * reaches (`studentScope`): a santri their own, a wali their children, a
 * school's staff their unit, the cross-unit roles every unit.
 *
 * Writing is the same minus the wali, who reads a child's portfolio and may
 * comment on it, but does not create, change or delete it.
 */
function writeScope(actor: ScopeActor): Prisma.StudentWhereInput {
  return PARENT_ROLE_CODES.includes(actor.roleCode ?? '') ? NO_STUDENT : studentScope(actor);
}

/**
 * The portfolio, if `scope` reaches its santri; 404 otherwise, as for an id
 * that does not exist, so the answer does not confirm one.
 */
async function portfolioIn(id: string, scope: Prisma.StudentWhereInput) {
  const found = await prisma.portfolio.findFirst({
    where: { id, student: scope },
    select: { id: true },
  });
  if (!found) throw Errors.notFound('Portfolio');
  return found;
}

/** Staff may remove any comment on a portfolio they write; others only their own. */
function moderates(actor: ScopeActor): boolean {
  const code = actor.roleCode ?? '';
  return !STUDENT_ROLE_CODES.includes(code) && !PARENT_ROLE_CODES.includes(code);
}

// Portfolio types and categories
export const PORTFOLIO_TYPES = [
  { value: 'ACADEMIC', label: 'Karya Akademik', icon: 'BookOpen' },
  { value: 'P5_PROJECT', label: 'Proyek P5', icon: 'Target' },
  { value: 'EXTRACURRICULAR', label: 'Ekstrakurikuler', icon: 'Medal' },
  { value: 'ACHIEVEMENT', label: 'Prestasi', icon: 'Trophy' },
  { value: 'ARTWORK', label: 'Karya Seni', icon: 'Palette' },
  { value: 'TAHFIDZ', label: 'Tahfidz', icon: 'BookMarked' },
  { value: 'OTHER', label: 'Lainnya', icon: 'Folder' },
];

export const PORTFOLIO_CATEGORIES = {
  ACADEMIC: ['Tugas', 'Proyek', 'Penelitian', 'Presentasi', 'Laporan'],
  P5_PROJECT: [
    'Gaya Hidup Berkelanjutan',
    'Kearifan Lokal',
    'Bhinneka Tunggal Ika',
    'Bangunlah Jiwa dan Raganya',
    'Suara Demokrasi',
    'Berekayasa dan Berteknologi',
  ],
  EXTRACURRICULAR: ['Olahraga', 'Seni', 'Pramuka', 'PMR', 'Robotik', 'Jurnalistik', 'Bahasa'],
  ACHIEVEMENT: [
    'Lomba Akademik',
    'Lomba Non-Akademik',
    'Penghargaan Sekolah',
    'Penghargaan Eksternal',
  ],
  ARTWORK: ['Lukisan', 'Gambar', 'Fotografi', 'Desain Grafis', 'Kerajinan', 'Musik'],
  TAHFIDZ: ['Hafalan Juz', 'Setoran Harian', "Muroja'ah"],
  OTHER: ['Lainnya'],
};

// =====================================
// PORTFOLIO CRUD
// =====================================

export interface CreatePortfolioDto {
  studentId: string;
  title: string;
  type: string;
  category?: string;
  description?: string;
  reflection?: string;
  academicYearId?: string;
  subjectId?: string;
  classId?: string;
  isPublic?: boolean;
  isShowcase?: boolean;
}

export async function createPortfolio(data: CreatePortfolioDto, actor: ScopeActor) {
  const student = await prisma.student.findFirst({
    where: { AND: [{ id: data.studentId }, writeScope(actor)] },
    select: { id: true },
  });
  if (!student) throw Errors.notFound('Student');
  return prisma.portfolio.create({
    data,
    include: {
      student: {
        select: {
          id: true,
          nis: true,
          user: { select: { name: true } },
        },
      },
      files: true,
    },
  });
}

export async function getPortfolios(
  params: {
    studentId?: string;
    unitId?: string;
    type?: string;
    category?: string;
    academicYearId?: string;
    isPublic?: boolean;
    isShowcase?: boolean;
    search?: string;
    page?: number;
    limit?: number;
  },
  actor: ScopeActor
) {
  const {
    studentId,
    unitId,
    type,
    category,
    academicYearId,
    isPublic,
    isShowcase,
    search,
    page = 1,
    limit = 20,
  } = params;
  const skip = (page - 1) * limit;

  const where: Prisma.PortfolioWhereInput = {};
  if (studentId) where.studentId = studentId;
  if (type) where.type = type;
  if (category) where.category = category;
  if (academicYearId) where.academicYearId = academicYearId;
  if (isPublic !== undefined) where.isPublic = isPublic;
  if (isShowcase !== undefined) where.isShowcase = isShowcase;
  // The unit filter narrows what the account reaches; it never widens it.
  where.student = unitId ? { AND: [studentScope(actor), { unitId }] } : studentScope(actor);
  if (search) {
    where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [data, total] = await Promise.all([
    prisma.portfolio.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        student: {
          select: {
            id: true,
            nis: true,
            user: { select: { name: true } },
            unit: { select: { id: true, name: true } },
          },
        },
        files: {
          where: { isCover: true },
          take: 1,
        },
        _count: {
          select: { files: true, comments: true },
        },
      },
    }),
    prisma.portfolio.count({ where }),
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
}

export async function getPortfolioById(id: string, actor: ScopeActor) {
  return prisma.portfolio.findFirst({
    where: { id, student: studentScope(actor) },
    include: {
      student: {
        select: {
          id: true,
          nis: true,
          user: { select: { name: true, email: true } },
          unit: { select: { id: true, name: true } },
        },
      },
      academicYear: { select: { id: true, name: true } },
      reviewer: { select: { id: true, name: true } },
      files: {
        orderBy: [{ isCover: 'desc' }, { sortOrder: 'asc' }],
      },
      comments: {
        include: {
          user: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
      },
    },
  });
}

export async function updatePortfolio(
  id: string,
  data: Partial<CreatePortfolioDto>,
  actor: ScopeActor
) {
  await portfolioIn(id, writeScope(actor));
  return prisma.portfolio.update({
    where: { id },
    data,
    include: {
      student: {
        select: {
          id: true,
          nis: true,
          user: { select: { name: true } },
        },
      },
      files: true,
    },
  });
}

export async function deletePortfolio(id: string, actor: ScopeActor) {
  await portfolioIn(id, writeScope(actor));
  // Delete files first
  await prisma.portfolioFile.deleteMany({ where: { portfolioId: id } });
  await prisma.portfolioComment.deleteMany({ where: { portfolioId: id } });
  return prisma.portfolio.delete({ where: { id } });
}

// =====================================
// PORTFOLIO FILES
// =====================================

export async function addPortfolioFile(
  data: {
    portfolioId: string;
    fileName: string;
    fileUrl: string;
    fileType: string;
    fileSize?: number;
    isCover?: boolean;
  },
  actor: ScopeActor
) {
  await portfolioIn(data.portfolioId, writeScope(actor));
  // If setting as cover, unset other covers
  if (data.isCover) {
    await prisma.portfolioFile.updateMany({
      where: { portfolioId: data.portfolioId, isCover: true },
      data: { isCover: false },
    });
  }

  // Get next sort order
  const lastFile = await prisma.portfolioFile.findFirst({
    where: { portfolioId: data.portfolioId },
    orderBy: { sortOrder: 'desc' },
  });
  const sortOrder = (lastFile?.sortOrder || 0) + 1;

  return prisma.portfolioFile.create({
    data: {
      ...data,
      sortOrder,
    },
  });
}

/** The file, if `actor` writes its portfolio; 404 otherwise. */
async function writableFile(id: string, actor: ScopeActor) {
  const file = await prisma.portfolioFile.findFirst({
    where: { id, portfolio: { student: writeScope(actor) } },
    select: { id: true, portfolioId: true },
  });
  if (!file) throw Errors.notFound('File');
  return file;
}

export async function updatePortfolioFile(
  id: string,
  data: { isCover?: boolean; sortOrder?: number },
  actor: ScopeActor
) {
  const file = await writableFile(id, actor);
  if (data.isCover) {
    await prisma.portfolioFile.updateMany({
      where: { portfolioId: file.portfolioId, isCover: true },
      data: { isCover: false },
    });
  }
  return prisma.portfolioFile.update({
    where: { id },
    data,
  });
}

export async function deletePortfolioFile(id: string, actor: ScopeActor) {
  await writableFile(id, actor);
  return prisma.portfolioFile.delete({ where: { id } });
}

// =====================================
// PORTFOLIO COMMENTS
// =====================================

export async function addPortfolioComment(
  data: {
    portfolioId: string;
    content: string;
  },
  actor: ScopeActor
) {
  // Whoever reads a portfolio may comment on it, as themselves.
  await portfolioIn(data.portfolioId, studentScope(actor));
  return prisma.portfolioComment.create({
    data: { ...data, userId: actor.sub },
    include: {
      user: { select: { id: true, name: true } },
    },
  });
}

/** A comment is changed by its author only. */
export async function updatePortfolioComment(id: string, content: string, actor: ScopeActor) {
  const own = await prisma.portfolioComment.findFirst({
    where: { id, userId: actor.sub, portfolio: { student: studentScope(actor) } },
    select: { id: true },
  });
  if (!own) throw Errors.notFound('Comment');
  return prisma.portfolioComment.update({
    where: { id },
    data: { content },
  });
}

/**
 * Removed by its author, or by staff who write the portfolio it is on — either
 * way only inside the portfolio the account reaches. The author branch carries
 * the scope too: were it `userId` alone, staff could delete their own comment
 * on another unit's portfolio (404 otherwise).
 */
export async function deletePortfolioComment(id: string, actor: ScopeActor) {
  const asAuthor = { userId: actor.sub, portfolio: { student: studentScope(actor) } };
  const reach = moderates(actor)
    ? { OR: [asAuthor, { portfolio: { student: writeScope(actor) } }] }
    : asAuthor;
  const found = await prisma.portfolioComment.findFirst({
    where: { id, ...reach },
    select: { id: true },
  });
  if (!found) throw Errors.notFound('Comment');
  return prisma.portfolioComment.delete({ where: { id } });
}

// =====================================
// PORTFOLIO REVIEW
// =====================================

export async function reviewPortfolio(
  id: string,
  reviewData: {
    reviewedBy: string;
    score?: number;
    feedback?: string;
  },
  actor: ScopeActor
) {
  await portfolioIn(id, writeScope(actor));
  return prisma.portfolio.update({
    where: { id },
    data: {
      reviewedBy: reviewData.reviewedBy,
      reviewedAt: new Date(),
      score: reviewData.score,
      feedback: reviewData.feedback,
    },
    include: {
      student: {
        select: {
          id: true,
          nis: true,
          user: { select: { name: true } },
        },
      },
      reviewer: { select: { id: true, name: true } },
    },
  });
}

// =====================================
// PORTFOLIO STATISTICS
// =====================================

export async function getPortfolioStatistics(
  params: {
    studentId?: string;
    unitId?: string;
    academicYearId?: string;
  },
  actor: ScopeActor
) {
  const { studentId, unitId, academicYearId } = params;

  const where: Prisma.PortfolioWhereInput = {};
  if (studentId) where.studentId = studentId;
  if (academicYearId) where.academicYearId = academicYearId;
  where.student = unitId ? { AND: [studentScope(actor), { unitId }] } : studentScope(actor);

  const portfolios = await prisma.portfolio.findMany({
    where,
    select: {
      type: true,
      score: true,
      isShowcase: true,
      reviewedAt: true,
    },
  });

  const stats = {
    total: portfolios.length,
    byType: {} as Record<string, number>,
    showcaseCount: 0,
    reviewedCount: 0,
    averageScore: 0,
  };

  let scoreSum = 0;
  let scoreCount = 0;

  for (const p of portfolios) {
    stats.byType[p.type] = (stats.byType[p.type] || 0) + 1;
    if (p.isShowcase) stats.showcaseCount++;
    if (p.reviewedAt) stats.reviewedCount++;
    if (p.score) {
      scoreSum += (p.score as Decimal).toNumber();
      scoreCount++;
    }
  }

  if (scoreCount > 0) {
    stats.averageScore = scoreSum / scoreCount;
  }

  return stats;
}

// =====================================
// STUDENT SHOWCASE (WITHIN STUDENT SCOPE)
// =====================================
// Not a public page: `isShowcase`/`isPublic` choose which works are shown,
// not who may see them. Reach stays `studentScope`
// (decisions/showcase-portofolio.md).

export async function getStudentShowcase(studentId: string, actor: ScopeActor) {
  // The showcase carries the santri's photo, rewards and tahfidz totals: the
  // same reach as the portfolio itself.
  await assertStudentInScope(studentId, actor);
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: {
      id: true,
      nis: true,
      user: { select: { name: true } },
      unit: { select: { name: true } },
      photoUrl: true,
    },
  });

  if (!student) throw Errors.notFound('Student');

  const showcasePortfolios = await prisma.portfolio.findMany({
    where: {
      studentId,
      OR: [{ isShowcase: true }, { isPublic: true }],
    },
    orderBy: { createdAt: 'desc' },
    include: {
      files: {
        where: { isCover: true },
        take: 1,
      },
    },
  });

  // Get achievements
  const achievements = await prisma.reward.findMany({
    where: { studentId },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  // Get tahfidz summary
  const tahfidzStats = await prisma.tahfidzRecord.aggregate({
    where: { studentId },
    _count: true,
    _sum: { totalAyah: true },
  });

  return {
    student,
    portfolios: showcasePortfolios,
    achievements,
    tahfidz: {
      totalRecords: tahfidzStats._count,
      totalAyah: tahfidzStats._sum?.totalAyah || 0,
    },
  };
}
