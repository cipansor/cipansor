import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  studentParent: { findMany: vi.fn() },
  message: { findMany: vi.fn() },
  notification: { findMany: vi.fn() },
  invoice: { groupBy: vi.fn(), count: vi.fn(), aggregate: vi.fn() },
  student: { count: vi.fn() },
  attendance: { count: vi.fn() },
  payment: { aggregate: vi.fn() },
  tahfidzRecord: { aggregate: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { getParentEngagement } from '../parent-engagement.service';
import { getDashboardStats } from '../analytics.service';

// The container runs UTC; WIB is UTC+7. Every instant below is chosen inside
// the 00:00–06:59 WIB stretch where the UTC calendar day is the day before, so
// a bound or label built from the server clock lands on the wrong day.
describe('analytics day bounds follow the WIB calendar, not the UTC server clock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.studentParent.findMany.mockResolvedValue([]);
    prismaMock.message.findMany.mockResolvedValue([]);
    prismaMock.notification.findMany.mockResolvedValue([]);
    prismaMock.invoice.groupBy.mockResolvedValue([]);
    prismaMock.invoice.count.mockResolvedValue(0);
    prismaMock.student.count.mockResolvedValue(0);
    prismaMock.attendance.count.mockResolvedValue(0);
    prismaMock.payment.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
    prismaMock.invoice.aggregate.mockResolvedValue({ _sum: { amount: 0, paidAmount: 0 } });
    prismaMock.tahfidzRecord.aggregate.mockResolvedValue({ _avg: { juz: null } });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('labels the newest parent-activity bucket as the WIB day (Sen 2026-11-02), not the UTC day', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-01T17:30:00.000Z')); // Senin 2 Nov 2026 00:30 WIB

    const result = await getParentEngagement();
    const last = result.weeklyActivity[result.weeklyActivity.length - 1];

    expect(last.date).toBe('2026-11-02');
    expect(last.day).toBe('Sen');
  });

  it('buckets a 00:30 WIB message into the WIB day, not the previous UTC day', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-01T17:30:00.000Z')); // Senin 2 Nov 2026 00:30 WIB

    prismaMock.message.findMany
      .mockResolvedValueOnce([]) // replies query
      .mockResolvedValueOnce([{ createdAt: new Date('2026-11-01T17:30:00.000Z') }]);

    const result = await getParentEngagement();
    const last = result.weeklyActivity[result.weeklyActivity.length - 1];

    expect(last.date).toBe('2026-11-02');
    expect(last.messages).toBe(1);
  });

  it('bounds the dashboard attendance "today" to the WIB day', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-31T17:30:00.000Z')); // 1 Nov 2026 00:30 WIB

    await getDashboardStats();

    const where = prismaMock.attendance.count.mock.calls[0][0].where;
    expect(where.date.gte.toISOString()).toBe('2026-10-31T17:00:00.000Z');
    expect(where.date.lte.toISOString()).toBe('2026-11-01T16:59:59.999Z');
  });

  it('starts the dashboard "this month" on the 1st of the WIB month', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-31T17:30:00.000Z')); // 1 Nov 2026 00:30 WIB

    await getDashboardStats();

    const where = prismaMock.student.count.mock.calls[2][0].where; // newStudentsThisMonth
    expect(where.createdAt.gte.toISOString()).toBe('2026-10-31T17:00:00.000Z');
  });

  it('counts an invoice overdue only once its WIB due day has ended (getParentEngagement)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-01T17:30:00.000Z')); // Senin 2 Nov 2026 00:30 WIB

    await getParentEngagement();

    const where = prismaMock.invoice.count.mock.calls[0][0].where;
    // The cutoff is the start of the WIB day (2 Nov 00:00 WIB = 1 Nov 17:00Z),
    // not the server instant (00:30 WIB). A bill due WIB day D is stored at
    // D 00:00Z and stays due through the whole of D.
    expect(where.dueDate.lt.toISOString()).toBe('2026-11-01T17:00:00.000Z');
  });
});
