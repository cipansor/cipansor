import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SchedulerService } from '../scheduler.service';
import { SCHEDULED_TASK_IDS } from '../scheduler.tasks';

// The task registry the manual-trigger endpoint validates against must equal
// what `registerDefaultTasks()` actually registers (#802): the endpoint's enum
// had drifted and left two of the registered tasks untriggerable.

vi.mock('../../../lib/prisma', () => ({ prisma: {} }));
vi.mock('../../../lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../notifications.service', () => ({
  createNotification: vi.fn(),
  createBulkNotifications: vi.fn(),
  createManyNotifications: vi.fn(),
  mapTypeToPrisma: vi.fn(() => ({ dbType: 'PAYMENT' })),
}));

describe('SchedulerService task registry (#802)', () => {
  beforeEach(() => {
    // registerTask() starts a real setInterval; fake timers keep the test from
    // leaving one running and stop the handlers from firing on their own.
    vi.useFakeTimers();
  });

  afterEach(() => {
    SchedulerService.stopAll();
    vi.useRealTimers();
  });

  it('initialize() registers every id in SCHEDULED_TASK_IDS', () => {
    SchedulerService.initialize();

    const ids = SchedulerService.getTaskStatus()
      .map((t) => t.id)
      .sort();

    expect(ids).toEqual([...SCHEDULED_TASK_IDS].sort());
  });

  it('registers each task on its expected WIB wall-clock cron', () => {
    // The boot-time `setInterval` + `shouldRunTask` pairing that required
    // minute zero is gone; `node-cron` now fires each job at its own minute in
    // Asia/Jakarta. Pin the schedules so an edit cannot quietly move (or break)
    // a slot — a malformed expression would leave every job idle while the
    // registry test still passed.
    SchedulerService.initialize();

    const scheduleById = Object.fromEntries(
      SchedulerService.getTaskStatus().map((t) => [t.id, t.schedule])
    );

    expect(scheduleById).toEqual({
      'payment-reminder': '0 8 * * *',
      'attendance-summary': '0 18 * * *',
      'tahfidz-progress': '0 16 * * 5',
      'event-reminder': '0 7 * * *',
      'monthly-report': '0 9 1 * *',
      'budget-overrun-alert': '0 7 * * 1',
    });
  });

  it('does not register the monthly SPP reminder — jobs/ owns it', () => {
    // `src/jobs/scheduler.ts` sends the parent SPP reminder on the same
    // `0 6 1 * *` WIB slot; registering it here too would double-send.
    SchedulerService.initialize();

    expect(SchedulerService.getTaskStatus().map((t) => t.id)).not.toContain('monthly-spp-reminder');
  });
});
