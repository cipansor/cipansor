import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SchedulerService, SCHEDULED_TASK_IDS } from '../scheduler.service';

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

  it('does not register the monthly SPP reminder — jobs/ owns it', () => {
    // `src/jobs/scheduler.ts` sends the parent SPP reminder on the same
    // `0 6 1 * *` WIB slot; registering it here too would double-send.
    SchedulerService.initialize();

    expect(SchedulerService.getTaskStatus().map((t) => t.id)).not.toContain('monthly-spp-reminder');
  });
});
