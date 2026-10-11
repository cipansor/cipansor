import { prisma } from '../../lib/prisma';

export class OrganisasiService {
  // ── OrgUnit ───────────────────────────────────────
  async getOrgUnits(unitId: string) {
    return prisma.orgUnit.findMany({
      where: { unitId },
      include: {
        children: {
          include: { positions: { include: { holder: { select: { id: true, name: true } } } } },
        },
        positions: { include: { holder: { select: { id: true, name: true } } } },
      },
      orderBy: [{ level: 'asc' }, { sortOrder: 'asc' }],
    });
  }

  async getOrgTree(unitId: string) {
    // Get root-level org units with full nested tree
    return prisma.orgUnit.findMany({
      where: { unitId, parentId: null },
      include: {
        positions: { include: { holder: { select: { id: true, name: true } } } },
        children: {
          include: {
            positions: { include: { holder: { select: { id: true, name: true } } } },
            children: {
              include: {
                positions: { include: { holder: { select: { id: true, name: true } } } },
                children: true,
              },
            },
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async getOrgUnit(id: string) {
    return prisma.orgUnit.findUniqueOrThrow({
      where: { id },
      include: {
        children: { orderBy: { sortOrder: 'asc' } },
        positions: { include: { holder: { select: { id: true, name: true } } } },
        parent: true,
      },
    });
  }

  async createOrgUnit(data: {
    unitId: string;
    name: string;
    code: string;
    description?: string;
    parentId?: string;
    level?: number;
    sortOrder?: number;
  }) {
    return prisma.orgUnit.create({ data });
  }

  async updateOrgUnit(
    id: string,
    data: Partial<{
      name: string;
      code: string;
      description: string;
      parentId: string;
      level: number;
      sortOrder: number;
    }>
  ) {
    return prisma.orgUnit.update({ where: { id }, data });
  }

  async deleteOrgUnit(id: string) {
    return prisma.orgUnit.delete({ where: { id } });
  }

  // ── OrgPosition ───────────────────────────────────
  async getPositions(orgUnitId: string) {
    return prisma.orgPosition.findMany({
      where: { orgUnitId },
      include: { holder: { select: { id: true, name: true } } },
      orderBy: { level: 'asc' },
    });
  }

  async getPositionById(id: string) {
    return prisma.orgPosition.findUnique({
      where: { id },
      include: {
        holder: { select: { id: true, name: true, email: true } },
        orgUnit: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * Positions that report into `id`, derived from the org chart: a position's
   * parent is the position held at its org unit's parent org unit.
   */
  async getParentPosition(orgUnitId: string) {
    const orgUnit = await prisma.orgUnit.findUnique({
      where: { id: orgUnitId },
      select: { parentId: true },
    });
    if (!orgUnit?.parentId) return null;

    const parent = await prisma.orgPosition.findFirst({
      where: { orgUnitId: orgUnit.parentId },
      select: { id: true, title: true },
      orderBy: { level: 'asc' },
    });
    return parent;
  }

  /**
   * Every position across the org chart.
   *
   * Succession planning needs to offer a jabatan to score against without
   * first making the user pick an org unit — the competency component reads
   * `requirements` off the chosen position, and until something could supply
   * a position id it scored zero for everyone.
   */
  async getAllPositions() {
    return prisma.orgPosition.findMany({
      include: {
        holder: { select: { id: true, name: true } },
        orgUnit: { select: { id: true, name: true } },
      },
      orderBy: [{ level: 'asc' }, { title: 'asc' }],
    });
  }

  async createPosition(data: {
    orgUnitId: string;
    title: string;
    code?: string;
    level?: number;
    status?: any;
    holderId?: string;
    description?: string;
    requirements?: string;
  }) {
    return prisma.orgPosition.create({ data });
  }

  async updatePosition(
    id: string,
    data: Partial<{
      title: string;
      code: string;
      level: number;
      status: any;
      holderId: string;
      description: string;
      requirements: string;
    }>
  ) {
    return prisma.orgPosition.update({ where: { id }, data });
  }

  async deletePosition(id: string) {
    return prisma.orgPosition.delete({ where: { id } });
  }
}

export const organisasiService = new OrganisasiService();
