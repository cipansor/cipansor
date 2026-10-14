import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LeaveStatus, LeaveType, StaffAttendanceStatus } from '@prisma/client';

// `prisma` is fully mocked. Two helpers keep the mock faithful to Prisma:
//
//  * `lazy(impl)` returns a thenable whose body runs only when it is awaited.
//    Prisma's array `$transaction([...])` receives *operations that have not run
//    yet*; a `mockResolvedValue` call, by contrast, executes at call time, so a
//    test counting writes cannot tell "the operation ran" from "the operation
//    was merely constructed". Handing the array `lazy(...)` writes and counting
//    inside `impl` is what makes the count mean execution.
//  * the callback form runs against a client snapshot and restores it if the
//    callback throws — the closest a mock can get to a real transaction, and
//    enough to prove that no partial write survives a mid-transaction failure.
const { prismaMock, runTransaction, lazy } = vi.hoisted(() => {
  /** A thenable Prisma-style operation that runs `impl` only when awaited. */
  const lazy = <T>(impl: () => T | Promise<T>) => ({
    then: (onFulfilled: (v: T) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve().then(impl).then(onFulfilled, onRejected),
  });

  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

  const runTransaction = async (arg: unknown, client: Record<string, any>): Promise<unknown> => {
    if (typeof arg === 'function') {
      // `__store` is the in-memory state the write mocks mutate (a real
      // transaction writes to the DB and rolls it back). Snapshot it before the
      // callback and put it back if the callback throws, so a test can observe
      // that a failed transaction changed nothing. `inTransaction` marks the
      // scope a real transaction holds: a read that lands while it is set is a
      // read no concurrent statement can slip in front of.
      const store = client.__store;
      const snapshot = store ? clone(store) : undefined;
      if (store) store.inTransaction = true;
      try {
        return await (arg as (tx: typeof client) => unknown)(client);
      } catch (error) {
        if (snapshot !== undefined) client.__store = snapshot;
        throw error;
      } finally {
        if (client.__store) client.__store.inTransaction = false;
      }
    }
    // Prisma's array form issues the operations in order and stops at the
    // first rejection; it never reports a later operation as done.
    const results: unknown[] = [];
    for (const op of arg as unknown[]) {
      results.push(await op);
    }
    return results;
  };

  const prismaMock: Record<string, any> = {
    leave: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findMany: vi.fn(),
      aggregate: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    staff: { findUnique: vi.fn() },
    teacher: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    academicYear: { findFirst: vi.fn() },
    leaveBalance: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    leaveTypeConfig: { findUnique: vi.fn() },
    staffAttendance: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      findMany: vi.fn(),
    },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
    // Emulated row store: write mocks mutate it, `runTransaction` snapshots and
    // restores it, so a test can read the effect of a failed transaction.
    __store: {
      attendance: [] as unknown[],
      balanceUpdated: false,
      leaveStatus: '' as string,
      inTransaction: false,
    },
  };
  prismaMock.$transaction.mockImplementation((arg: unknown) => runTransaction(arg, prismaMock));
  return { prismaMock, runTransaction, lazy };
});

vi.mock('../../../lib/prisma', () => ({ prisma: prismaMock }));

import {
  createLeave,
  approveLeave,
  cancelLeave,
  deleteLeave,
  getLeaveBalance,
  getStaffAttendanceSummary,
} from '../hr.service';

const db = prismaMock as {
  leave: Record<string, ReturnType<typeof vi.fn>>;
  staff: { findUnique: ReturnType<typeof vi.fn> };
  teacher: { findUnique: ReturnType<typeof vi.fn> };
  user: { findUnique: ReturnType<typeof vi.fn> };
  academicYear: { findFirst: ReturnType<typeof vi.fn> };
  leaveBalance: Record<string, ReturnType<typeof vi.fn>>;
  leaveTypeConfig: { findUnique: ReturnType<typeof vi.fn> };
  staffAttendance: Record<string, ReturnType<typeof vi.fn>>;
  auditLog: { create: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
  __store: {
    attendance: unknown[];
    balanceUpdated: boolean;
    leaveStatus: string;
    inTransaction: boolean;
  };
};

const STAFF = '11111111-1111-4111-8111-111111111111';

/** A leave row as `approveLeave`/`cancelLeave` read it, with the includes. */
function leaveRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'leave-1',
    staffId: STAFF,
    teacherId: null,
    type: LeaveType.ANNUAL,
    status: LeaveStatus.PENDING,
    startDate: new Date('2026-01-05T00:00:00.000Z'),
    endDate: new Date('2026-01-06T00:00:00.000Z'),
    totalDays: 2,
    staff: { userId: 'user-1' },
    teacher: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation((arg: unknown) => runTransaction(arg, prismaMock));
  db.leave.findFirst.mockResolvedValue(null);
  db.leave.aggregate.mockResolvedValue({ _sum: { totalDays: 0 } });
  // The status moves (`approveLeave`, `cancelLeave`) are guarded `updateMany`s;
  // by default they match the one row the service expects.
  db.leave.updateMany.mockResolvedValue({ count: 1 });
  db.leaveBalance.findUnique.mockResolvedValue(null);
  db.leaveBalance.findMany.mockResolvedValue([]);
  db.leaveTypeConfig.findUnique.mockResolvedValue(null);
  db.__store.attendance = [];
  db.__store.balanceUpdated = false;
  db.__store.leaveStatus = LeaveStatus.PENDING;
  db.__store.inTransaction = false;
  db.leave.create.mockImplementation(async ({ data }: { data: unknown }) => ({
    id: 'leave-1',
    ...(data as object),
  }));
});

