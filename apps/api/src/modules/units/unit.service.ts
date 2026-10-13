import { prisma } from '@/lib/prisma';
import { Errors } from '@/middleware/error';
import { RoleCode, UnitType, Prisma } from '@prisma/client';
import { STUDENT_STATUS, type UnitHead, type UnitSummary } from '@cipansor/shared';
import { isFoundationScopedRole, seesAllUnits } from '@/utils/resolve-unit-id';
import type { ListUnitsQuery, CreateUnitInput, UpdateUnitInput } from './unit.schema';
import { findUnitHead } from './unit-head';

/** Who is asking: the role in use and the unit it is bound to. */
export interface UnitActor {
  roleCode?: string | null;
  unitId?: string | null;
}

export class UnitService {
  /**
   * Get all units with pagination
   */
  async findAll(
    query: ListUnitsQuery,
    currentUser: { role: string; roleCode?: string | null; unitId: string | null }
  ) {
    const { page, limit, search, type } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.UnitWhereInput = {
      deletedAt: null,
    };

    // Unit-scoped roles see only their own unit. The yayasan board, SUPER_ADMIN
    // and the staff who serve every unit — the pesantren's ustadz, musyrif and
    // muhafidz, the clinic, the library (`seesAllUnits`) — see all of them:
    // their forms ask for a santri's unit first, and a musyrif offered only
    // their own unit could not pick a santri of SMP IT or SMA Qur'an.
    //
    // This used to test `role !== SUPER_ADMIN`, and because deriveLegacyRole()
    // maps YAYASAN_* to the legacy 'UNIT_ADMIN' string, the board fell into the
    // unit branch with a null unitId and got `where.id = 'none'`: an empty list
    // on every foundation-level screen.
    if (!seesAllUnits(currentUser)) {
      where.id = currentUser.unitId || 'none';
    }

    if (type) {
      where.type = type as UnitType;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { address: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [units, total] = await Promise.all([
      prisma.unit.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: 'asc' },
        include: {
          _count: {
            select: {
              users: { where: { deletedAt: null } },
              students: { where: { deletedAt: null } },
              classes: { where: { deletedAt: null } },
            },
          },
        },
      }),
      prisma.unit.count({ where }),
    ]);

    return {
      units,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get unit by ID
   */
  async findById(id: string) {
    const unit = await prisma.unit.findFirst({
      where: { id, deletedAt: null },
      include: {
        _count: {
          select: {
            users: true,
            students: true,
            classes: true,
          },
        },
        classes: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: {
            academicYear: {
              select: { id: true, name: true, isActive: true },
            },
          },
        },
      },
    });

    if (!unit) {
      throw Errors.notFound('Unit');
    }

    return unit;
  }

  /**
   * Create new unit
   */
  async create(input: CreateUnitInput) {
    const unit = await prisma.unit.create({
      data: {
        name: input.name,
        type: input.type as UnitType,
        address: input.address,
        phone: input.phone,
        email: input.email,
        logoUrl: input.logoUrl,
      },
    });

    return unit;
  }

  /**
   * Update a unit. The Super Admin edits every unit; a unit's admin edits their
   * own — another unit answers 404, as if it did not exist — and never its type,
   * which decides where the unit appears on the public site.
   *
   * The route used to check only "is some admin", so any unit's admin could
   * rename, retype or re-address every other unit.
   */
  async update(id: string, input: UpdateUnitInput, actor: UnitActor) {
    const isSuperAdmin = actor.roleCode === RoleCode.SUPER_ADMIN;
    const unit = await prisma.unit.findFirst({
      where: { id, deletedAt: null },
    });

    if (!unit || (!isSuperAdmin && actor.unitId !== id)) {
      throw Errors.notFound('Unit');
    }

    if (input.type !== undefined && input.type !== unit.type && !isSuperAdmin) {
      throw Errors.forbidden('Hanya Super Admin yang dapat mengubah jenis unit');
    }

    if (input.npsn) {
      const holder = await prisma.unit.findFirst({
        where: { npsn: input.npsn, id: { not: id } },
        select: { name: true },
      });
      if (holder) {
        throw Errors.conflict(`NPSN ini sudah tercatat untuk ${holder.name}`);
      }
    }

    const updated = await prisma.unit.update({
      where: { id },
      data: {
        name: input.name,
        type: input.type as UnitType | undefined,
        address: input.address,
        phone: input.phone,
        email: input.email,
        logoUrl: input.logoUrl,
        npsn: input.npsn,
        officialName: input.officialName,
        operatingPermitNumber: input.operatingPermitNumber,
        operatingPermitDate:
          input.operatingPermitDate === undefined || input.operatingPermitDate === null
            ? input.operatingPermitDate
            : new Date(`${input.operatingPermitDate}T00:00:00.000Z`),
      },
    });

    return updated;
  }

  /**
   * What the unit's profile counts. The yayasan's organs and the Super Admin
   * read every unit's; everyone else only their own.
   */
  async summary(id: string, actor: UnitActor): Promise<UnitSummary> {
    const unit = await prisma.unit.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!unit || (!isFoundationScopedRole(actor.roleCode) && actor.unitId !== id)) {
      throw Errors.notFound('Unit');
    }

    const [activeStudents, teachers, classes] = await Promise.all([
      prisma.student.count({
        where: { unitId: id, deletedAt: null, status: STUDENT_STATUS.ACTIVE },
      }),
      prisma.teacher.count({
        where: { unitId: id, user: { isActive: true, deletedAt: null } },
      }),
      prisma.class.count({
        where: { unitId: id, deletedAt: null, academicYear: { isActive: true } },
      }),
    ]);

    return { activeStudents, teachers, classes };
  }

  /**
   * Who signs for the unit (`findUnitHead`). The same reach as `summary`: the
   * yayasan's organs and the Super Admin for every unit, everyone else for
   * their own.
   */
  async head(id: string, actor: UnitActor): Promise<UnitHead | null> {
    const unit = await prisma.unit.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!unit || (!isFoundationScopedRole(actor.roleCode) && actor.unitId !== id)) {
      throw Errors.notFound('Unit');
    }
    return findUnitHead(id);
  }

  /**
   * Delete unit (soft delete)
   */
  async delete(id: string) {
    const unit = await prisma.unit.findFirst({
      where: { id, deletedAt: null },
    });

    if (!unit) {
      throw Errors.notFound('Unit');
    }

    // Check if unit has active users or students
    const counts = await prisma.unit.findFirst({
      where: { id },
      include: {
        _count: {
          select: {
            users: { where: { deletedAt: null } },
            students: { where: { deletedAt: null } },
          },
        },
      },
    });

    if (counts?._count.users || counts?._count.students) {
      throw Errors.conflict('Cannot delete unit with active users or students');
    }

    await prisma.unit.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    return { message: 'Unit deleted successfully' };
  }
}

export const unitService = new UnitService();
