import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../lib/prisma';
import { organisasiService } from './organisasi.service';

// Mock external dependencies
vi.mock('../../lib/prisma', () => ({
  prisma: {
    orgUnit: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    orgPosition: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

describe('Organisasi Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('OrgUnit', () => {
    it('should create org unit', async () => {
      const dto = {
        unitId: 'unit-1',
        name: 'Departemen IT',
        code: 'IT-01',
        level: 1,
        sortOrder: 1,
      };

      vi.mocked(prisma.orgUnit.create).mockResolvedValue({ id: 'org-1', ...dto } as any);

      const result = await organisasiService.createOrgUnit(dto);

      expect(prisma.orgUnit.create).toHaveBeenCalledWith({
        data: dto,
      });
      expect(result.id).toBe('org-1');
    });

    it('should get org tree with nested inclusion', async () => {
      vi.mocked(prisma.orgUnit.findMany).mockResolvedValue([{ id: 'org-1', name: 'Root' }] as any);

      await organisasiService.getOrgTree('unit-1');

      expect(prisma.orgUnit.findMany).toHaveBeenCalledWith({
        where: { unitId: 'unit-1', parentId: null },
        include: expect.objectContaining({
          children: expect.any(Object),
          positions: expect.any(Object),
        }),
        orderBy: { sortOrder: 'asc' },
      });
    });

    it('should handle org unit update', async () => {
      vi.mocked(prisma.orgUnit.update).mockResolvedValue({ id: 'org-1' } as any);

      await organisasiService.updateOrgUnit('org-1', { name: 'IT Staff' });

      expect(prisma.orgUnit.update).toHaveBeenCalledWith({
        where: { id: 'org-1' },
        data: { name: 'IT Staff' },
      });
    });
  });

  describe('OrgPosition', () => {
    it('should create position', async () => {
      const dto = {
        orgUnitId: 'org-1',
        title: 'Network Admin',
        level: 2,
        holderId: 'user-1',
      };

      vi.mocked(prisma.orgPosition.create).mockResolvedValue({ id: 'pos-1', ...dto } as any);

      await organisasiService.createPosition(dto);

      expect(prisma.orgPosition.create).toHaveBeenCalledWith({
        data: dto,
      });
    });

    it('should query positions by org unit', async () => {
      vi.mocked(prisma.orgPosition.findMany).mockResolvedValue([{ id: 'pos-1' }] as any);

      await organisasiService.getPositions('org-1');

      expect(prisma.orgPosition.findMany).toHaveBeenCalledWith({
        where: { orgUnitId: 'org-1' },
        include: expect.any(Object),
        orderBy: { level: 'asc' },
      });
    });

    it('should get a single position with holder and org unit', async () => {
      vi.mocked(prisma.orgPosition.findUnique).mockResolvedValue({
        id: 'pos-1',
        orgUnitId: 'org-1',
        title: 'Direktur Pendidikan',
      } as any);

      const result = await organisasiService.getPositionById('pos-1');

      expect(prisma.orgPosition.findUnique).toHaveBeenCalledWith({
        where: { id: 'pos-1' },
        include: {
          holder: { select: { id: true, name: true, email: true } },
          orgUnit: { select: { id: true, name: true } },
        },
      });
      expect(result?.title).toBe('Direktur Pendidikan');
    });

    it('should return null for a missing position', async () => {
      vi.mocked(prisma.orgPosition.findUnique).mockResolvedValue(null);

      expect(await organisasiService.getPositionById('nope')).toBeNull();
    });

    it('should resolve the parent position through the org chart, or null at the root', async () => {
      vi.mocked(prisma.orgUnit.findUnique).mockResolvedValue({ parentId: 'org-parent' } as any);
      vi.mocked(prisma.orgPosition.findFirst).mockResolvedValue({
        id: 'pos-parent',
        title: 'Direktur',
      } as any);

      expect(await organisasiService.getParentPosition('org-1')).toEqual({
        id: 'pos-parent',
        title: 'Direktur',
      });

      vi.mocked(prisma.orgUnit.findUnique).mockResolvedValue({ parentId: null } as any);
      expect(await organisasiService.getParentPosition('org-root')).toBeNull();
      expect(prisma.orgPosition.findFirst).toHaveBeenCalledTimes(1);
    });
  });
});