describe('createLeave', () => {
  it('rejects a request with neither a staffId nor a teacherId before touching the database', async () => {
    await expect(
      createLeave({
        type: LeaveType.SICK,
        startDate: '2026-01-05T00:00:00.000Z',
        endDate: '2026-01-05T00:00:00.000Z',
        reason: 'demam',
      })
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringMatching(/staffId or teacherId/),
    });

    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.leave.create).not.toHaveBeenCalled();
  });

  it('counts both end days of a leave (inclusive totalDays)', async () => {
    await createLeave({
      staffId: STAFF,
      type: LeaveType.SICK,
      startDate: '2026-01-05T00:00:00.000Z',
      endDate: '2026-01-07T00:00:00.000Z',
      reason: 'demam',
    });

    expect(db.leave.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ totalDays: 3, staffId: STAFF, type: LeaveType.SICK }),
      })
    );
  });

  it('refuses a leave that overlaps a pending or approved request', async () => {
    db.leave.findFirst.mockResolvedValue({ id: 'existing' });

    await expect(
      createLeave({
        staffId: STAFF,
        type: LeaveType.SICK,
        startDate: '2026-01-05T00:00:00.000Z',
        endDate: '2026-01-05T00:00:00.000Z',
        reason: 'demam',
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringMatching(/overlaps/) });

    expect(db.leave.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        status: { in: [LeaveStatus.PENDING, LeaveStatus.APPROVED] },
        staffId: STAFF,
        OR: [
          {
            startDate: { lte: new Date('2026-01-05T00:00:00.000Z') },
            endDate: { gte: new Date('2026-01-05T00:00:00.000Z') },
          },
        ],
      }),
    });
    expect(db.leave.create).not.toHaveBeenCalled();
  });

  it('does not check a balance for a non-annual leave', async () => {
    await createLeave({
      staffId: STAFF,
      type: LeaveType.SICK,
      startDate: '2026-01-05T00:00:00.000Z',
      endDate: '2026-01-05T00:00:00.000Z',
      reason: 'demam',
    });

    expect(db.academicYear.findFirst).not.toHaveBeenCalled();
    expect(db.leaveBalance.findUnique).not.toHaveBeenCalled();
    expect(db.leave.create).toHaveBeenCalled();
  });

  it('refuses an annual leave with no academic year covering the dates', async () => {
    db.staff.findUnique.mockResolvedValue({ userId: 'user-1' });
    db.academicYear.findFirst.mockResolvedValue(null);

    await expect(
      createLeave({
        staffId: STAFF,
        type: LeaveType.ANNUAL,
        startDate: '2026-06-01T00:00:00.000Z',
        endDate: '2026-06-03T00:00:00.000Z',
        reason: 'cuti tahunan',
      })
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringMatching(/Academic Year/),
    });
    expect(db.leave.create).not.toHaveBeenCalled();
  });

  it('counts pending requests against the balance before allowing more annual leave', async () => {
    db.staff.findUnique.mockResolvedValue({ userId: 'user-1' });
    db.academicYear.findFirst.mockResolvedValue({
      id: 'ay-1',
      startDate: new Date('2025-07-01T00:00:00.000Z'),
      endDate: new Date('2026-06-30T00:00:00.000Z'),
    });
    db.leave.aggregate.mockResolvedValue({ _sum: { totalDays: 3 } });
    db.leaveBalance.findUnique.mockResolvedValue({ remainingDays: 5 });

    await expect(
      createLeave({
        staffId: STAFF,
        type: LeaveType.ANNUAL,
        startDate: '2026-01-05T00:00:00.000Z',
        endDate: '2026-01-08T00:00:00.000Z',
        reason: 'cuti tahunan',
      })
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringMatching(/Remaining: 2 days/),
    });
    expect(db.leave.create).not.toHaveBeenCalled();
  });

  it('creates an annual leave when the balance covers it', async () => {
    db.staff.findUnique.mockResolvedValue({ userId: 'user-1' });
    db.academicYear.findFirst.mockResolvedValue({
      id: 'ay-1',
      startDate: new Date('2025-07-01T00:00:00.000Z'),
      endDate: new Date('2026-06-30T00:00:00.000Z'),
    });
    db.leave.aggregate.mockResolvedValue({ _sum: { totalDays: 0 } });
    db.leaveBalance.findUnique.mockResolvedValue({ remainingDays: 10 });

    await createLeave({
      staffId: STAFF,
      type: LeaveType.ANNUAL,
      startDate: '2026-01-05T00:00:00.000Z',
      endDate: '2026-01-07T00:00:00.000Z',
      reason: 'cuti tahunan',
    });

    expect(db.leave.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ totalDays: 3 }) })
    );
  });

  it('falls back to a 12-day quota when no balance row exists, counting approved and pending days', async () => {
    db.staff.findUnique.mockResolvedValue({ userId: 'user-1' });
    db.academicYear.findFirst.mockResolvedValue({
      id: 'ay-1',
      startDate: new Date('2025-07-01T00:00:00.000Z'),
      endDate: new Date('2026-06-30T00:00:00.000Z'),
    });
    db.leaveBalance.findUnique.mockResolvedValue(null);
    // First aggregate is pending (2), second is approved (8): 12 - 10 = 2 remaining.
    db.leave.aggregate
      .mockResolvedValueOnce({ _sum: { totalDays: 2 } })
      .mockResolvedValueOnce({ _sum: { totalDays: 8 } });

    await expect(
      createLeave({
        staffId: STAFF,
        type: LeaveType.ANNUAL,
        startDate: '2026-01-05T00:00:00.000Z',
        endDate: '2026-01-08T00:00:00.000Z',
        reason: 'cuti tahunan',
      })
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringMatching(/Remaining: 2 days/),
    });

    expect(db.leave.aggregate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({ status: LeaveStatus.APPROVED }),
      })
    );
  });

  it('propagates a create failure from inside the transaction', async () => {
    let created = false;
    db.leave.create.mockImplementation(async () => {
      created = true;
      throw new Error('duplicate key');
    });

    await expect(
      createLeave({
        staffId: STAFF,
        type: LeaveType.SICK,
        startDate: '2026-01-05T00:00:00.000Z',
        endDate: '2026-01-05T00:00:00.000Z',
        reason: 'demam',
      })
    ).rejects.toThrow(/duplicate key/);

    // The mocked create ran but has no store and no rollback, so this pins only
    // that the failure is propagated, not that a row was left behind.
    expect(created).toBe(true);
    expect(db.leave.create).toHaveBeenCalledTimes(1);
  });
});

