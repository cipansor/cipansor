import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ScopeActor } from '@/utils/student-scope';
import { listSimaanQuerySchema } from '../simaan.schema';

// "Selesai" and "lulus" are two different things. The web badge reads
// `simaanStatusOf` — a pass *or* any score — while the list page filtered on
// the `passed` column alone, so a failed exam (score 40, passed=false) showed a
// "Selesai" badge yet was listed under "Terjadwal" and hidden from "Selesai"
// (#1125). The query now carries a `status` and the server applies the same
// rule, before pagination. These tests drive the real service and read the
// `where` that reaches Prisma.

vi.mock('@/lib/prisma', () => ({
  prisma: {
    simaanExam: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      findFirstOrThrow: vi.fn().mockResolvedValue({ id: 'e-1' }),
    },
    $transaction: vi.fn((callback) => callback(prisma)),
  },
}));

import { prisma } from '@/lib/prisma';
import { simaanService } from '../simaan.service';

const guru: ScopeActor = { sub: 'u-guru', roleCode: 'SMPIT_GURU', unitId: 'unit-smp' };

const findMany = vi.mocked(prisma.simaanExam.findMany);
const whereOf = () => findMany.mock.calls[0][0]?.where as unknown as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([] as never);
  vi.mocked(prisma.simaanExam.count).mockResolvedValue(0 as never);
});

describe('listSimaanQuerySchema — `status` accepts only the two derived states', () => {
  it('parses COMPLETED and SCHEDULED', () => {
    expect(listSimaanQuerySchema.parse({ status: 'COMPLETED' }).status).toBe('COMPLETED');
    expect(listSimaanQuerySchema.parse({ status: 'SCHEDULED' }).status).toBe('SCHEDULED');
  });

  it('rejects a value outside the derived status set', () => {
    expect(listSimaanQuerySchema.safeParse({ status: 'PASSED' }).success).toBe(false);
    expect(listSimaanQuerySchema.safeParse({ status: 'IN_PROGRESS' }).success).toBe(false);
  });

  it('leaves `status` unset when it is absent', () => {
    expect(listSimaanQuerySchema.parse({}).status).toBeUndefined();
  });
});

describe('simaanService.findAll — the status filter matches the badge rule', () => {
  it('COMPLETED means passed OR a score is present, applied before pagination', async () => {
    await simaanService.findAll({ page: 1, limit: 20, status: 'COMPLETED' }, guru);

    const and = whereOf().AND as Array<Record<string, unknown>>;
    expect(and).toContainEqual({
      OR: [{ passed: true }, { overallScore: { not: null } }],
    });
  });

  it('SCHEDULED means not passed AND no score at all', async () => {
    await simaanService.findAll({ page: 1, limit: 20, status: 'SCHEDULED' }, guru);

    const and = whereOf().AND as Array<Record<string, unknown>>;
    expect(and).toContainEqual({ passed: false, overallScore: null });
  });

  it('composes the status rule with a search term instead of dropping it', async () => {
    await simaanService.findAll({ page: 1, limit: 20, status: 'COMPLETED', search: 'ahmad' }, guru);

    const where = whereOf();
    // `search` owns `where.OR`; the status rule must live in `AND` so neither
    // overwrites the other.
    expect(where.OR).toBeTruthy();
    const and = where.AND as Array<Record<string, unknown>>;
    expect(and).toContainEqual({
      OR: [{ passed: true }, { overallScore: { not: null } }],
    });
  });

  it('adds nothing when the status filter is absent', async () => {
    await simaanService.findAll({ page: 1, limit: 20 }, guru);

    expect(whereOf().AND).toBeUndefined();
  });
});
