import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/prisma', () => ({
  prisma: {
    staff: { findUnique: vi.fn() },
    teacher: { findUnique: vi.fn() },
  },
}));

import { prisma } from '../../../lib/prisma';
import { assertMayManageLeave, assertMayManageStaff, leaveStaffId } from '../hr.service';

const m = prisma as unknown as {
  staff: { findUnique: ReturnType<typeof vi.fn> };
  teacher: { findUnique: ReturnType<typeof vi.fn> };
};

const SUPER = { sub: 'u-super', roleCode: 'SUPER_ADMIN', role: null, unitId: null };
const UNIT_ADMIN = { sub: 'u-admin', roleCode: 'SDIT_ADMIN', role: null, unitId: 'unit-1' };
const STAFF = { sub: 'u-staff', roleCode: 'STAFF', role: null, unitId: 'unit-1' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('assertMayManageStaff', () => {
  it('lets a super admin manage anyone without a lookup', async () => {
    await expect(assertMayManageStaff(SUPER, 'staff-x')).resolves.toBeUndefined();
    expect(m.staff.findUnique).not.toHaveBeenCalled();
  });

  it('lets a unit admin manage staff inside their own unit', async () => {
    m.staff.findUnique.mockResolvedValue({ unitId: 'unit-1' });
    await expect(assertMayManageStaff(UNIT_ADMIN, 'staff-1')).resolves.toBeUndefined();
  });

  it('refuses a unit admin reaching into another unit', async () => {
    m.staff.findUnique.mockResolvedValue({ unitId: 'unit-2' });
    await expect(assertMayManageStaff(UNIT_ADMIN, 'staff-2')).rejects.toThrow(/di luar unit Anda/i);
  });

  it('refuses a plain staff member managing a colleague', async () => {
    await expect(assertMayManageStaff(STAFF, 'staff-2')).rejects.toThrow(/Hanya admin/i);
    expect(m.staff.findUnique).not.toHaveBeenCalled();
  });
});

describe('assertMayManageLeave', () => {
  it('lets a staff member manage their own leave', async () => {
    m.staff.findUnique.mockResolvedValue({ id: 'staff-1' });
    await expect(
      assertMayManageLeave(STAFF, { staffId: 'staff-1', teacherId: null })
    ).resolves.toBeUndefined();
  });

  it("refuses a staff member managing a colleague's leave", async () => {
    m.staff.findUnique.mockResolvedValue({ id: 'staff-own' });
    await expect(
      assertMayManageLeave(STAFF, { staffId: 'staff-other', teacherId: null })
    ).rejects.toThrow(/milik sendiri/i);
  });

  it('resolves a teacher-filed leave to its Staff identity before deciding', async () => {
    m.teacher.findUnique.mockResolvedValue({ staffId: 'staff-1' });
    m.staff.findUnique.mockResolvedValue({ id: 'staff-1' });
    await expect(
      assertMayManageLeave(STAFF, { staffId: null, teacherId: 'teacher-1' })
    ).resolves.toBeUndefined();
  });

  it('lets a unit admin approve a leave in their unit', async () => {
    m.staff.findUnique.mockResolvedValue({ unitId: 'unit-1' });
    await expect(
      assertMayManageLeave(UNIT_ADMIN, { staffId: 'staff-1', teacherId: null })
    ).resolves.toBeUndefined();
  });
});

describe('leaveStaffId', () => {
  it('passes a staffId straight through', async () => {
    await expect(leaveStaffId({ staffId: 'staff-1', teacherId: null })).resolves.toBe('staff-1');
  });

  it('refuses a leave with neither id', async () => {
    await expect(leaveStaffId({ staffId: null, teacherId: null })).rejects.toThrow(/wajib diisi/i);
  });
});