describe('$transaction mock', () => {
  // The helper stands in for Prisma, so tests pin its two shapes directly.
  type LazyOp = {
    then: (
      onFulfilled: (value: unknown) => unknown,
      onRejected?: (reason: unknown) => unknown
    ) => unknown;
  };

  it('runs the array form sequentially and stops at the first rejection', async () => {
    const started: string[] = [];
    const op = (label: string, fail = false): LazyOp => ({
      then: (onFulfilled, onRejected) => {
        started.push(label);
        return (fail ? Promise.reject(new Error('op 2 failed')) : Promise.resolve(label)).then(
          onFulfilled,
          onRejected
        );
      },
    });

    await expect(
      runTransaction([op('op1'), op('bail', true), op('op3')], prismaMock)
    ).rejects.toThrow(/op 2 failed/);
    // op3 was never started: Prisma stops at the first rejection, `Promise.all`
    // would have started it too.
    expect(started).toEqual(['op1', 'bail']);
  });

  it('does not execute a lazy operation until it is awaited', async () => {
    let ran = false;
    const op = lazy(() => {
      ran = true;
      return 'done';
    });

    // Merely constructing the thenable must not run `impl`; a `mockResolvedValue`
    // call would already have executed it by now.
    expect(ran).toBe(false);
    await expect(op).resolves.toBe('done');
    expect(ran).toBe(true);
  });

  it('runs the callback form against a client it restores when the callback throws', async () => {
    const client = { __store: { attendance: [] as unknown[] } };
    const seen = await runTransaction(
      (tx: typeof client) => {
        tx.__store.attendance.push('day-1');
        return tx.__store.attendance.length;
      },
      client as unknown as Record<string, any>
    );
    expect(seen).toBe(1);
    // A successful callback keeps what it wrote.
    expect(client.__store.attendance).toEqual(['day-1']);

    // A throw inside the callback leaves the store exactly as it was.
    await expect(
      runTransaction(
        (tx: typeof client) => {
          tx.__store.attendance.push('day-2', 'day-3');
          throw new Error('boom');
        },
        client as unknown as Record<string, any>
      )
    ).rejects.toThrow(/boom/);
    expect(client.__store.attendance).toEqual(['day-1']);
  });
});

