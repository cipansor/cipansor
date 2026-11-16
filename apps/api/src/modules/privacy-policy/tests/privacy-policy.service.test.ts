import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as service from '../privacy-policy.service';
import { prisma } from '@/lib/prisma';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    privacyPolicyVersion: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
    },
  },
}));

const row = (over: Partial<Record<string, unknown>> = {}) => ({
  version: 1,
  effectiveAt: new Date('2026-01-01T00:00:00.000Z'),
  bodyId: 'id-body',
  bodyEn: 'en-body',
  bodyAr: 'ar-body',
  summaryId: 'id-summary',
  summaryEn: 'en-summary',
  summaryAr: 'ar-summary',
  ...over,
});

describe('privacy-policy service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getCurrentPolicy', () => {
    it('returns the highest version whose effectiveAt has passed', async () => {
      vi.mocked(prisma.privacyPolicyVersion.findFirst).mockResolvedValueOnce(
        row({ version: 3 }) as any
      );

      const current = await service.getCurrentPolicy();

      expect(current?.version).toBe(3);
      expect(current?.texts.id.body).toBe('id-body');
      expect(current?.texts.ar.summary).toBe('ar-summary');
      // The effective filter is applied — a version still in the future is not
      // returned while a past one exists.
      expect(prisma.privacyPolicyVersion.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { effectiveAt: { lte: expect.any(Date) } },
          orderBy: { version: 'desc' },
        })
      );
    });

    it('falls back to the latest version when none is effective yet', async () => {
      // First call (effectiveAt <= now) finds nothing; second (any) finds v1.
      vi.mocked(prisma.privacyPolicyVersion.findFirst)
        .mockResolvedValueOnce(null as any)
        .mockResolvedValueOnce(row({ version: 1 }) as any);

      const current = await service.getCurrentPolicy();

      expect(current?.version).toBe(1);
    });

    it('returns null when no version has ever been published', async () => {
      vi.mocked(prisma.privacyPolicyVersion.findFirst).mockResolvedValue(null as any);

      await expect(service.getCurrentPolicy()).resolves.toBeNull();
    });
  });

  describe('getCurrentVersionNumber', () => {
    it('reports the current version number', async () => {
      vi.mocked(prisma.privacyPolicyVersion.findFirst).mockResolvedValueOnce(
        row({ version: 7 }) as any
      );

      await expect(service.getCurrentVersionNumber()).resolves.toBe(7);
    });
  });

  describe('createVersion', () => {
    it('numbers the new version one above the highest and never edits the old one', async () => {
      vi.mocked(prisma.privacyPolicyVersion.findFirst).mockResolvedValueOnce({
        version: 4,
      } as any);
      vi.mocked(prisma.privacyPolicyVersion.create).mockResolvedValueOnce(
        row({ version: 5 }) as any
      );

      const created = await service.createVersion(
        {
          bodies: { id: 'b-id', en: 'b-en', ar: 'b-ar' },
          summaries: { id: 's-id', en: 's-en', ar: 's-ar' },
          effectiveAt: new Date('2027-01-01T00:00:00.000Z'),
        },
        { sub: 'user-1' }
      );

      expect(created.version).toBe(5);
      expect(prisma.privacyPolicyVersion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          version: 5,
          createdById: 'user-1',
          bodyId: 'b-id',
          bodyAr: 'b-ar',
        }),
      });
    });

    it('starts at version 1 when none exists', async () => {
      vi.mocked(prisma.privacyPolicyVersion.findFirst).mockResolvedValueOnce(null as any);
      vi.mocked(prisma.privacyPolicyVersion.create).mockResolvedValueOnce(
        row({ version: 1 }) as any
      );

      await service.createVersion(
        {
          bodies: { id: 'b-id', en: 'b-en', ar: 'b-ar' },
          summaries: { id: 's-id', en: 's-en', ar: 's-ar' },
          effectiveAt: new Date(),
        },
        { sub: 'user-1' }
      );

      expect(prisma.privacyPolicyVersion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ version: 1 }),
      });
    });

    it('retries when a concurrent publish took the number, and lands on the next one', async () => {
      // Both callers read v4 and try v5; the loser gets P2002 on `version`,
      // re-reads, and publishes v6 — instead of failing a valid request.
      const { Prisma } = await import('@prisma/client');
      const collision = new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['version'] },
      });
      vi.mocked(prisma.privacyPolicyVersion.findFirst)
        .mockResolvedValueOnce({ version: 4 } as any)
        .mockResolvedValueOnce({ version: 5 } as any);
      vi.mocked(prisma.privacyPolicyVersion.create)
        .mockRejectedValueOnce(collision)
        .mockResolvedValueOnce(row({ version: 6 }) as any);

      const created = await service.createVersion(
        {
          bodies: { id: 'b-id', en: 'b-en', ar: 'b-ar' },
          summaries: { id: 's-id', en: 's-en', ar: 's-ar' },
          effectiveAt: new Date('2027-01-01T00:00:00.000Z'),
        },
        { sub: 'user-1' }
      );

      expect(created.version).toBe(6);
      expect(prisma.privacyPolicyVersion.create).toHaveBeenCalledTimes(2);
      expect(prisma.privacyPolicyVersion.create).toHaveBeenLastCalledWith({
        data: expect.objectContaining({ version: 6 }),
      });
    });

    it('does not swallow a collision on some other unique field', async () => {
      const { Prisma } = await import('@prisma/client');
      const other = new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['someOtherField'] },
      });
      vi.mocked(prisma.privacyPolicyVersion.findFirst).mockResolvedValueOnce({ version: 4 } as any);
      vi.mocked(prisma.privacyPolicyVersion.create).mockRejectedValueOnce(other);

      await expect(
        service.createVersion(
          {
            bodies: { id: 'b-id', en: 'b-en', ar: 'b-ar' },
            summaries: { id: 's-id', en: 's-en', ar: 's-ar' },
            effectiveAt: new Date(),
          },
          { sub: 'user-1' }
        )
      ).rejects.toBe(other);
      expect(prisma.privacyPolicyVersion.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('assertVersionExists', () => {
    it('accepts a version that exists', async () => {
      vi.mocked(prisma.privacyPolicyVersion.findUnique).mockResolvedValueOnce({
        version: 2,
      } as any);

      await expect(service.assertVersionExists(2)).resolves.toBeUndefined();
    });

    it('rejects a version that does not exist', async () => {
      vi.mocked(prisma.privacyPolicyVersion.findUnique).mockResolvedValueOnce(null as any);

      await expect(service.assertVersionExists(99)).rejects.toThrow(
        /Versi kebijakan privasi tidak dikenal/
      );
    });
  });

  describe('listVersions', () => {
    it('returns rows newest-first with pagination', async () => {
      vi.mocked(prisma.privacyPolicyVersion.count).mockResolvedValueOnce(3 as any);
      vi.mocked(prisma.privacyPolicyVersion.findMany).mockResolvedValueOnce([
        {
          ...row({ version: 3 }),
          id: 'v3',
          createdAt: new Date('2026-03-01T00:00:00.000Z'),
          createdBy: { id: 'u1', name: 'Admin' },
        },
      ] as any);

      const result = await service.listVersions({ page: 1, limit: 20 });

      expect(result.data[0].version).toBe(3);
      expect(result.data[0].createdBy?.name).toBe('Admin');
      expect(result.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 3,
        totalPages: 1,
      });
    });
  });
});
