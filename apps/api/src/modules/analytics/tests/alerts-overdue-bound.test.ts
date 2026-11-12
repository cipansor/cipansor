/**
 * The overdue-invoice alert fires only once the bill's WIB due day has ended.
 *
 * `Invoice.dueDate` is date-only, stored at midnight UTC: a bill due WIB day D
 * holds D 00:00Z, which is 07:00 WIB on D. Bounding the alert with `new Date()`
 * therefore flagged the bill from the morning of its own due day. The bound is
 * the start of today's WIB day instead (`wibOverdueCutoff`), so it is pinned
 * here against the frozen clock — the container runs UTC.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { prismaMock, createNotificationMock } = vi.hoisted(() => ({
  prismaMock: {
    student: { findMany: vi.fn() },
    attendance: { groupBy: vi.fn() },
    invoice: { findMany: vi.fn(), groupBy: vi.fn() },
    grade: { findMany: vi.fn() },
    violation: { groupBy: vi.fn() },
    notification: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
  },
  createNotificationMock: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/modules/notifications/notifications.service', () => ({
  createNotification: createNotificationMock,
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { checkAndTriggerAlerts } from '../alerts.service';

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  // Senin 2 Nov 2026 00:30 WIB — the UTC day is still 1 November.
  vi.setSystemTime(new Date('2026-11-01T17:30:00.000Z'));

  prismaMock.student.findMany.mockResolvedValue([]);
  prismaMock.attendance.groupBy.mockResolvedValue([]);
  prismaMock.invoice.findMany.mockResolvedValue([]);
  prismaMock.invoice.groupBy.mockResolvedValue([]);
  prismaMock.grade.findMany.mockResolvedValue([]);
  prismaMock.violation.groupBy.mockResolvedValue([]);
  prismaMock.notification.findMany.mockResolvedValue([]);
  prismaMock.$queryRaw.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the overdue-invoice alert bound', () => {
  it('cuts off at the start of the WIB day, not at the server instant', async () => {
    await checkAndTriggerAlerts();

    const overdueCall = prismaMock.invoice.findMany.mock.calls.find(
      ([args]) => args.where.status === 'OVERDUE'
    );
    expect(overdueCall).toBeDefined();

    const cutoff = overdueCall![0].where.dueDate.lt as Date;
    // 2 Nov 00:00 WIB = 1 Nov 17:00Z. A bill due 2 Nov is stored 2 Nov 00:00Z
    // (07:00 WIB) and must not count as overdue before that WIB day ends.
    expect(cutoff.toISOString()).toBe('2026-11-01T17:00:00.000Z');
    expect(cutoff.getTime()).toBeLessThan(new Date('2026-11-02T00:00:00.000Z').getTime());
  });
});
