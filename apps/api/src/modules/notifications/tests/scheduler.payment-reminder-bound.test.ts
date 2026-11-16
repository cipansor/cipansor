/**
 * The payment reminder window is the WIB calendar week, not a server instant.
 *
 * `Invoice.dueDate` is date-only, stored at midnight UTC — 07:00 WIB on the day
 * it names. The window used to run `[now, now + 7d]`, so at any WIB hour before
 * 07:00 the lower bound already sat past a bill due today, and the whole window
 * walked seven hours late. It now spans whole WIB days: today through seven WIB
 * days out, inclusive (#1050). Pinned against a frozen clock in the 00:00–07:00
 * WIB stretch, where the UTC day is the day before.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
  return { SchedulerService, prisma };
}

describe('sendPaymentReminders bounds the window in WIB days (#1050)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('asks for whole WIB days from today, not the server instant', async () => {
    // 1 Nov 2026 08:00 WIB = 01:00 UTC. The UTC day is still 1 November here,
    // so a server-instant bound would start the window at 01:00Z and end at
    // 01:00Z on the 8th — seven hours past each WIB day it means to cover.
    vi.setSystemTime(new Date('2026-11-01T01:00:00.000Z'));
    const { SchedulerService, prisma } = await freshScheduler();
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([] as never);

    await SchedulerService.runTask('payment-reminder');

    const where = vi.mocked(prisma.invoice.findMany).mock.calls[0][0]?.where as {
      dueDate: { gte: Date; lte: Date };
    };
    // Today 1 Nov WIB → 1 Nov 00:00Z; seven days out → 8 Nov 00:00Z.
    expect(where.dueDate.gte.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(where.dueDate.lte.toISOString()).toBe('2026-11-08T00:00:00.000Z');
  });
});
