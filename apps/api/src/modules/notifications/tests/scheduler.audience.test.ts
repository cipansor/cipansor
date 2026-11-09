import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SchedulerService } from '../scheduler.service';
import { EventScope } from '@prisma/client';

// The two review findings a registry test cannot see (#804): the event reminder
// must pick recipients from the event's `scope`, and a recovered budget plan
// must clear its delivery markers so a later overrun alerts again.

vi.mock('../../../lib/prisma', () => ({
  prisma: {
    calendarEvent: { findMany: vi.fn() },
    classEnrollment: { findMany: vi.fn() },
    class: { findUnique: vi.fn() },
    user: { findMany: vi.fn() },
    strategicPlan: { findMany: vi.fn() },
    journalEntry: { aggregate: vi.fn() },
  },
}));
vi.mock('../../../lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../notifications.service', () => ({
  createNotification: vi.fn(async () => ({ id: 'n-1' })),
  createBulkNotifications: vi.fn(),
  createManyNotifications: vi.fn(),
  clearNotificationDeliveries: vi.fn(async () => ({ count: 0 })),
  mapTypeToPrisma: vi.fn(() => ({ dbType: 'REMINDER' })),
}));

import { prisma } from '../../../lib/prisma';
import { createNotification, clearNotificationDeliveries } from '../notifications.service';

const event = (over: Record<string, unknown>) => ({
  id: 'e-1',
  title: 'Rapat Wali',
  location: 'Aula',
  startTime: '08:00',
  isPublic: false,
  isDraft: false,
  deletedAt: null,
  scope: EventScope.ALL_UNITS,
  unitId: null,
  classId: null,
  ...over,
});

describe('sendEventReminders recipient scope (#802)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('a class event reaches that class, not the whole system', async () => {
    vi.mocked(prisma.calendarEvent.findMany).mockResolvedValue([
      event({ scope: EventScope.SPECIFIC_CLASS, classId: 'c-1' }),
    ] as never);
    vi.mocked(prisma.classEnrollment.findMany).mockResolvedValue([
      { student: { userId: 's-1' } },
    ] as never);
    vi.mocked(prisma.class.findUnique).mockResolvedValue({
      homeroomTeacher: { userId: 't-1' },
    } as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: 's-1', name: 'Santri' },
      { id: 't-1', name: 'Guru' },
    ] as never);

    await SchedulerService.runTask('event-reminder');

    // Everyone query would have been `{ isActive, deletedAt }` with no id set;
    // a class event must resolve through the class, not fall through to it.
    const where = vi.mocked(prisma.user.findMany).mock.calls[0][0]?.where as { id?: unknown };
    expect(where.id).toEqual({ in: ['s-1', 't-1'] });
  });

  it('a non-public all-units event does NOT reach the whole system', async () => {
    // Regression: the old code treated any non-public, unit-less event as
    // "public" and broadcast it, leaking private details (CWE-200).
    vi.mocked(prisma.calendarEvent.findMany).mockResolvedValue([
      event({ scope: EventScope.ALL_UNITS, isPublic: false }),
    ] as never);

    await SchedulerService.runTask('event-reminder');

    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('a public all-units event reaches every active user', async () => {
    vi.mocked(prisma.calendarEvent.findMany).mockResolvedValue([
      event({ scope: EventScope.ALL_UNITS, isPublic: true }),
    ] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: 'u-1', name: 'Budi' }] as never);

    await SchedulerService.runTask('event-reminder');

    const where = vi.mocked(prisma.user.findMany).mock.calls[0][0]?.where as { unitId?: unknown };
    expect(where.unitId).toBeUndefined();
  });

  it('a public all-units event that belongs to a unit only reaches that unit', async () => {
    // Regression (#804 review, CWE-200): `ALL_UNITS` + `isPublic` + a unitId
    // broadcast a unit's event to the whole system, while the calendar shows a
    // unit user only their own unit (plus unit-less public events).
    vi.mocked(prisma.calendarEvent.findMany).mockResolvedValue([
      event({ scope: EventScope.ALL_UNITS, isPublic: true, unitId: 'unit-7' }),
    ] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: 'u-7', name: 'Wali' }] as never);

    await SchedulerService.runTask('event-reminder');

    const where = vi.mocked(prisma.user.findMany).mock.calls[0][0]?.where as { unitId?: unknown };
    expect(where.unitId).toBe('unit-7');
  });

  it('a non-public all-units event with no unit reaches nobody', async () => {
    vi.mocked(prisma.calendarEvent.findMany).mockResolvedValue([
      event({ scope: EventScope.ALL_UNITS, isPublic: false, unitId: null }),
    ] as never);

    await SchedulerService.runTask('event-reminder');

    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
  });
});

describe('sendBudgetOverrunAlerts episode reset (#804)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const plan = {
    id: 'p-1',
    title: 'Renstra',
    budget: 1000,
    unitId: 'unit-1',
    startDate: new Date('2026-01-01'),
    endDate: new Date('2026-12-31'),
    objectives: [
      {
        activities: [{ budgetRel: { accountId: 'acc-1', account: { normalBalance: 'DEBIT' } } }],
      },
    ],
  };

  const realization = (movement: number) => {
    vi.mocked(prisma.strategicPlan.findMany).mockResolvedValue([plan] as never);
    vi.mocked(prisma.journalEntry.aggregate).mockResolvedValue({
      _sum: { debit: movement, credit: 0 },
    } as never);
  };

  it('clears the plan markers when the plan is back under 120%', async () => {
    realization(1100); // 110% — recovered.

    await SchedulerService.runTask('budget-overrun-alert');

    expect(clearNotificationDeliveries).toHaveBeenCalledWith('budget-overrun:p-1:');
    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('does not clear markers while the plan is still over 120%', async () => {
    realization(1300); // 130% — still over.
    vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: 'admin-1' }] as never);

    await SchedulerService.runTask('budget-overrun-alert');

    expect(clearNotificationDeliveries).not.toHaveBeenCalled();
    expect(createNotification).toHaveBeenCalled();
  });
});
