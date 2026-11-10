import { prisma } from '../../lib/prisma';
import { Prisma } from '@prisma/client';
import {
  CreateFoundationInput,
  UpdateFoundationInput,
  CreateBoardMemberInput,
  UpdateBoardMemberInput,
  CreateDocumentInput,
  UpdateDocumentInput,
} from './foundation.schema';
import { Errors } from '../../middleware/error';

// =====================================
// FOUNDATION SERVICE
// =====================================

export async function getFoundations(params: { page: number; limit: number; search?: string }) {
  const { page, limit, search } = params;
  const skip = (page - 1) * limit;

  const where: Prisma.FoundationWhereInput = {};

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { legalName: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [data, total] = await Promise.all([
    prisma.foundation.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { units: true, boardMembers: true, documents: true } },
      },
    }),
    prisma.foundation.count({ where }),
  ]);

  return {
    data,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function getFoundationById(id: string) {
  return prisma.foundation.findUnique({
    where: { id },
    include: {
      units: { select: { id: true, name: true, type: true } },
      boardMembers: { where: { isActive: true }, orderBy: { position: 'asc' } },
      documents: { orderBy: { issueDate: 'desc' } },
    },
  });
}

export async function createFoundation(data: CreateFoundationInput) {
  return prisma.foundation.create({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: {
      ...data,
      foundingDate: data.foundingDate ? new Date(data.foundingDate) : undefined,
    } as any,
  });
}

export async function updateFoundation(id: string, data: UpdateFoundationInput) {
  return prisma.foundation.update({
    where: { id },
    data: {
      ...data,
      // `null` clears the date; leaving it out keeps the stored one.
      foundingDate:
        data.foundingDate === null
          ? null
          : data.foundingDate
            ? new Date(data.foundingDate)
            : undefined,
    },
  });
}

export async function deleteFoundation(id: string) {
  // Check if foundation has units
  const foundation = await prisma.foundation.findUnique({
    where: { id },
    include: { _count: { select: { units: true } } },
  });

  if (foundation?._count.units && foundation._count.units > 0) {
    throw new Error('Cannot delete foundation with associated units');
  }

  return prisma.foundation.delete({ where: { id } });
}

// =====================================
// BOARD MEMBER SERVICE
// =====================================

export async function getBoardMembers(params: {
  page: number;
  limit: number;
  foundationId?: string;
  isActive?: boolean;
  search?: string;
}) {
  const { page, limit, foundationId, isActive, search } = params;
  const skip = (page - 1) * limit;

  const where: Prisma.BoardMemberWhereInput = {};

  if (foundationId) where.foundationId = foundationId;
  if (isActive !== undefined) where.isActive = isActive;

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { position: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [data, total] = await Promise.all([
    prisma.boardMember.findMany({
      where,
      skip,
      take: limit,
      orderBy: [{ isActive: 'desc' }, { position: 'asc' }],
      include: {
        foundation: { select: { id: true, name: true } },
      },
    }),
    prisma.boardMember.count({ where }),
  ]);

  return {
    data,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function getBoardMemberById(id: string) {
  return prisma.boardMember.findUnique({
    where: { id },
    include: { foundation: { select: { id: true, name: true } } },
  });
}

/** A calendar day from a date input, stored at midnight UTC like the unit's permit date. */
function day(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

export async function createBoardMember(data: CreateBoardMemberInput) {
  const { foundationId: given, startDate, endDate, ...fields } = data;
  // The yayasan has one foundation record; the portal's form does not name it.
  const foundationId =
    given ??
    (await prisma.foundation.findFirst({ select: { id: true }, orderBy: { createdAt: 'asc' } }))
      ?.id;
  if (!foundationId) throw Errors.notFound('Foundation');
  return prisma.boardMember.create({
    data: {
      ...fields,
      foundationId,
      startDate: day(startDate) ?? null,
      endDate: day(endDate) ?? null,
    },
  });
}

export async function updateBoardMember(id: string, data: UpdateBoardMemberInput) {
  const { startDate, endDate, ...fields } = data;
  return prisma.boardMember.update({
    where: { id },
    data: { ...fields, startDate: day(startDate), endDate: day(endDate) },
  });
}

export async function endBoardMemberTerm(id: string) {
  return prisma.boardMember.update({
    where: { id },
    data: { isActive: false, endDate: new Date() },
  });
}

export async function deleteBoardMember(id: string) {
  return prisma.boardMember.delete({ where: { id } });
}

// =====================================
// FOUNDATION DOCUMENT SERVICE
// =====================================

export async function getDocuments(params: {
  page: number;
  limit: number;
  foundationId?: string;
  type?: string;
  search?: string;
}) {
  const { page, limit, foundationId, type, search } = params;
  const skip = (page - 1) * limit;

  const where: Prisma.FoundationDocumentWhereInput = {};

  if (foundationId) where.foundationId = foundationId;
  if (type) where.type = type;

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { documentNo: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [data, total] = await Promise.all([
    prisma.foundationDocument.findMany({
      where,
      skip,
      take: limit,
      orderBy: { issueDate: 'desc' },
      include: {
        foundation: { select: { id: true, name: true } },
      },
    }),
    prisma.foundationDocument.count({ where }),
  ]);

  return {
    data,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function getDocumentById(id: string) {
  return prisma.foundationDocument.findUnique({
    where: { id },
    include: { foundation: { select: { id: true, name: true } } },
  });
}

export async function createDocument(data: CreateDocumentInput) {
  return prisma.foundationDocument.create({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: {
      ...data,
      issueDate: new Date(data.issueDate),
      expiryDate: data.expiryDate ? new Date(data.expiryDate) : undefined,
    } as any,
  });
}

export async function updateDocument(id: string, data: UpdateDocumentInput) {
  return prisma.foundationDocument.update({
    where: { id },
    data: {
      ...data,
      issueDate: data.issueDate ? new Date(data.issueDate) : undefined,
      expiryDate: data.expiryDate ? new Date(data.expiryDate) : undefined,
    },
  });
}

export async function deleteDocument(id: string) {
  return prisma.foundationDocument.delete({ where: { id } });
}

// =====================================
// STATISTICS
// =====================================

export async function getFoundationStats(foundationId: string) {
  const foundation = await prisma.foundation.findUnique({
    where: { id: foundationId },
    include: {
      _count: { select: { units: true, boardMembers: true, documents: true } },
      units: {
        select: {
          id: true,
          name: true,
          type: true,
          _count: { select: { students: true, teachers: true, staff: true } },
        },
      },
    },
  });

  if (!foundation) return null;

  const totalStudents = foundation.units.reduce((acc, unit) => acc + unit._count.students, 0);
  const totalTeachers = foundation.units.reduce((acc, unit) => acc + unit._count.teachers, 0);
  const totalStaff = foundation.units.reduce((acc, unit) => acc + unit._count.staff, 0);

  const activeBoardMembers = await prisma.boardMember.count({
    where: { foundationId, isActive: true },
  });

  const expiringDocuments = await prisma.foundationDocument.count({
    where: {
      foundationId,
      expiryDate: {
        gte: new Date(),
        lte: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days
      },
    },
  });

  return {
    foundationId,
    foundationName: foundation.name,
    totalUnits: foundation._count.units,
    totalStudents,
    totalTeachers,
    totalStaff,
    totalBoardMembers: foundation._count.boardMembers,
    activeBoardMembers,
    totalDocuments: foundation._count.documents,
    expiringDocuments,
    unitsSummary: foundation.units,
  };
}
