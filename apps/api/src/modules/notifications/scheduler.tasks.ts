/**
 * The canonical ids of the notification-scheduler tasks (#802).
 *
 * Lives in its own module, free of Prisma/WhatsApp imports, so the manual-trigger
 * endpoint can validate against it without pulling the whole scheduler (and its
 * side effects) into every test that imports the controller. Keeping one list
 * means the endpoint's enum cannot drift from what `registerDefaultTasks()`
 * registers — it had drifted, leaving two registered tasks untriggerable.
 */
export const SCHEDULED_TASK_IDS = [
  'payment-reminder',
  'attendance-summary',
  'tahfidz-progress',
  'event-reminder',
  'monthly-report',
  'budget-overrun-alert',
] as const;

export type ScheduledTaskId = (typeof SCHEDULED_TASK_IDS)[number];
