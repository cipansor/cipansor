import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sanadRecord: { findMany: vi.fn() },
  },
}));

import { prisma } from '@/lib/prisma';
import { getSanadTree } from '../sanad-certificate.service';

const mocked = prisma as unknown as {
  sanadRecord: { findMany: ReturnType<typeof vi.fn> };
};

function record(
  teacher: { id: string; name: string },
  student: { id: string; name: string },
  juz: number,
  certifiedAt: Date
) {
  return {
    juz,
    certifiedAt,
    teacher,
    enrollment: { student: { user: student } },
  };
}

const syaikh = { id: 'u-syaikh', name: 'Syaikh Root' };
const ustadz = { id: 'u-ustadz', name: 'Ust. Middle' };
const santriA = { id: 'u-a', name: 'Santri A' };
const santriB = { id: 'u-b', name: 'Santri B' };

describe('getSanadTree', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds a chained tree with juz aggregation per teacher-student pair', async () => {
    mocked.sanadRecord.findMany.mockResolvedValue([
      // Syaikh certified Ustadz (2 juz)
      record(syaikh, ustadz, 1, new Date('2015-01-01')),
      record(syaikh, ustadz, 2, new Date('2016-06-01')),
      // Ustadz later certified two santri
      record(ustadz, santriA, 30, new Date('2024-01-01')),
      record(ustadz, santriB, 30, new Date('2024-02-01')),
    ]);

    const roots = await getSanadTree();

    expect(roots).toHaveLength(1);
    const root = roots[0];
    expect(root).toMatchObject({ id: 'u-syaikh', name: 'Syaikh Root', role: 'TEACHER' });
    expect(root.juzCount).toBeUndefined(); // roots carry no certification edge

    expect(root.children).toHaveLength(1);
    const middle = root.children[0];
    expect(middle).toMatchObject({
      id: 'u-ustadz',
      role: 'TEACHER', // teaches others
      juzCount: 2,
      certifiedYear: 2016,
    });

    expect(middle.children.map((c) => c.name)).toEqual(['Santri A', 'Santri B']);
    expect(middle.children[0]).toMatchObject({ role: 'STUDENT', juzCount: 1, certifiedYear: 2024 });
  });

  it('handles multiple roots and returns [] when there is no data', async () => {
    mocked.sanadRecord.findMany.mockResolvedValueOnce([
      record(syaikh, santriA, 1, new Date('2024-01-01')),
      record({ id: 'u-other', name: 'Another Root' }, santriB, 2, new Date('2024-01-01')),
    ]);

    const roots = await getSanadTree();
    expect(roots.map((r) => r.name)).toEqual(['Another Root', 'Syaikh Root']);

    mocked.sanadRecord.findMany.mockResolvedValueOnce([]);
    expect(await getSanadTree()).toEqual([]);
  });

  it('does not infinitely recurse on cyclic certification data', async () => {
    mocked.sanadRecord.findMany.mockResolvedValue([
      record(syaikh, ustadz, 1, new Date('2020-01-01')),
      record(ustadz, syaikh, 2, new Date('2021-01-01')), // cycle
      record(ustadz, santriA, 3, new Date('2022-01-01')),
    ]);

    const roots = await getSanadTree();

    // Cycle means no strict root exists; the builder must still terminate
    expect(Array.isArray(roots)).toBe(true);
  });
});
