import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/prisma', () => ({
  prisma: {
    staff: { findUnique: vi.fn() },
    teacher: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));

import { prisma } from '../../../lib/prisma';
import {
  assertMayManageLeave,
  assertMayManageStaff,
  leaveStaffId,
  resolveNamedStaffId,
  USER_ID_AS_STAFF_ID_MESSAGE,
} from '../hr.service';

const m = prisma as unknown as {
  staff: { findUnique: ReturnType<typeof vi.fn> };
  teacher: { findUnique: ReturnType<typeof vi.fn> };
  user: { findUnique: ReturnType<typeof vi.fn> };
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

describe('resolveNamedStaffId', () => {
  it('accepts a Staff profile id', async () => {
    m.staff.findUnique.mockResolvedValue({ id: 'staff-1' });
    await expect(resolveNamedStaffId('staff-1')).resolves.toBe('staff-1');
    // A real staff id never needs the user fallback.
    expect(m.user.findUnique).not.toHaveBeenCalled();
  });

  it('turns a user id sent as staffId into a clear 400, not 404 "Staff not found"', async () => {
    m.staff.findUnique.mockResolvedValue(null);
    m.user.findUnique.mockResolvedValue({ id: 'user-1' });

    await expect(resolveNamedStaffId('user-1')).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: USER_ID_AS_STAFF_ID_MESSAGE,
    });
  });

  it('keeps the 404 for an id that is neither a staff profile nor a user', async () => {
    m.staff.findUnique.mockResolvedValue(null);
    m.user.findUnique.mockResolvedValue(null);

    await expect(resolveNamedStaffId('11111111-1111-4111-8111-111111111111')).rejects.toMatchObject(
      {
        code: 'NOT_FOUND',
      }
    );
  });
});
