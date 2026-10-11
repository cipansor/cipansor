import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../lib/prisma', () => ({
  prisma: {
    staff: { findUnique: vi.fn() },
    attendanceSite: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    attendancePolicy: { findFirst: vi.fn(), findMany: vi.fn() },
    attendanceRecord: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      groupBy: vi.fn(),
    },
    staffAttendance: { upsert: vi.fn(), findUnique: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
    shiftAssignment: { findFirst: vi.fn() },
    shiftRotation: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    workShift: { findUnique: vi.fn(), update: vi.fn() },
    workWeekConfig: { findFirst: vi.fn() },
    calendarEvent: { findFirst: vi.fn(), findMany: vi.fn() },
    attendanceExemption: { findFirst: vi.fn() },
    userRoleAssignment: { findMany: vi.fn() },
    auditLog: { create: vi.fn() },
    leave: { findMany: vi.fn() },
    retentionPolicy: { findMany: vi.fn() },
    unit: { findMany: vi.fn() },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
  },
}));

vi.mock('../../../utils/attendance-photo-store', () => ({
  attendancePhotoRefusal: vi.fn(),
  deleteAttendancePhoto: vi.fn(),
  listAttendancePhotos: vi.fn(),
  readAttendancePhoto: vi.fn(),
  storeAttendancePhoto: vi.fn(),
  isAcceptedAttendancePhoto: vi.fn(),
  looksLikeImage: vi.fn(),
  ATTENDANCE_PHOTO_ORPHAN_GRACE_MS: 24 * 60 * 60 * 1000,
  MAX_ATTENDANCE_PHOTO_BYTES: 5 * 1024 * 1024,
}));

import { prisma } from '../../../lib/prisma';
import {
  attendancePhotoRefusal,
  deleteAttendancePhoto,
  listAttendancePhotos,
} from '../../../utils/attendance-photo-store';
import { todayWib, dayOf } from '../../../utils/wib';
import {
  selfCheckIn,
  selfCheckOut,
  getMyAttendance,
  haversineMeters,
  computeLateMinutes,
  resolveShiftForDate,
  isNonWorkingDay,
  isExemptFromAttendance,
  resolveDelegatedStaffId,
  scopedUnitId,
  updateAttendanceSite,
  updateWorkShift,
  updateShiftRotation,
  enforceAttendanceRetention,
} from '../hr.service';
import { bulkAttendanceSchema } from '../hr.schema';

const m = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>> & {
  $transaction: ReturnType<typeof vi.fn>;
  $executeRaw: ReturnType<typeof vi.fn>;
};

/** A reference as the private photo store writes it, for the caller `user-1`. */
const PHOTO_REF = 'user-1-photo.jpg';

/** A shift that starts at 07:00 WIB with a 15-minute grace. */
const pagiShift = {
  id: 'shift-pagi',
  startTime: '07:00',
  endTime: '14:00',
  graceMinutes: 15,
  crossesMidnight: false,
};

// A punch is refused on a non-working day, so a test that reads the real
// clock fails on every Saturday and Sunday (it did, on 2026-10-11). Every test
// runs on a fixed working morning — Monday 2 March 2026, 07:00 WIB — unless it
// sets its own time. Only Date is faked; timers and promises run as usual.
const WORKING_MORNING = new Date('2026-03-02T00:00:00Z');

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(WORKING_MORNING);
  vi.clearAllMocks();
  m.staffAttendance.upsert.mockResolvedValue({ id: 'att-1' });
  m.staffAttendance.findUnique.mockResolvedValue(null);
  m.attendanceRecord.create.mockResolvedValue({});
  m.shiftAssignment.findFirst.mockResolvedValue(null);
  m.shiftRotation.findFirst.mockResolvedValue(null);
  m.attendanceSite.findMany.mockResolvedValue([]);
  m.calendarEvent.findFirst.mockResolvedValue(null);
  m.calendarEvent.findMany.mockResolvedValue([]);
  m.workWeekConfig.findFirst.mockResolvedValue(null);
  m.attendanceExemption.findFirst.mockResolvedValue(null);
  m.attendancePolicy.findFirst.mockResolvedValue(null);
  m.userRoleAssignment.findMany.mockResolvedValue([]);
  m.auditLog.create.mockResolvedValue({});
  m.attendanceRecord.findMany.mockResolvedValue([]);
  m.attendanceRecord.updateMany.mockResolvedValue({ count: 1 });
  m.attendanceRecord.groupBy.mockResolvedValue([]);
  m.staffAttendance.deleteMany.mockResolvedValue({ count: 0 });
  m.leave.findMany.mockResolvedValue([]);
  m.retentionPolicy.findMany.mockResolvedValue([]);
  m.unit.findMany.mockResolvedValue([{ id: 'unit-1' }]);
  m.attendancePolicy.findMany.mockResolvedValue([]);
  m.$executeRaw.mockResolvedValue(1);
  m.attendanceRecord.findFirst.mockResolvedValue(null);
  vi.mocked(attendancePhotoRefusal).mockResolvedValue(null);
  vi.mocked(deleteAttendancePhoto).mockResolvedValue(undefined);
  vi.mocked(listAttendancePhotos).mockResolvedValue([]);
  // The punch and its evidence are one write; run the callback against the mock.
  m.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    typeof fn === 'function' ? fn(prisma) : Promise.all(fn as unknown[])
  );
});

