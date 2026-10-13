import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SchedulerService } from '../scheduler.service';

// The registry test pins the cron expressions, but a regression in how the
// scheduler arms its timers — the boot-minute `setInterval` this replaced
// (#802) — can leave every task idle while the registry still looks correct.
// This advances a fake clock across a WIB deadline to prove a job actually
// fires, and that it does not fire before the deadline.

vi.mock('../../../lib/prisma', () => ({
  prisma: {
    invoice: { findMany: vi.fn() },
    attendance: { findMany: vi.fn() },
  },
}));
vi.mock('../../../lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../notifications.service', () => ({
  createNotification: vi.fn(async () => null),
  createBulkNotifications: vi.fn(),
  createManyNotifications: vi.fn(),
  mapTypeToPrisma: vi.fn(() => ({ dbType: 'PAYMENT' })),
}));

import { prisma } from '../../../lib/prisma';

describe('SchedulerService WIB timing (#802)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    SchedulerService.stopAll();
    vi.useRealTimers();
  });

  it('fires payment-reminder at 08:00 WIB after booting at 07:35', async () => {
    // 07:35 WIB on 2026-10-13 is 00:35 UTC. A process started here must still
    // hit the 08:00 slot; the old hourly `setInterval` never did.
    vi.setSystemTime(new Date('2026-10-13T00:35:00.000Z'));
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([]);

    SchedulerService.initialize();

    // Up to 07:55 WIB the job must stay quiet.
    await vi.advanceTimersByTimeAsync(20 * 60 * 1000);
    expect(prisma.invoice.findMany).not.toHaveBeenCalled();

    // Crossing 08:00 WIB (01:00 UTC) runs the query.
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(prisma.invoice.findMany).toHaveBeenCalled();
  });

  it('fires the 18:00 WIB summary on the WIB day the clock is on', async () => {
    // 15:00 WIB on 2026-10-13 is 08:00 UTC — the same calendar day in both
    // zones. 17:00 UTC is already 00:00 WIB on the 14th, so a task that used
    // the container's UTC day would be three hours early.
    vi.setSystemTime(new Date('2026-10-13T08:00:00.000Z')); // 15:00 WIB
    vi.mocked(prisma.attendance.findMany).mockResolvedValue([]);
    SchedulerService.initialize();
    // The first test in this file already ran `initialize()`, whose once-only
    // guard makes the call above a no-op; `startAll()` re-arms the tasks the
    // previous test's `stopAll()` halted.
    SchedulerService.startAll();

    // Advance past 18:00 WIB (11:00 UTC).
    await vi.advanceTimersByTimeAsync(3 * 60 * 60 * 1000 + 60 * 1000);
    expect(prisma.attendance.findMany).toHaveBeenCalled();
  });
});
