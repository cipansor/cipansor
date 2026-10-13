import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/prisma', () => ({
  prisma: {
    leave: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    leaveBalance: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    academicYear: { findFirst: vi.fn() },
    staffAttendance: {
      upsert: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    staff: { findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { prisma } from '../../../lib/prisma';
import { approveLeave, cancelLeave, getStaffAttendanceSummary } from '../hr.service';

const mocked = prisma as unknown as {
  leave: {
    findUnique: ReturnType<typeof vi.fn>;
    findUniqueOrThrow: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  leaveBalance: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  academicYear: { findFirst: ReturnType<typeof vi.fn> };
  staffAttendance: {
    upsert: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
  };
  staff: { findUnique: ReturnType<typeof vi.fn> };
  auditLog: { create: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
  // Run transaction callbacks against the same mocked client.
  mocked.$transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === 'function'
      ? (arg as (tx: unknown) => unknown)(prisma)
      : Promise.all(arg as unknown[])
  );
});

const baseLeave = {
  id: 'leave-1',
  staffId: 'staff-1',
  teacherId: null,
  type: 'ANNUAL',
  status: 'PENDING',
  startDate: new Date('2026-03-02'),
  endDate: new Date('2026-03-03'),
  totalDays: 2,
  staff: { userId: 'user-1' },
  teacher: null,
};

describe('approveLeave', () => {
  it('is idempotent: approving an approved leave does not spend the balance twice', async () => {
    mocked.leave.findUnique.mockResolvedValue({ ...baseLeave, status: 'APPROVED' });
    mocked.leave.findUniqueOrThrow.mockResolvedValue({
      ...baseLeave,
      status: 'APPROVED',
    });

    const result = await approveLeave('leave-1', 'approver-1', {
      status: 'APPROVED',
    } as never);

    expect(result.status).toBe('APPROVED');
    expect(mocked.leaveBalance.update).not.toHaveBeenCalled();
    expect(mocked.staffAttendance.upsert).not.toHaveBeenCalled();
  });

  it('refuses to reject an approved leave (revert by cancelling instead)', async () => {
    mocked.leave.findUnique.mockResolvedValue({ ...baseLeave, status: 'APPROVED' });

    await expect(
      approveLeave('leave-1', 'approver-1', { status: 'REJECTED' } as never)
    ).rejects.toThrow(/tidak dapat diubah/i);
  });

  it('spends the balance once and marks attendance when approving a pending leave', async () => {
    mocked.leave.findUnique.mockResolvedValue({ ...baseLeave, status: 'PENDING' });
    mocked.leave.update.mockResolvedValue({ ...baseLeave, status: 'APPROVED' });
    mocked.academicYear.findFirst.mockResolvedValue({ id: 'ay-1' });
    mocked.leaveBalance.findUnique.mockResolvedValue({ id: 'bal-1' });
    // A day the person already attended: the approval overwrites the status but
    // remembers what it held, so a later cancellation can restore it.
    mocked.staffAttendance.findUnique.mockResolvedValue({
      id: 'att-1',
      status: 'PRESENT',
      leaveRequestId: null,
    });
    mocked.staffAttendance.update.mockResolvedValue({});

    await approveLeave('leave-1', 'approver-1', { status: 'APPROVED' } as never);

    expect(mocked.leaveBalance.update).toHaveBeenCalledTimes(1);
    expect(mocked.leaveBalance.update).toHaveBeenCalledWith({
      where: { id: 'bal-1' },
      data: { usedDays: { increment: 2 }, remainingDays: { decrement: 2 } },
    });
    // One attendance write per calendar day of the leave.
    expect(mocked.staffAttendance.update).toHaveBeenCalledTimes(2);
    expect(mocked.staffAttendance.update.mock.calls[0][0].data.leaveRequestId).toBe('leave-1');
    expect(mocked.staffAttendance.update.mock.calls[0][0].data.leavePreviousStatus).toBe('PRESENT');
    // The approval leaves an audit trail.
    expect(mocked.auditLog.create).toHaveBeenCalledTimes(1);
  });
});

describe('cancelLeave', () => {
  it('restores a day the leave overwrote and removes a day it created', async () => {
    mocked.leave.findUnique.mockResolvedValue({ ...baseLeave, status: 'APPROVED' });
    mocked.academicYear.findFirst.mockResolvedValue({ id: 'ay-1' });
    mocked.leaveBalance.findUnique.mockResolvedValue({ id: 'bal-1' });
    mocked.leave.update.mockResolvedValue({ ...baseLeave, status: 'CANCELLED' });
    // Day 1 already held PRESENT (with a note) before the leave; day 2 was
    // created by it.
    mocked.staffAttendance.findMany.mockResolvedValue([
      { id: 'att-1', leavePreviousStatus: 'PRESENT', leavePreviousNotes: 'Hadir tepat waktu' },
      { id: 'att-2', leavePreviousStatus: null, leavePreviousNotes: null },
    ]);
    mocked.staffAttendance.update.mockResolvedValue({});
    mocked.staffAttendance.delete.mockResolvedValue({});

    await cancelLeave('leave-1');

    expect(mocked.leaveBalance.update).toHaveBeenCalledWith({
      where: { id: 'bal-1' },
      data: { usedDays: { decrement: 2 }, remainingDays: { increment: 2 } },
    });
    // Matched by leave id, not by a status + generic note.
    expect(mocked.staffAttendance.findMany.mock.calls[0][0].where.leaveRequestId).toBe('leave-1');
    // The pre-existing day is restored; only the leave-only day is removed.
    expect(mocked.staffAttendance.update.mock.calls[0][0].where).toEqual({ id: 'att-1' });
    expect(mocked.staffAttendance.update.mock.calls[0][0].data.status).toBe('PRESENT');
    // The original explanation comes back too, not null.
    expect(mocked.staffAttendance.update.mock.calls[0][0].data.notes).toBe('Hadir tepat waktu');
    expect(mocked.staffAttendance.delete.mock.calls[0][0].where).toEqual({ id: 'att-2' });
    expect(mocked.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('does not touch the balance when cancelling a pending leave', async () => {
    mocked.leave.findUnique.mockResolvedValue({ ...baseLeave, status: 'PENDING' });
    mocked.leave.update.mockResolvedValue({ ...baseLeave, status: 'CANCELLED' });

    await cancelLeave('leave-1');

    expect(mocked.leaveBalance.update).not.toHaveBeenCalled();
    expect(mocked.staffAttendance.deleteMany).not.toHaveBeenCalled();
  });
});

describe('getStaffAttendanceSummary unit scope', () => {
  it('forbids a unit admin from reading another unit\u2019s staff summary', async () => {
    mocked.staff.findUnique.mockResolvedValue({ unitId: 'unit-2' });

    await expect(getStaffAttendanceSummary('staff-1', 3, 2026, 'unit-1')).rejects.toThrow(
      /di luar unit/i
    );
  });

  it('allows the summary for staff in the admin\u2019s own unit', async () => {
    mocked.staff.findUnique.mockResolvedValue({ unitId: 'unit-1' });
    mocked.staffAttendance.findMany.mockResolvedValue([]);

    const summary = await getStaffAttendanceSummary('staff-1', 3, 2026, 'unit-1');
    expect(summary.staffId).toBe('staff-1');
  });
});