describe('haversineMeters', () => {
  it('is zero for the same point and ~111 km per degree of latitude', () => {
    expect(haversineMeters(-6.5, 106.8, -6.5, 106.8)).toBe(0);
    expect(haversineMeters(0, 0, 1, 0)).toBeGreaterThan(110_000);
    expect(haversineMeters(0, 0, 1, 0)).toBeLessThan(112_000);
  });
});

describe('computeLateMinutes (WIB)', () => {
  it('reads the punch on the WIB clock, not the container clock', () => {
    // 07:20 WIB is 00:20Z; 06:30 WIB is 23:30Z the previous day.
    expect(computeLateMinutes(new Date('2026-03-02T00:05:00Z'), pagiShift)).toBe(0);
    expect(computeLateMinutes(new Date('2026-03-02T00:20:00Z'), pagiShift)).toBe(5);
    expect(computeLateMinutes(new Date('2026-03-01T23:30:00Z'), pagiShift)).toBe(0);
  });

  it('lets the unit policy override the shift grace', () => {
    // 07:20 WIB: 5 late by the shift, 0 by a 30-minute policy grace.
    expect(computeLateMinutes(new Date('2026-03-02T00:20:00Z'), pagiShift, 30)).toBe(0);
  });

  it('never counts a midnight-crossing shift as late', () => {
    const malam = { ...pagiShift, startTime: '22:00', endTime: '06:00', crossesMidnight: true };
    expect(computeLateMinutes(new Date('2026-03-02T00:20:00Z'), malam)).toBe(0);
  });

  it('returns undefined when no shift governs the day', () => {
    expect(computeLateMinutes(new Date(), null)).toBeUndefined();
  });
});

