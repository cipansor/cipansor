import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: { student: { findMany: vi.fn() } },
}));

import { prisma } from '@/lib/prisma';
import {
  assertStudentsWritable,
  assertUnitWritable,
  isCrossUnitWriter,
  studentWriteWhere,
  unitWritable,
  type WriteActor,
} from './write-scope';

const superAdmin: WriteActor = { sub: 'u1', roleCode: 'SUPER_ADMIN', unitId: null };
const unitAdmin: WriteActor = { sub: 'u2', roleCode: 'SMPIT_ADMIN', unitId: 'unit-a' };
const musyrif: WriteActor = { sub: 'u3', roleCode: 'MUSYRIF', unitId: 'unit-a' };
const student: WriteActor = { sub: 'u4', roleCode: 'SMPIT_SISWA', unitId: 'unit-a' };
const parent: WriteActor = { sub: 'u5', roleCode: 'SMPIT_ORANG_TUA', unitId: 'unit-a' };
const unitless: WriteActor = { sub: 'u6', roleCode: 'YAYASAN_KETUA', unitId: null };

describe('write-scope', () => {
  beforeEach(() => vi.clearAllMocks());

  it('isCrossUnitWriter is only Super_Admin', () => {
    expect(isCrossUnitWriter(superAdmin)).toBe(true);
    for (const a of [unitAdmin, musyrif, student, parent, unitless]) {
      expect(isCrossUnitWriter(a)).toBe(false);
    }
  });

  it('unitWritable lets Super_Admin write any unit, everyone else only their own', () => {
    expect(unitWritable(superAdmin, 'unit-z')).toBe(true);
    expect(unitWritable(unitAdmin, 'unit-a')).toBe(true);
    expect(unitWritable(unitAdmin, 'unit-b')).toBe(false);
    expect(unitWritable(unitless, 'unit-a')).toBe(false);
  });

  it('studentWriteWhere does not widen with the read breadth (seesAllUnits)', () => {
    // A musyrif reads across units (seesAllUnits), but writes only their own.
    expect(studentWriteWhere(musyrif)).toEqual({ unitId: 'unit-a' });
    expect(studentWriteWhere(superAdmin)).toEqual({});
    expect(studentWriteWhere(student)).toEqual({ userId: 'u4' });
    expect(studentWriteWhere(parent)).toEqual({ parents: { some: { parentId: 'u5' } } });
    expect(studentWriteWhere(unitless)).toEqual({ id: { in: [] } });
  });

  it('assertUnitWritable answers not-found for an out-of-reach unit', () => {
    expect(() => assertUnitWritable(unitAdmin, 'unit-a', 'Exam')).not.toThrow();
    expect(() => assertUnitWritable(unitAdmin, 'unit-b', 'Exam')).toThrow(/not found/i);
  });

  it('assertStudentsWritable rejects a santri out of reach, and writes nothing', async () => {
    vi.mocked(prisma.student.findMany).mockResolvedValue([{ id: 's-in' }] as any);

    await expect(assertStudentsWritable(['s-in'], unitAdmin)).resolves.toBeUndefined();
    await expect(assertStudentsWritable(['s-in', 's-out'], unitAdmin)).rejects.toThrow(
      /not found/i
    );
  });

  it('assertStudentsWritable accepts a santri reached only through a relation', async () => {
    vi.mocked(prisma.student.findMany).mockResolvedValue([{ id: 's-in' }] as any);
    const viaRelation = vi.fn(
      async (ids: string[]) => new Set(ids.includes('s-teach') ? ['s-teach'] : [])
    );

    await expect(
      assertStudentsWritable(['s-in', 's-teach'], unitAdmin, viaRelation)
    ).resolves.toBeUndefined();
    expect(viaRelation).toHaveBeenCalledWith(['s-teach']);
  });
});
