import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventScope } from '@prisma/client';

// The registry test pins the cron expressions, but a regression in how the
// scheduler arms its timers — the boot-minute `setInterval` this replaced
// (#802) — can leave every task idle while the registry still looks correct.
// This advances a fake clock across a WIB deadline to prove a job actually
// fires, that it does not fire before the deadline, and that a job reads the
// WIB calendar day. Each test re-imports the scheduler fresh (`vi.resetModules`)
// so the cron timers arm at that test's clock; the class is a once-only
// singleton that would otherwise keep the first test's timers.

vi.mock('../../../lib/prisma', () => ({
  prisma: {
    invoice: { findMany: vi.fn() },
    attendance: { findMany: vi.fn() },
    calendarEvent: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
  },
}));
vi.mock('../../../lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../notifications.service', () => ({
  createNotification: vi.fn(async () => ({ id: 'n-1' })),
  createBulkNotifications: vi.fn(),
  createManyNotifications: vi.fn(),
  clearNotificationDeliveries: vi.fn(),
  mapTypeToPrisma: vi.fn(() => ({ dbType: 'PAYMENT' })),
}));

async function freshScheduler() {
  vi.resetModules();
  const { SchedulerService } = await import('../scheduler.service');
  const { prisma } = await import('../../../lib/prisma');
  const { createNotification } = await import('../notifications.service');
  return { SchedulerService, prisma, createNotification };
}

describe('SchedulerService WIB timing (#802)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires payment-reminder at 08:00 WIB after booting at 07:35', async () => {
    // 07:35 WIB on 2026-10-13 is 00:35 UTC. A process started here must still
    // hit the 08:00 slot; the old hourly `setInterval` never did.
    vi.setSystemTime(new Date('2026-10-13T00:35:00.000Z'));
    const { SchedulerService, prisma } = await freshScheduler();
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([]);

    SchedulerService.initialize();

    // Up to 07:55 WIB the job must stay quiet.
    await vi.advanceTimersByTimeAsync(20 * 60 * 1000);
    expect(prisma.invoice.findMany).not.toHaveBeenCalled();

    // Crossing 08:00 WIB (01:00 UTC) runs the query.
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(prisma.invoice.findMany).toHaveBeenCalled();

    SchedulerService.stopAll();
  });

  it('fires the 18:00 WIB summary and queries the WIB day, not the UTC day', async () => {
    // Boot at 06:30 WIB on the 14th = 23:30 UTC on the 13th. The whole run
    // happens while UTC and WIB disagree on the date, which is exactly the
    // window a UTC-day filter gets wrong: the 18:00 WIB tick is 11:00 UTC on
    // the 14th, so the attended day must be the 14th, not the 13th.
    vi.setSystemTime(new Date('2026-10-13T23:30:00.000Z')); // 06:30 WIB Oct 14
    const { SchedulerService, prisma } = await freshScheduler();
    vi.mocked(prisma.attendance.findMany).mockResolvedValue([]);

    SchedulerService.initialize();

    // Advance twelve hours to just past 18:00 WIB (11:00 UTC on the 14th). The
    // tick is 11.5h after the 06:30 WIB boot.
    await vi.advanceTimersByTimeAsync(12 * 60 * 60 * 1000);

    expect(prisma.attendance.findMany).toHaveBeenCalled();
    const where = vi.mocked(prisma.attendance.findMany).mock.calls[0][0]?.where as {
      date: { gte: Date; lt: Date };
    };
    // "Today" is 2026-10-14 WIB → [00:00Z on the 14th, 00:00Z on the 15th). A
    // UTC-based filter would have produced the 13th→14th window.
    expect(where.date.gte.toISOString()).toBe('2026-10-14T00:00:00.000Z');
    expect(where.date.lt.toISOString()).toBe('2026-10-15T00:00:00.000Z');

    SchedulerService.stopAll();
  });

  it('reminds the next WIB day, so an early event is not reminded early', async () => {
    // Boot 06:59 WIB Oct 13 = 23:59 UTC Oct 12, one minute before the 07:00 WIB
    // tick. An event on Oct 14 WIB at 06:00 WIB is "tomorrow" in WIB, but its
    // calendar day is stored as 2026-10-14T00:00:00Z (the `@db.Date` midnight,
    // what the form's `yyyy-MM-dd` becomes). A UTC-day filter would look at Oct
    // 13 and miss it entirely (#804 review).
    vi.setSystemTime(new Date('2026-10-12T23:59:00.000Z'));
    const { SchedulerService, prisma, createNotification } = await freshScheduler();
    vi.mocked(prisma.calendarEvent.findMany).mockResolvedValue([
      {
        id: 'e-early',
        title: 'Apel Pagi',
        location: 'Lapangan',
        startTime: '06:00',
        isPublic: true,
        isDraft: false,
        deletedAt: null,
        scope: EventScope.ALL_UNITS,
        unitId: null,
        classId: null,
      },
    ] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: 'u-1', name: 'Budi' }] as never);

    SchedulerService.initialize();
    // Cross the 07:00 WIB tick (00:00 UTC Oct 13).
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);

    expect(prisma.calendarEvent.findMany).toHaveBeenCalled();
    const where = vi.mocked(prisma.calendarEvent.findMany).mock.calls[0][0]?.where as {
      startDate: { gte: Date; lt: Date };
    };
    // Tomorrow is Oct 14 WIB → the [00:00Z Oct 14, 00:00Z Oct 15) window, which
    // contains the stored Oct 14 event. A UTC filter would ask for Oct 13 and
    // leave the event unreminded.
    expect(where.startDate.gte.toISOString()).toBe('2026-10-14T00:00:00.000Z');
    expect(where.startDate.lt.toISOString()).toBe('2026-10-15T00:00:00.000Z');
    // And the event the window selects actually receives its reminder.
    expect(vi.mocked(createNotification)).toHaveBeenCalled();

    SchedulerService.stopAll();
  });
});