describe('approveLeave', () => {
  it('is idempotent: approving an approved leave does not spend the balance twice', async () => {
    db.leave.findUnique.mockResolvedValue(leaveRow({ status: LeaveStatus.APPROVED }));
    db.leave.findUniqueOrThrow.mockResolvedValue(leaveRow({ status: LeaveStatus.APPROVED }));

    const result = await approveLeave('leave-1', 'approver-1', {
      status: LeaveStatus.APPROVED,
    });

    expect(result.status).toBe(LeaveStatus.APPROVED);
    expect(db.leaveBalance.update).not.toHaveBeenCalled();
    expect(db.staffAttendance.upsert).not.toHaveBeenCalled();
    expect(db.staffAttendance.update).not.toHaveBeenCalled();
    expect(db.staffAttendance.create).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it('refuses to reject an already approved leave (cancel it first)', async () => {
    db.leave.findUnique.mockResolvedValue(leaveRow({ status: LeaveStatus.APPROVED }));

    await expect(
      approveLeave('leave-1', 'approver-1', { status: LeaveStatus.REJECTED })
    ).rejects.toThrow(/tidak dapat diubah/i);
    expect(db.leave.update).not.toHaveBeenCalled();
  });

  it('records a rejection note and touches neither the balance nor attendance', async () => {
    db.leave.findUnique.mockResolvedValue(leaveRow({ status: LeaveStatus.PENDING }));
    db.leave.findUniqueOrThrow.mockResolvedValue(
      leaveRow({ status: LeaveStatus.REJECTED, staff: null, teacher: { userId: 'user-1' } })
    );

    await approveLeave('leave-1', 'approver-1', {
      status: LeaveStatus.REJECTED,
      rejectedNote: 'staf tidak cukup',
    });

    // The rejection move is guarded on PENDING, like approval.
    expect(db.leave.updateMany).toHaveBeenCalledWith({
      where: { id: 'leave-1', status: LeaveStatus.PENDING },
      data: expect.objectContaining({
        status: LeaveStatus.REJECTED,
        rejectedNote: 'staf tidak cukup',
        approvedById: 'approver-1',
      }),
    });
    // The move and the row reported for it run in one transaction, so the
    // response cannot show a decision a concurrent request made in between.
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.leaveBalance.update).not.toHaveBeenCalled();
    expect(db.staffAttendance.upsert).not.toHaveBeenCalled();
    expect(db.staffAttendance.update).not.toHaveBeenCalled();
    expect(db.staffAttendance.create).not.toHaveBeenCalled();
  });

  it('reads the rejected row inside the transaction, not after it', async () => {
    db.leave.findUnique.mockResolvedValue(leaveRow({ status: LeaveStatus.PENDING }));
    db.leave.findUniqueOrThrow.mockImplementation(async () => {
      // A real transaction holds the row lock until commit; the read that
      // builds the response must happen in that scope, or a `cancelLeave` or
      // `deleteLeave` could move or remove the row between write and read.
      expect(db.__store.inTransaction).toBe(true);
      return leaveRow({ status: LeaveStatus.REJECTED });
    });

    await approveLeave('leave-1', 'approver-1', { status: LeaveStatus.REJECTED });

    expect(db.leave.findUniqueOrThrow).toHaveBeenCalledTimes(1);
    expect(db.__store.inTransaction).toBe(false);
  });

  it('refuses a rejection whose pending status was decided by a concurrent request', async () => {
    db.leave.findUnique.mockResolvedValue(leaveRow({ status: LeaveStatus.PENDING }));
    // The in-transaction read sees PENDING, but the guarded move matches
    // nothing: a concurrent decision committed between the read and the update.
    db.leave.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      approveLeave('leave-1', 'approver-1', { status: LeaveStatus.REJECTED })
    ).rejects.toThrow(/sudah diputuskan/i);

    // A 409 carries no row, so nothing is read back for one.
    expect(db.leave.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(db.leaveBalance.update).not.toHaveBeenCalled();
    expect(db.staffAttendance.create).not.toHaveBeenCalled();
  });

  it('re-rejecting an already rejected leave is an idempotent no-op', async () => {
    // The guard's snapshot still says PENDING, but a first rejection already
    // committed. The decision is taken on the row read inside the transaction,
    // so the second rejection succeeds and writes nothing — it must not turn
    // into a 409 just because the guard's status no longer matches the row.
    db.leave.findUnique
      .mockResolvedValueOnce(leaveRow({ status: LeaveStatus.PENDING }))
      .mockResolvedValueOnce(leaveRow({ status: LeaveStatus.REJECTED }));

    const result = await approveLeave('leave-1', 'approver-1', {
      status: LeaveStatus.REJECTED,
      rejectedNote: 'staf tidak cukup',
    });

    expect(result.status).toBe(LeaveStatus.REJECTED);
    expect(db.leave.updateMany).not.toHaveBeenCalled();
    expect(db.leave.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(db.leaveBalance.update).not.toHaveBeenCalled();
    expect(db.staffAttendance.create).not.toHaveBeenCalled();
  });

  it('refuses a rejection when the row read inside the transaction is already approved', async () => {
    // The guard sees PENDING; an approval commits before this transaction's
    // read. Reading the row inside the transaction — not trusting the snapshot —
    // is what lets the rejection see APPROVED and refuse, instead of
    // overwriting a balance the approval has already spent.
    db.leave.findUnique
      .mockResolvedValueOnce(leaveRow({ status: LeaveStatus.PENDING }))
      .mockResolvedValueOnce(leaveRow({ status: LeaveStatus.APPROVED }));

    await expect(
      approveLeave('leave-1', 'approver-1', { status: LeaveStatus.REJECTED })
    ).rejects.toThrow(/sudah diputuskan/i);

    expect(db.leave.updateMany).not.toHaveBeenCalled();
    expect(db.leaveBalance.update).not.toHaveBeenCalled();
    expect(db.staffAttendance.create).not.toHaveBeenCalled();
  });

  it('spends the balance once and marks attendance when approving a pending leave', async () => {
    db.leave.findUnique.mockResolvedValue(leaveRow({ status: LeaveStatus.PENDING }));
    db.leave.findUniqueOrThrow.mockResolvedValue(leaveRow({ status: LeaveStatus.APPROVED }));
    db.academicYear.findFirst.mockResolvedValue({ id: 'ay-1' });
    db.leaveBalance.findUnique.mockResolvedValue({ id: 'bal-1' });
    // A day the person already attended: the approval overwrites the status but
    // remembers what it held, so a later cancellation can restore it.
    db.staffAttendance.findUnique.mockResolvedValue({
      id: 'att-1',
      status: StaffAttendanceStatus.PRESENT,
      notes: 'Hadir tepat waktu',
      leaveRequestId: null,
    });
    db.staffAttendance.update.mockResolvedValue({});

    await approveLeave('leave-1', 'approver-1', { status: LeaveStatus.APPROVED });

    // The status move is guarded on PENDING, so a concurrent decision loses.
    expect(db.leave.updateMany).toHaveBeenCalledWith({
      where: { id: 'leave-1', status: LeaveStatus.PENDING },
      data: expect.objectContaining({
        status: LeaveStatus.APPROVED,
        approvedById: 'approver-1',
      }),
    });
    expect(db.leaveBalance.update).toHaveBeenCalledTimes(1);
    expect(db.leaveBalance.update).toHaveBeenCalledWith({
      where: { id: 'bal-1' },
      data: { usedDays: { increment: 2 }, remainingDays: { decrement: 2 } },
    });
    // One attendance write per calendar day of the leave.
    expect(db.staffAttendance.update).toHaveBeenCalledTimes(2);
    expect(db.staffAttendance.update.mock.calls[0][0].data.leaveRequestId).toBe('leave-1');
    expect(db.staffAttendance.update.mock.calls[0][0].data.leavePreviousStatus).toBe(
      StaffAttendanceStatus.PRESENT
    );
    expect(db.staffAttendance.update.mock.calls[0][0].data.leavePreviousNotes).toBe(
      'Hadir tepat waktu'
    );
    // The approval leaves an audit trail.
    expect(db.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('marks attendance on the dates the transaction wrote, not the guard\u2019s stale snapshot', async () => {
    // The guard reads January 5–6; `updateLeave` commits January 10–11 before
    // the approval's own row update. The attendance days must follow the row the
    // transaction returns, or the leave is approved for dates it never marks.
    db.leave.findUnique.mockResolvedValue(
      leaveRow({
        status: LeaveStatus.PENDING,
        startDate: new Date('2026-01-05T00:00:00.000Z'),
        endDate: new Date('2026-01-06T00:00:00.000Z'),
        totalDays: 2,
      })
    );
    db.leave.findUniqueOrThrow.mockResolvedValue(
      leaveRow({
        status: LeaveStatus.APPROVED,
        startDate: new Date('2026-01-10T00:00:00.000Z'),
        endDate: new Date('2026-01-11T00:00:00.000Z'),
        totalDays: 2,
      })
    );
    db.academicYear.findFirst.mockResolvedValue({ id: 'ay-1' });
    db.leaveBalance.findUnique.mockResolvedValue({ id: 'bal-1' });
    db.staffAttendance.findUnique.mockResolvedValue(null);
    db.staffAttendance.create.mockResolvedValue({});

    await approveLeave('leave-1', 'approver-1', { status: LeaveStatus.APPROVED });

    const marked = db.staffAttendance.create.mock.calls.map((call) =>
      (call[0] as { data: { date: Date } }).data.date.toISOString()
    );
    expect(marked).toEqual(['2026-01-10T00:00:00.000Z', '2026-01-11T00:00:00.000Z']);
  });

  it('refuses an approval whose pending status was decided by a concurrent request', async () => {
    db.leave.findUnique.mockResolvedValue(leaveRow({ status: LeaveStatus.PENDING }));
    // The guarded move matches nothing: another request decided the row first.
    db.leave.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      approveLeave('leave-1', 'approver-1', { status: LeaveStatus.APPROVED })
    ).rejects.toThrow(/sudah diputuskan/i);

    expect(db.leaveBalance.update).not.toHaveBeenCalled();
    expect(db.staffAttendance.create).not.toHaveBeenCalled();
    expect(db.staffAttendance.update).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it('rolls back the whole approval when the last attendance day refuses', async () => {
    // A 3-day leave: day 1 and day 2 write, day 3 refuses. The date range comes
    // from the row the transaction returns, so the fixture feeding
    // `findUniqueOrThrow` sets it.
    db.leave.findUnique.mockResolvedValue(
      leaveRow({
        status: LeaveStatus.PENDING,
        startDate: new Date('2026-01-05T00:00:00.000Z'),
        endDate: new Date('2026-01-07T00:00:00.000Z'),
        totalDays: 3,
      })
    );
    db.leave.findUniqueOrThrow.mockResolvedValue(
      leaveRow({
        status: LeaveStatus.APPROVED,
        startDate: new Date('2026-01-05T00:00:00.000Z'),
        endDate: new Date('2026-01-07T00:00:00.000Z'),
        totalDays: 3,
      })
    );
    db.academicYear.findFirst.mockResolvedValue({ id: 'ay-1' });
    db.leaveBalance.findUnique.mockResolvedValue({ id: 'bal-1' });
    db.staffAttendance.findUnique.mockResolvedValue(null);

    // The writes are lazy: `impl` runs only when awaited, and it records its
    // effect in `__store` just as a real write would touch the DB. A lazy
    // operation that is never awaited writes nothing.
    let attempted = 0;
    db.leave.updateMany.mockImplementation(async ({ data }: { data: { status: LeaveStatus } }) => {
      db.__store.leaveStatus = data.status;
      return { count: 1 };
    });
    db.staffAttendance.create.mockImplementation(() =>
      lazy(() => {
        attempted += 1;
        if (attempted === 3) throw new Error('deadlock');
        db.__store.attendance.push({ day: attempted });
        return { id: `att-${attempted}` };
      })
    );
    db.leaveBalance.update.mockImplementation(() =>
      lazy(() => {
        db.__store.balanceUpdated = true;
        return { id: 'bal-1' };
      })
    );

    await expect(
      approveLeave('leave-1', 'approver-1', { status: LeaveStatus.APPROVED })
    ).rejects.toThrow(/deadlock/);

    // Day 3 was attempted, no fourth day followed.
    expect(attempted).toBe(3);
    // The transaction rolled back: the status update, the balance decrement and
    // the two attendance writes that ran before the failure all revert. The
    // status matters most — left APPROVED, a retry would short-circuit at the
    // guard and a later cancellation would credit days never spent.
    expect(db.__store.leaveStatus).toBe(LeaveStatus.PENDING);
    expect(db.__store.balanceUpdated).toBe(false);
    expect(db.__store.attendance).toEqual([]);
    // The audit trail is written only after the transaction succeeds.
    expect(db.auditLog.create).not.toHaveBeenCalled();

    // The consequence the reviewer named: because the status reverted, a
    // cancellation of this (still pending) request must not credit the balance.
    db.leave.findUnique.mockResolvedValue(
      leaveRow({ status: db.__store.leaveStatus as LeaveStatus })
    );
    db.leave.findUniqueOrThrow.mockResolvedValue(leaveRow({ status: LeaveStatus.CANCELLED }));
    const balanceWrites = db.leaveBalance.update.mock.calls.length;

    await cancelLeave('leave-1');

    expect(db.leaveBalance.update.mock.calls.length).toBe(balanceWrites);
    expect(db.staffAttendance.findMany).not.toHaveBeenCalled();
  });
});

describe('cancelLeave', () => {
  it('restores a day the leave overwrote and removes a day it created', async () => {
    db.leave.findUnique.mockResolvedValue(leaveRow({ status: LeaveStatus.APPROVED }));
    db.academicYear.findFirst.mockResolvedValue({ id: 'ay-1' });
    db.leaveBalance.findUnique.mockResolvedValue({ id: 'bal-1' });
    db.leave.findUniqueOrThrow.mockResolvedValue(leaveRow({ status: LeaveStatus.CANCELLED }));
    // Day 1 already held PRESENT (with a note) before the leave; day 2 was
    // created by it.
    db.staffAttendance.findMany.mockResolvedValue([
      {
        id: 'att-1',
        leavePreviousStatus: StaffAttendanceStatus.PRESENT,
        leavePreviousNotes: 'Hadir tepat waktu',
      },
      { id: 'att-2', leavePreviousStatus: null, leavePreviousNotes: null },
    ]);
    db.staffAttendance.update.mockResolvedValue({});
    db.staffAttendance.delete.mockResolvedValue({});

    await cancelLeave('leave-1');

    // The move is guarded on the status the guard read, so a racing decision
    // cannot be overwritten.
    expect(db.leave.updateMany).toHaveBeenCalledWith({
      where: { id: 'leave-1', status: LeaveStatus.APPROVED },
      data: { status: LeaveStatus.CANCELLED },
    });
    expect(db.leaveBalance.update).toHaveBeenCalledWith({
      where: { id: 'bal-1' },
      data: { usedDays: { decrement: 2 }, remainingDays: { increment: 2 } },
    });
    // Matched by leave id, not by a status + generic note.
    expect(db.staffAttendance.findMany.mock.calls[0][0].where.leaveRequestId).toBe('leave-1');
    // The pre-existing day is restored; only the leave-only day is removed.
    expect(db.staffAttendance.update.mock.calls[0][0].where).toEqual({ id: 'att-1' });
    expect(db.staffAttendance.update.mock.calls[0][0].data.status).toBe(
      StaffAttendanceStatus.PRESENT
    );
    expect(db.staffAttendance.update.mock.calls[0][0].data.notes).toBe('Hadir tepat waktu');
    expect(db.staffAttendance.delete.mock.calls[0][0].where).toEqual({ id: 'att-2' });
    expect(db.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('does not touch the balance when cancelling a pending leave', async () => {
    db.leave.findUnique.mockResolvedValue(leaveRow({ status: LeaveStatus.PENDING }));
    db.leave.findUniqueOrThrow.mockResolvedValue(leaveRow({ status: LeaveStatus.CANCELLED }));

    await cancelLeave('leave-1');

    expect(db.leaveBalance.update).not.toHaveBeenCalled();
    expect(db.staffAttendance.deleteMany).not.toHaveBeenCalled();
    expect(db.staffAttendance.findMany).not.toHaveBeenCalled();
  });

  it('refuses a cancellation whose row was already decided by a concurrent request', async () => {
    db.leave.findUnique.mockResolvedValue(leaveRow({ status: LeaveStatus.PENDING }));
    // The guarded move matches nothing: another request decided the row first.
    db.leave.updateMany.mockResolvedValue({ count: 0 });

    await expect(cancelLeave('leave-1')).rejects.toThrow(/sudah diputuskan/i);

    expect(db.leaveBalance.update).not.toHaveBeenCalled();
    expect(db.staffAttendance.findMany).not.toHaveBeenCalled();
  });
});

describe('deleteLeave', () => {
  it('refuses to delete an approved leave', async () => {
    db.leave.findUnique.mockResolvedValue({ id: 'leave-1', status: LeaveStatus.APPROVED });

    await expect(deleteLeave('leave-1')).rejects.toThrow(/Cannot delete approved leave/);
    expect(db.leave.delete).not.toHaveBeenCalled();
  });

  it('deletes a leave that is not approved', async () => {
    db.leave.findUnique.mockResolvedValue({ id: 'leave-1', status: LeaveStatus.PENDING });
    db.leave.delete.mockResolvedValue({ id: 'leave-1' });

    await deleteLeave('leave-1');

    expect(db.leave.delete).toHaveBeenCalledWith({ where: { id: 'leave-1' } });
  });
});

describe('getLeaveBalance', () => {
  it('resolves a staff id to its user and reports the stored annual balance', async () => {
    db.user.findUnique.mockResolvedValue(null);
    db.staff.findUnique.mockResolvedValue({ userId: 'user-1' });
    db.academicYear.findFirst.mockResolvedValue({ id: 'ay-1' });
    db.leaveBalance.findMany.mockResolvedValue([
      { leaveType: LeaveType.ANNUAL, totalDays: 14, usedDays: 4, remainingDays: 10 },
      { leaveType: LeaveType.SICK, totalDays: 0, usedDays: 2, remainingDays: 0 },
    ]);

    const result = await getLeaveBalance(STAFF, 2026);

    expect(result).toMatchObject({
      employeeId: STAFF,
      year: 2026,
      annualQuota: 14,
      usedAnnual: 4,
      remainingAnnual: 10,
      totalUsed: 6,
    });
    expect(result.usedByType).toEqual({ [LeaveType.ANNUAL]: 4, [LeaveType.SICK]: 2 });
    // The stored rows matched this user's own id, not a different employee's.
    expect(db.leaveBalance.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', academicYearId: 'ay-1' },
    });
  });

  it('falls back with no rows for an employee the query does not match', async () => {
    db.user.findUnique.mockResolvedValue({ id: 'user-1' });
    db.academicYear.findFirst.mockResolvedValue(null);
    // Argument-aware: the fixture returns rows only when the fallback actually
    // filtered on this employee's staffId/teacherId. A fallback that dropped
    // the filter would get these rows and report 7, not the empty-branch 12.
    db.leave.findMany.mockImplementation(async (args: { where?: { OR?: unknown[] } }) => {
      const or = args?.where?.OR ?? [];
      const matches = or.some(
        (c) =>
          (c as { staffId?: string }).staffId === 'user-1' ||
          (c as { teacherId?: string }).teacherId === 'user-1'
      );
      return matches
        ? [
            { type: LeaveType.ANNUAL, totalDays: 3 },
            { type: LeaveType.ANNUAL, totalDays: 2 },
          ]
        : [];
    });

    const result = await getLeaveBalance('user-1', 2026);

    expect(result).toMatchObject({ annualQuota: 12, usedAnnual: 5, remainingAnnual: 7 });
    expect(db.leave.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ staffId: 'user-1' }, { teacherId: 'user-1' }],
          status: LeaveStatus.APPROVED,
        }),
      })
    );
  });

  it('reports the full quota when the fallback yields no leaves for the year', async () => {
    db.user.findUnique.mockResolvedValue({ id: 'user-2' });
    db.academicYear.findFirst.mockResolvedValue(null);
    // Argument-aware, and it answers with rows when the query does *not* name
    // this employee: a fallback that skipped the filter would receive those
    // rows and report 3 used / 9 remaining, not the empty-branch 0 / 12.
    db.leave.findMany.mockImplementation(async (args: { where?: { OR?: unknown[] } }) => {
      const or = args?.where?.OR ?? [];
      const matches = or.some(
        (c) =>
          (c as { staffId?: string }).staffId === 'user-2' ||
          (c as { teacherId?: string }).teacherId === 'user-2'
      );
      return matches ? [] : [{ type: LeaveType.ANNUAL, totalDays: 9 }];
    });

    const result = await getLeaveBalance('user-2', 2026);

    expect(result).toMatchObject({ annualQuota: 12, usedAnnual: 0, remainingAnnual: 12 });
    expect(db.leave.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ OR: [{ staffId: 'user-2' }, { teacherId: 'user-2' }] }),
      })
    );
  });

  it('honours the configured entitlement instead of the 12-day last resort', async () => {
    db.user.findUnique.mockResolvedValue({ id: 'user-1' });
    db.academicYear.findFirst.mockResolvedValue(null);
    db.leave.findMany.mockResolvedValue([]);
    db.leaveTypeConfig.findUnique.mockResolvedValue({ entitlementDays: 14 });

    const result = await getLeaveBalance('user-1', 2026);

    expect(result.annualQuota).toBe(14);
    expect(result.remainingAnnual).toBe(14);
  });
});

describe('getStaffAttendanceSummary unit scope', () => {
  it('forbids a unit admin from reading another unit\u2019s staff summary', async () => {
    db.staff.findUnique.mockResolvedValue({ unitId: 'unit-2' });

    await expect(getStaffAttendanceSummary('staff-1', 3, 2026, 'unit-1')).rejects.toThrow(
      /di luar unit/i
    );
  });

  it('allows the summary for staff in the admin\u2019s own unit', async () => {
    db.staff.findUnique.mockResolvedValue({ unitId: 'unit-1' });
    db.staffAttendance.findMany.mockResolvedValue([]);

    const summary = await getStaffAttendanceSummary('staff-1', 3, 2026, 'unit-1');
    expect(summary.staffId).toBe('staff-1');
  });
});