describe('selfCheckIn', () => {
  const staffRow = { unitId: 'unit-1', user: { id: 'user-1' } };

  it('refuses when the policy requires a selfie and none was sent', async () => {
    m.staff.findUnique.mockResolvedValue(staffRow);
    m.attendancePolicy.findFirst.mockResolvedValue({
      requireSelfie: true,
      requireLocation: false,
      outsideRadiusAction: 'FLAG',
    });

    await expect(selfCheckIn({ staffId: 'staff-1', actorUserId: 'user-1' })).rejects.toThrow(
      /swafoto/i
    );
    expect(m.staffAttendance.upsert).not.toHaveBeenCalled();
  });

  it('refuses a person the policy exempts from daily attendance', async () => {
    m.staff.findUnique.mockResolvedValue(staffRow);
    m.attendanceExemption.findFirst.mockResolvedValue({ id: 'ex-1' });

    await expect(selfCheckIn({ staffId: 'staff-1', actorUserId: 'user-1' })).rejects.toThrow(
      /dikecualikan/i
    );
    expect(m.staffAttendance.upsert).not.toHaveBeenCalled();
  });

  it('refuses a punch on a day the unit does not work', async () => {
    m.staff.findUnique.mockResolvedValue(staffRow);
    m.calendarEvent.findMany.mockResolvedValue([
      { title: 'Libur unit', startDate: dayOf(todayWib()), endDate: null },
    ]);

    await expect(selfCheckIn({ staffId: 'staff-1', actorUserId: 'user-1' })).rejects.toThrow(
      /bukan hari kerja/i
    );
  });

  it('refuses a second check-in on the same day', async () => {
    m.staff.findUnique.mockResolvedValue(staffRow);
    m.staffAttendance.findUnique.mockResolvedValue({ id: 'att-1', checkIn: new Date() });

    await expect(selfCheckIn({ staffId: 'staff-1', actorUserId: 'user-1' })).rejects.toThrow(
      /sudah absen masuk/i
    );
  });

  it('rejects a check-in outside the geofence when the policy says REJECT', async () => {
    m.staff.findUnique.mockResolvedValue(staffRow);
    m.attendancePolicy.findFirst.mockResolvedValue({
      requireSelfie: false,
      requireLocation: true,
      outsideRadiusAction: 'REJECT',
    });
    m.attendanceSite.findMany.mockResolvedValue([
      { id: 'site-1', latitude: -6.5, longitude: 106.8, radiusMeters: 100 },
    ]);

    await expect(
      selfCheckIn({ staffId: 'staff-1', actorUserId: 'user-1', latitude: -6.6, longitude: 106.9 })
    ).rejects.toThrow(/luar lokasi/i);
    expect(m.staffAttendance.upsert).not.toHaveBeenCalled();
  });

  it('flags an out-of-radius check-in and stores the distance', async () => {
    m.staff.findUnique.mockResolvedValue(staffRow);
    m.attendancePolicy.findFirst.mockResolvedValue({
      requireSelfie: false,
      requireLocation: true,
      outsideRadiusAction: 'FLAG',
    });
    m.attendanceSite.findMany.mockResolvedValue([
      { id: 'site-1', latitude: -6.5, longitude: 106.8, radiusMeters: 100 },
    ]);

    const result = await selfCheckIn({
      staffId: 'staff-1',
      actorUserId: 'user-1',
      latitude: -6.5,
      longitude: 106.8,
      photoRef: PHOTO_REF,
    });

    expect(result.withinRadius).toBe(true);
    const record = m.attendanceRecord.create.mock.calls[0][0].data;
    expect(record.kind).toBe('CHECK_IN');
    expect(record.distanceMeters).toBe(0);
    expect(record.photoRef).toBe(PHOTO_REF);
    expect(record.photoSource).toBe('CAMERA');
  });

  it('files the punch under the WIB day, not the UTC day', async () => {
    m.staff.findUnique.mockResolvedValue(staffRow);

    await selfCheckIn({ staffId: 'staff-1', actorUserId: 'user-1' });

    const write = m.staffAttendance.upsert.mock.calls[0][0];
    expect(write.create.date).toEqual(dayOf(todayWib()));
  });

  it('marks a late arrival from the WIB clock', async () => {
    m.staff.findUnique.mockResolvedValue(staffRow);
    m.shiftAssignment.findFirst.mockResolvedValue({ shift: pagiShift });

    // Freeze the clock at 07:30 WIB on a fixed day.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-02T00:30:00Z'));
    try {
      const result = await selfCheckIn({ staffId: 'staff-1', actorUserId: 'user-1' });
      expect(result.lateMinutes).toBe(15);
      expect(m.staffAttendance.upsert.mock.calls[0][0].create.status).toBe('LATE');
    } finally {
      vi.useRealTimers();
    }
  });

  it('takes the staff lock and re-reads the day inside one transaction', async () => {
    m.staff.findUnique.mockResolvedValue(staffRow);

    await selfCheckIn({ staffId: 'staff-1', actorUserId: 'user-1' });

    expect(m.$executeRaw).toHaveBeenCalled();
    expect(m.$transaction).toHaveBeenCalledTimes(1);
    // Both the day row and its evidence are written inside that transaction.
    expect(m.staffAttendance.upsert).toHaveBeenCalledTimes(1);
    expect(m.attendanceRecord.create).toHaveBeenCalledTimes(1);
  });

  it('propagates an evidence failure out of the transaction so the punch rolls back', async () => {
    m.staff.findUnique.mockResolvedValue(staffRow);
    m.attendanceRecord.create.mockRejectedValue(new Error('evidence failed'));

    // The rejection escapes the callback, which is what makes a real database
    // roll the day row back; it is not swallowed or compensated afterwards.
    await expect(selfCheckIn({ staffId: 'staff-1', actorUserId: 'user-1' })).rejects.toThrow(
      /evidence failed/
    );
    expect(m.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe('punch evidence', () => {
  const staffRow = { unitId: 'unit-1', user: { id: 'user-1' } };
  const selfieRequired = {
    requireSelfie: true,
    requireLocation: false,
    outsideRadiusAction: 'FLAG',
  };

  it('refuses a photo the private store does not vouch for (not the caller’s, or too old)', async () => {
    m.staff.findUnique.mockResolvedValue(staffRow);
    m.attendancePolicy.findFirst.mockResolvedValue(selfieRequired);
    vi.mocked(attendancePhotoRefusal).mockResolvedValue(
      'Foto absen sudah kedaluwarsa; ambil foto lagi'
    );

    await expect(
      selfCheckIn({ staffId: 'staff-1', actorUserId: 'user-1', photoRef: 'yesterday.jpg' })
    ).rejects.toThrow(/kedaluwarsa/);
    expect(attendancePhotoRefusal).toHaveBeenCalledWith('yesterday.jpg', 'user-1');
    expect(m.staffAttendance.upsert).not.toHaveBeenCalled();
  });

  it('refuses a photo another punch already used', async () => {
    m.staff.findUnique.mockResolvedValue(staffRow);
    m.attendancePolicy.findFirst.mockResolvedValue(selfieRequired);
    m.attendanceRecord.findFirst.mockResolvedValue({ id: 'earlier-punch' });

    await expect(
      selfCheckIn({ staffId: 'staff-1', actorUserId: 'user-1', photoRef: PHOTO_REF })
    ).rejects.toThrow(/sudah dipakai/);
    expect(m.staffAttendance.upsert).not.toHaveBeenCalled();
  });

  it('records a photo picked from a file as FILE, for the admin to review', async () => {
    m.staff.findUnique.mockResolvedValue(staffRow);
    m.attendancePolicy.findFirst.mockResolvedValue(selfieRequired);

    await selfCheckIn({
      staffId: 'staff-1',
      actorUserId: 'user-1',
      photoRef: PHOTO_REF,
      photoSource: 'FILE',
    });

    expect(m.attendanceRecord.create.mock.calls[0][0].data.photoSource).toBe('FILE');
  });

  it('answers the punch without the stored photo reference', async () => {
    m.staff.findUnique.mockResolvedValue(staffRow);
    m.attendanceRecord.create.mockResolvedValue({
      id: 'rec-1',
      kind: 'CHECK_IN',
      photoRef: PHOTO_REF,
    });

    const result = await selfCheckIn({
      staffId: 'staff-1',
      actorUserId: 'user-1',
      photoRef: PHOTO_REF,
    });

    expect(result.record).toEqual({ id: 'rec-1', kind: 'CHECK_IN', hasPhoto: true });
  });

  it('accepts a rostered shift on a day the unit is closed', async () => {
    // The guard and the nurse work Sundays and national holidays.
    m.staff.findUnique.mockResolvedValue(staffRow);
    m.shiftAssignment.findFirst.mockResolvedValue({ shift: pagiShift });
    m.calendarEvent.findMany.mockResolvedValue([
      { title: 'Libur nasional', startDate: dayOf(todayWib()), endDate: null },
    ]);

    await selfCheckIn({ staffId: 'staff-1', actorUserId: 'user-1' });

    expect(m.staffAttendance.upsert).toHaveBeenCalledTimes(1);
  });

  it('flags rather than refuses under REJECT when the GPS error could put the person inside', async () => {
    m.staff.findUnique.mockResolvedValue(staffRow);
    m.attendancePolicy.findFirst.mockResolvedValue({
      requireSelfie: false,
      requireLocation: true,
      outsideRadiusAction: 'REJECT',
    });
    // ~111 m north of a 100 m site, reported to ±80 m.
    m.attendanceSite.findMany.mockResolvedValue([
      { id: 'site-1', latitude: -6.5, longitude: 106.8, radiusMeters: 100 },
    ]);

    const result = await selfCheckIn({
      staffId: 'staff-1',
      actorUserId: 'user-1',
      latitude: -6.499,
      longitude: 106.8,
      accuracyMeters: 80,
    });

    expect(result.withinRadius).toBe(false);
    expect(m.attendanceRecord.create.mock.calls[0][0].data.isWithinRadius).toBe(false);
  });

  it('applies REJECT to a checkout from outside the site too', async () => {
    m.staff.findUnique.mockResolvedValue(staffRow);
    m.attendancePolicy.findFirst.mockResolvedValue({
      requireSelfie: false,
      requireLocation: true,
      outsideRadiusAction: 'REJECT',
    });
    m.attendanceSite.findMany.mockResolvedValue([
      { id: 'site-1', latitude: -6.5, longitude: 106.8, radiusMeters: 100 },
    ]);
    m.staffAttendance.findUnique.mockResolvedValue({
      id: 'att-1',
      checkIn: new Date(),
      checkOut: null,
      records: [],
    });

    await expect(
      selfCheckOut({ staffId: 'staff-1', actorUserId: 'user-1', latitude: -6.6, longitude: 106.9 })
    ).rejects.toThrow(/luar lokasi/i);
    expect(m.staffAttendance.update).not.toHaveBeenCalled();
  });

  it('tells an account without a staff record whom to ask', async () => {
    m.staff.findUnique.mockResolvedValue(null);

    await expect(selfCheckIn({ staffId: 'staff-x', actorUserId: 'user-x' })).rejects.toThrow(
      /admin unit/
    );
  });
});

describe('selfCheckOut', () => {
  const staffRow = { unitId: 'unit-1' };

  it('refuses a checkout without a check-in today', async () => {
    m.staff.findUnique.mockResolvedValue(staffRow);
    m.staffAttendance.findUnique.mockResolvedValue(null);

    await expect(selfCheckOut({ staffId: 'staff-1', actorUserId: 'user-1' })).rejects.toThrow(
      /absen masuk/i
    );
  });

  it('refuses a second checkout', async () => {
    m.staff.findUnique.mockResolvedValue(staffRow);
    m.staffAttendance.findUnique.mockResolvedValue({
      id: 'att-1',
      checkIn: new Date(),
      checkOut: new Date(),
      records: [],
    });

    await expect(selfCheckOut({ staffId: 'staff-1', actorUserId: 'user-1' })).rejects.toThrow(
      /sudah absen keluar/i
    );
  });

  it('writes a CHECK_OUT record against the day row', async () => {
    m.staff.findUnique.mockResolvedValue(staffRow);
    m.staffAttendance.findUnique.mockResolvedValue({
      id: 'att-1',
      checkIn: new Date(),
      checkOut: null,
      records: [],
    });
    m.staffAttendance.update.mockResolvedValue({ id: 'att-1' });

    await selfCheckOut({ staffId: 'staff-1', actorUserId: 'user-1', photoRef: PHOTO_REF });

    expect(m.attendanceRecord.create.mock.calls[0][0].data.kind).toBe('CHECK_OUT');
  });

  it('finds the open row and writes the close under the same lock', async () => {
    m.staff.findUnique.mockResolvedValue(staffRow);
    m.staffAttendance.findUnique.mockResolvedValue({
      id: 'att-1',
      checkIn: new Date(),
      checkOut: null,
      records: [],
    });
    m.staffAttendance.update.mockResolvedValue({ id: 'att-1' });

    await selfCheckOut({ staffId: 'staff-1', actorUserId: 'user-1' });

    expect(m.$executeRaw).toHaveBeenCalled();
    expect(m.$transaction).toHaveBeenCalledTimes(1);
    // The row lookup happens inside the transaction, not before it.
    expect(m.staffAttendance.findUnique).toHaveBeenCalled();
  });

  it('propagates an evidence failure out of the transaction so the close rolls back', async () => {
    m.staff.findUnique.mockResolvedValue(staffRow);
    m.staffAttendance.findUnique.mockResolvedValue({
      id: 'att-1',
      checkIn: new Date(),
      checkOut: null,
      records: [],
    });
    m.attendanceRecord.create.mockRejectedValue(new Error('evidence failed'));

    await expect(selfCheckOut({ staffId: 'staff-1', actorUserId: 'user-1' })).rejects.toThrow(
      /evidence failed/
    );
    expect(m.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe('getMyAttendance', () => {
  it('reports whether the caller may clock in or out today', async () => {
    m.staff.findUnique.mockResolvedValue({ unitId: 'unit-1', user: { id: 'user-1' } });
    m.staffAttendance.findUnique.mockResolvedValue({
      id: 'att-1',
      checkIn: new Date(),
      checkOut: null,
      records: [],
    });

    const result = await getMyAttendance('staff-1', '2026-03-02');

    expect(result.canCheckIn).toBe(false);
    expect(result.canCheckOut).toBe(true);
    expect(result.isExempt).toBe(false);
  });

  it('blocks both actions for an exempt person', async () => {
    m.staff.findUnique.mockResolvedValue({ unitId: 'unit-1', user: { id: 'user-1' } });
    m.attendanceExemption.findFirst.mockResolvedValue({ id: 'ex-1' });

    const result = await getMyAttendance('staff-1', '2026-03-02');

    expect(result.isExempt).toBe(true);
    expect(result.canCheckIn).toBe(false);
    expect(result.canCheckOut).toBe(false);
  });
});

describe('getMyAttendance — what the page is told', () => {
  it('says the unit has not configured a policy, and that nothing is required', async () => {
    m.staff.findUnique.mockResolvedValue({ unitId: 'unit-1', user: { id: 'user-1' } });

    const result = await getMyAttendance('staff-1', '2026-03-02');

    expect(result.hasProfile).toBe(true);
    expect(result.requirements).toEqual({
      configured: false,
      requireSelfie: false,
      requireLocation: false,
      outsideRadiusAction: 'FLAG',
      photoRetentionDays: 365,
    });
  });

  it('reports a photo by presence, never by its stored reference', async () => {
    m.staff.findUnique.mockResolvedValue({ unitId: 'unit-1', user: { id: 'user-1' } });
    m.staffAttendance.findUnique.mockResolvedValue({
      id: 'att-1',
      checkIn: new Date(),
      checkOut: null,
      records: [{ id: 'rec-1', kind: 'CHECK_IN', photoRef: PHOTO_REF, photoSource: 'CAMERA' }],
    });

    const result = await getMyAttendance('staff-1', '2026-03-02');

    expect(result.attendance?.records).toEqual([
      { id: 'rec-1', kind: 'CHECK_IN', photoSource: 'CAMERA', hasPhoto: true },
    ]);
  });

  it('answers an account with no staff record instead of failing', async () => {
    m.staff.findUnique.mockResolvedValue(null);

    const result = await getMyAttendance('staff-x', '2026-03-02');

    expect(result.hasProfile).toBe(false);
    expect(result.canCheckIn).toBe(false);
  });
});

describe('resolveShiftForDate', () => {
  it('prefers a fixed assignment that covers the day', async () => {
    m.shiftAssignment.findFirst.mockResolvedValue({ shift: { id: 'shift-A' } });
    const shift = await resolveShiftForDate('staff-1', '2026-03-02');
    expect(shift).toEqual({ id: 'shift-A' });
    expect(m.shiftRotation.findFirst).not.toHaveBeenCalled();
  });

  it('falls back to a rotation and returns the shift only on that person’s turn', async () => {
    m.shiftRotation.findFirst.mockResolvedValue({
      shift: { id: 'shift-B' },
      memberIds: ['staff-1', 'staff-2'],
      startDate: new Date('2026-03-01'),
      cycleDays: 7,
    });
    // Day 0 → member[0]; day 8 → member[1] (8 / 7 = 1).
    const day0 = await resolveShiftForDate('staff-1', '2026-03-01');
    expect(day0).toEqual({ id: 'shift-B' });

    const day8 = await resolveShiftForDate('staff-2', '2026-03-09');
    expect(day8).toEqual({ id: 'shift-B' });

    const offTurn = await resolveShiftForDate('staff-2', '2026-03-01');
    expect(offTurn).toBeNull();
  });
});

describe('isNonWorkingDay', () => {
  it('treats a unit holiday as a non-working day', async () => {
    m.calendarEvent.findMany.mockResolvedValue([
      { title: 'Isra Mi\u2019raj', startDate: dayOf('2026-03-02'), endDate: null },
    ]);
    expect(await isNonWorkingDay('2026-03-02', 'unit-1')).toBe(true);
  });

  it('treats a day outside the configured work week as non-working', async () => {
    m.workWeekConfig.findFirst.mockResolvedValue({ workDays: [1, 2, 3, 4, 5] });
    // Sunday 2026-03-01 → 0, not in the list.
    expect(await isNonWorkingDay('2026-03-01', 'unit-1')).toBe(true);
    expect(await isNonWorkingDay('2026-03-02', 'unit-1')).toBe(false);
  });

  it('defaults to a Monday–Saturday week when nothing is configured', async () => {
    // Sunday 2026-03-01 is the default rest day; Monday 2026-03-02 is not.
    expect(await isNonWorkingDay('2026-03-01', 'unit-1')).toBe(true);
    expect(await isNonWorkingDay('2026-03-02', 'unit-1')).toBe(false);
  });
});

describe('isExemptFromAttendance', () => {
  it('is exempt when the person or their role is listed', async () => {
    m.attendanceExemption.findFirst.mockResolvedValue({ id: 'ex-1' });
    expect(await isExemptFromAttendance('staff-1', ['KYAI'])).toBe(true);
  });

  it('is not exempt when nothing matches', async () => {
    expect(await isExemptFromAttendance('staff-1', ['STAFF'])).toBe(false);
  });
});

describe('resolveDelegatedStaffId', () => {
  it('refuses a teacher naming a colleague', async () => {
    await expect(
      resolveDelegatedStaffId({ roleCode: 'SDIT_GURU', unitId: 'unit-1' }, 'staff-2')
    ).rejects.toThrow(/admin unit/i);
  });

  it('refuses a unit admin naming staff from another unit', async () => {
    m.staff.findUnique.mockResolvedValue({ id: 'staff-2', unitId: 'unit-2' });
    await expect(
      resolveDelegatedStaffId({ roleCode: 'SDIT_ADMIN', unitId: 'unit-1' }, 'staff-2')
    ).rejects.toThrow(/luar unit/i);
  });

  it('allows a unit admin within their own unit', async () => {
    m.staff.findUnique.mockResolvedValue({ id: 'staff-2', unitId: 'unit-1' });
    expect(
      await resolveDelegatedStaffId({ roleCode: 'SDIT_ADMIN', unitId: 'unit-1' }, 'staff-2')
    ).toBe('staff-2');
  });

  it('does not treat a yayasan governance role as a unit admin', async () => {
    await expect(
      resolveDelegatedStaffId({ roleCode: 'YAYASAN_BENDAHARA', unitId: null }, 'staff-2')
    ).rejects.toThrow(/admin unit/i);
  });
});

describe('scopedUnitId', () => {
  it('pins a unit admin to their own unit', () => {
    expect(scopedUnitId({ roleCode: 'SDIT_ADMIN', unitId: 'unit-1' }, null)).toBe('unit-1');
    expect(scopedUnitId({ roleCode: 'SDIT_ADMIN', unitId: 'unit-1' }, 'unit-1')).toBe('unit-1');
  });

  it('refuses a unit admin who names another unit, rather than rewriting it', () => {
    // Before: SD IT's admin asking for unit-9 silently got unit-1 back, and a
    // write meant for unit-9 changed their own unit without a word.
    expect(() => scopedUnitId({ roleCode: 'SDIT_ADMIN', unitId: 'unit-1' }, 'unit-9')).toThrow(
      /luar unit/i
    );
  });

  it('lets a super admin name any unit, or none for yayasan-wide', () => {
    expect(scopedUnitId({ roleCode: 'SUPER_ADMIN', unitId: null }, 'unit-9')).toBe('unit-9');
    expect(scopedUnitId({ roleCode: 'SUPER_ADMIN', unitId: null }, null)).toBeNull();
  });

  it.each(['YAYASAN_KETUA', 'YAYASAN_PENGAWAS', 'YAYASAN_BENDAHARA', 'YAYASAN_PEMBINA'])(
    'refuses %s, who shares the UNIT_ADMIN bucket but administers no unit',
    (roleCode) => {
      // Before: an organ fell into the super admin's branch and could rewrite
      // any unit's attendance policy and the yayasan payroll guard.
      expect(() => scopedUnitId({ roleCode, role: 'UNIT_ADMIN', unitId: null }, 'unit-9')).toThrow(
        /super admin dan admin unit/i
      );
      expect(() => scopedUnitId({ roleCode, role: 'UNIT_ADMIN', unitId: null }, null)).toThrow(
        /super admin dan admin unit/i
      );
    }
  );

  it.each(['SMPIT_GURU', 'SMPIT_TATA_USAHA', 'SMPIT_KEPALA_SEKOLAH'])('refuses %s', (roleCode) => {
    expect(() => scopedUnitId({ roleCode, unitId: 'unit-1' }, null)).toThrow(/admin unit/i);
  });
});

describe('bulkAttendanceSchema', () => {
  it('accepts a date picker’s calendar day, not only a datetime', () => {
    // The bulk page posts "yyyy-MM-dd"; a datetime-only schema rejected it, so
    // the button was a 400 and bulk attendance never saved.
    const parsed = bulkAttendanceSchema.safeParse({
      date: '2026-09-29',
      records: [{ staffId: '11111111-1111-4111-8111-111111111111', status: 'ABSENT' }],
    });
    expect(parsed.success).toBe(true);
  });

  it('still accepts a full datetime', () => {
    const parsed = bulkAttendanceSchema.safeParse({
      date: '2026-09-29T00:00:00.000Z',
      records: [{ staffId: '11111111-1111-4111-8111-111111111111', status: 'PRESENT' }],
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects a value that is neither a day nor a datetime', () => {
    expect(bulkAttendanceSchema.safeParse({ date: '29/09/2026', records: [] }).success).toBe(false);
  });
});

describe('overnight shifts', () => {
  const malam = {
    id: 'shift-malam',
    startTime: '22:00',
    endTime: '06:00',
    graceMinutes: 15,
    crossesMidnight: true,
  };

  it('counts a late arrival against the shift’s start day', () => {
    // 23:00 WIB on 2026-09-29 = 16:00Z; 45 late after 15 minutes of grace.
    const late = computeLateMinutes(
      new Date('2026-09-29T16:00:00Z'),
      malam,
      undefined,
      '2026-09-29'
    );
    expect(late).toBe(45);
    // 22:05 WIB is within grace.
    expect(
      computeLateMinutes(new Date('2026-09-29T15:05:00Z'), malam, undefined, '2026-09-29')
    ).toBe(0);
  });

  it('attaches a checkout after midnight to the previous day’s open row', async () => {
    m.staff.findUnique.mockResolvedValue({ unitId: 'unit-1' });
    // No row for today; yesterday holds an open check-in on a midnight-crossing
    // shift. The checkout must find it.
    m.staffAttendance.findUnique.mockImplementation(
      async ({ where }: { where: { staffId_date: { date: Date } } }) =>
        where.staffId_date.date.toISOString().slice(0, 10) === '2026-09-29'
          ? { id: 'att-night', checkIn: new Date(), checkOut: null, records: [], shift: malam }
          : null
    );
    m.staffAttendance.update.mockResolvedValue({ id: 'att-night' });

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-30T00:00:00Z')); // 07:00 WIB on the 30th
    try {
      await selfCheckOut({ staffId: 'staff-1', actorUserId: 'user-1' });
      expect(m.staffAttendance.update.mock.calls[0][0].where).toEqual({ id: 'att-night' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('still refuses a checkout with no open row at all', async () => {
    m.staff.findUnique.mockResolvedValue({ unitId: 'unit-1' });
    m.staffAttendance.findUnique.mockResolvedValue(null);
    await expect(selfCheckOut({ staffId: 'staff-1', actorUserId: 'user-1' })).rejects.toThrow(
      /absen masuk/i
    );
  });
});

describe('scoped settings writes cannot change unit', () => {
  it('refuses a site moved to another unit', async () => {
    m.attendanceSite.findUnique.mockResolvedValue({ unitId: 'unit-1' });
    await expect(
      updateAttendanceSite('site-1', { unitId: 'unit-2' } as never, 'unit-1')
    ).rejects.toThrow(/unit lain/i);
    expect(m.attendanceSite.update).not.toHaveBeenCalled();
  });

  it('pins a site update to the admin’s own unit', async () => {
    m.attendanceSite.findUnique.mockResolvedValue({ unitId: 'unit-1' });
    m.attendanceSite.update.mockResolvedValue({ id: 'site-1' });
    await updateAttendanceSite('site-1', { label: 'Gerbang' } as never, 'unit-1');
    expect(m.attendanceSite.update.mock.calls[0][0].data.unitId).toBe('unit-1');
  });

  it('refuses a shift moved to another unit', async () => {
    m.workShift.findUnique.mockResolvedValue({ unitId: 'unit-1' });
    await expect(
      updateWorkShift('shift-1', { unitId: 'unit-2' } as never, 'unit-1')
    ).rejects.toThrow(/unit lain/i);
    expect(m.workShift.update).not.toHaveBeenCalled();
  });

  it('refuses a rotation repointed at another unit’s shift', async () => {
    m.shiftRotation.findUnique.mockResolvedValue({ shift: { unitId: 'unit-1' } });
    m.workShift.findUnique.mockResolvedValue({ unitId: 'unit-2' });
    await expect(
      updateShiftRotation('rot-1', { shiftId: 'shift-other' } as never, 'unit-1')
    ).rejects.toThrow(/unit/i);
    expect(m.shiftRotation.update).not.toHaveBeenCalled();
  });

  it('allows a rotation repointed within the same unit', async () => {
    m.shiftRotation.findUnique.mockResolvedValue({ shift: { unitId: 'unit-1' } });
    m.workShift.findUnique.mockResolvedValue({ unitId: 'unit-1' });
    m.shiftRotation.update.mockResolvedValue({ id: 'rot-1' });
    await updateShiftRotation('rot-1', { shiftId: 'shift-own' } as never, 'unit-1');
    expect(m.shiftRotation.update).toHaveBeenCalled();
  });
});

describe('enforceAttendanceRetention', () => {
  const now = new Date('2026-10-01T00:00:00Z');

  /** The due-scan returns the rows due in the requested units. */
  function mockDueRows(rows: { id: string; photoRef: string; unitId: string }[]) {
    m.attendanceRecord.findMany.mockImplementation(async (args: { where: Record<string, any> }) => {
      const where = args.where;
      if (where.photoRef?.in) return [];
      const unitIds: string[] = where.attendance.staff.unitId.in;
      return rows
        .filter((r) => unitIds.includes(r.unitId))
        .map((r) => ({ id: r.id, photoRef: r.photoRef }));
    });
  }

  it("deletes an expired punch's photo from the private store, then clears its reference", async () => {
    mockDueRows([{ id: 'r-1', photoRef: 'old.jpg', unitId: 'unit-1' }]);

    const result = await enforceAttendanceRetention(now);

    expect(deleteAttendancePhoto).toHaveBeenCalledWith('old.jpg');
    expect(m.attendanceRecord.updateMany).toHaveBeenCalledWith({
      where: { id: 'r-1', photoRef: 'old.jpg' },
      data: { photoRef: null },
    });
    expect(result.photosErased).toBe(1);
  });

  it('keeps the reference when the file could not be deleted, so the next run retries', async () => {
    mockDueRows([{ id: 'r-1', photoRef: 'old.jpg', unitId: 'unit-1' }]);
    vi.mocked(deleteAttendancePhoto).mockRejectedValue(new Error('EACCES'));

    await expect(enforceAttendanceRetention(now)).rejects.toThrow('EACCES');
    expect(m.attendanceRecord.updateMany).not.toHaveBeenCalled();
  });

  it('reads only the rows that can have expired, not the whole photo history', async () => {
    mockDueRows([]);

    await enforceAttendanceRetention(now);

    const where = m.attendanceRecord.findMany.mock.calls[0][0].where;
    expect(where.photoRef).toEqual({ not: null });
    expect(where.capturedAt.lt).toBeInstanceOf(Date);
  });

  it('scopes the due-scan per retention window so a long window is not revisited daily', async () => {
    m.unit.findMany.mockResolvedValue([{ id: 'unit-1' }, { id: 'unit-2' }]);
    m.attendancePolicy.findMany.mockResolvedValue([
      { unitId: 'unit-1', photoRetentionDays: 365 },
      { unitId: 'unit-2', photoRetentionDays: 30 },
    ]);
    mockDueRows([]);

    await enforceAttendanceRetention(now);

    const due = m.attendanceRecord.findMany.mock.calls
      .map((c) => c[0].where)
      .filter((w) => w.photoRef?.not === null);
    expect(due).toHaveLength(2);
    const short = due.find((w) => w.attendance.staff.unitId.in.includes('unit-2'));
    const long = due.find((w) => w.attendance.staff.unitId.in.includes('unit-1'));
    expect(short.capturedAt.lt.getTime()).toBeGreaterThan(long.capturedAt.lt.getTime());
  });

  it('sweeps a photo no punch used once it is a day old, and only that one', async () => {
    const dayOld = new Date(now.getTime() - 25 * 60 * 60 * 1000);
    const fresh = new Date(now.getTime() - 60 * 1000);
    vi.mocked(listAttendancePhotos).mockResolvedValue([
      { ref: 'unused.jpg', modifiedAt: dayOld },
      { ref: 'used.jpg', modifiedAt: dayOld },
      { ref: 'just-taken.jpg', modifiedAt: fresh },
    ]);
    m.attendanceRecord.findMany.mockImplementation(async (args: { where: Record<string, any> }) =>
      args.where.photoRef?.in ? [{ photoRef: 'used.jpg' }] : []
    );

    await enforceAttendanceRetention(now);

    expect(deleteAttendancePhoto).toHaveBeenCalledWith('unused.jpg');
    expect(deleteAttendancePhoto).not.toHaveBeenCalledWith('used.jpg');
    expect(deleteAttendancePhoto).not.toHaveBeenCalledWith('just-taken.jpg');
  });

  it('never deletes attendance rows younger than ten years, whatever the policy says', async () => {
    // A row written before the schema refused it: 30 days. The rows are what
    // the payslips were computed from (UU KUP Ps. 28(11)).
    m.attendancePolicy.findMany.mockResolvedValue([
      { unitId: 'unit-1', photoRetentionDays: 365, recordRetentionDays: 30 },
    ]);
    m.retentionPolicy.findMany.mockResolvedValue([
      { dataType: 'ATTENDANCE_RECORD', retentionDays: 30 },
    ]);
    mockDueRows([]);

    await enforceAttendanceRetention(now);

    const cutoff: Date = m.staffAttendance.deleteMany.mock.calls[0][0].where.date.lt;
    const tenYearsAgo = now.getTime() - 3650 * 86_400_000;
    expect(cutoff.getTime()).toBeLessThanOrEqual(tenYearsAgo);
  });
});
