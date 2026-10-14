import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

// The cron fires at 06:00 WIB on the 1st. On a UTC server the instant is still
// 23:00 the day before, so the month is derived from the WIB calendar. The
// window bounds the date-only `dueDate` column where it lives: midnight UTC on
// the first, [start, end) — not a WIB-midnight instant, which reads as the
// previous day and would pull the next month's first invoice into this one.

vi.mock('@/lib/prisma', () => ({
  prisma: {
    invoice: { findMany: vi.fn() },
    notification: { create: vi.fn().mockResolvedValue({ id: 'n1' }) },
    user: { findUnique: vi.fn().mockResolvedValue(null) },
  },
}));
vi.mock('@/modules/notifications/notifications.service', () => ({
  createNotification: vi.fn().mockResolvedValue({ id: 'n1' }),
}));
vi.mock('@/modules/notifications/email-sms.service', () => ({
  notificationService: { send: vi.fn().mockResolvedValue({ success: true }) },
}));

import { prisma } from '@/lib/prisma';
import * as notificationService from '@/modules/notifications/notifications.service';
import { notificationService as channelService } from '@/modules/notifications/email-sms.service';
import { sendMonthlySppReminders } from './spp-reminder.job';
import { wibDate } from '@/utils/wib-day';

const mockFindMany = prisma.invoice.findMany as unknown as ReturnType<typeof vi.fn>;
const mockCreateNotification = notificationService.createNotification as unknown as ReturnType<
  typeof vi.fn
>;
const mockSend = channelService.send as unknown as ReturnType<typeof vi.fn>;

function invoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv-1',
    amount: new Prisma.Decimal(500000),
    paidAmount: new Prisma.Decimal(0),
    period: 'Juli 2026',
    dueDate: new Date('2026-07-10'),
    paymentType: { name: 'SPP' },
    student: {
      id: 's1',
      user: { name: 'Ahmad' },
      parents: [
        { parent: { id: 'p1', name: 'Bapak Ahmad', phone: '+6281234567890' } },
        { parent: { id: 'p2', name: 'Ibu Ahmad', phone: null } },
      ],
    },
    ...overrides,
  };
}

describe('sendMonthlySppReminders', () => {
  beforeEach(() => vi.clearAllMocks());

  it('notifies every linked parent in-app and via WhatsApp when a phone exists', async () => {
    mockFindMany.mockResolvedValue([invoice()]);

    const result = await sendMonthlySppReminders(new Date('2026-07-01'));

    expect(result).toEqual({ invoices: 1, notified: 2 });
    // In-app for both parents
    expect(mockCreateNotification).toHaveBeenCalledTimes(2);
    expect(mockCreateNotification.mock.calls.map((c) => c[0].userId).sort()).toEqual(['p1', 'p2']);
    expect(mockCreateNotification.mock.calls[0][0].link).toBe('/parent/finance');
    // WhatsApp only for the parent with a phone number
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][0]).toMatchObject({
      channel: 'WHATSAPP',
      recipientPhone: '+6281234567890',
    });
    expect(mockSend.mock.calls[0][0].message).toContain('SPP');
    expect(mockSend.mock.calls[0][0].message).toContain('Ahmad');
  });

  it('targets a half-open month [start, end) for unpaid invoices', async () => {
    mockFindMany.mockResolvedValue([]);
    await sendMonthlySppReminders(new Date('2026-07-15'));

    const where = mockFindMany.mock.calls[0][0].where;
    expect(where.status.in).toEqual(['PENDING', 'PARTIAL', 'OVERDUE']);
    // The due-date column holds a date-only value at midnight UTC, so the
    // window is [1 July 00:00Z, 1 August 00:00Z). `lt` (not `lte` on 23:59:59)
    // keeps the month exact.
    expect(where.dueDate.gte).toEqual(new Date('2026-07-01T00:00:00.000Z'));
    expect(where.dueDate.lt).toEqual(new Date('2026-08-01T00:00:00.000Z'));
  });

  it('uses the WIB month at 2026-08-01 06:00 WIB, not the server’s July', async () => {
    // The reminder cron fires at 06:00 WIB on the 1st, two hours after
    // auto-billing. On a UTC server the instant is still 31 July — the month
    // must follow WIB, or it would look a month behind the invoices just issued.
    mockFindMany.mockResolvedValue([]);
    await sendMonthlySppReminders(new Date('2026-07-31T23:00:00Z'));

    const where = mockFindMany.mock.calls[0][0].where;
    expect(where.dueDate.gte).toEqual(new Date('2026-08-01T00:00:00.000Z'));
    expect(where.dueDate.lt).toEqual(new Date('2026-09-01T00:00:00.000Z'));
  });

  it('includes a bill due the first of the WIB month and excludes one due the first of the next', async () => {
    // Boundary: a first-day bill is stored at 00:00Z, so it must sit inside its
    // own month's window (> = start) and outside the next month's (< lt). A WIB
    // window would start at 17:00Z the day before and sweep the next month's
    // first bill into this month.
    mockFindMany.mockResolvedValue([]);
    await sendMonthlySppReminders(new Date('2026-08-01T04:00:00Z'));

    const where = mockFindMany.mock.calls[0][0].where;
    expect(where.dueDate.gte).toEqual(new Date('2026-08-01T00:00:00.000Z')); // 1 Aug
    expect(where.dueDate.lt).toEqual(new Date('2026-09-01T00:00:00.000Z')); // 1 Sep

    const firstDayBill = new Date('2026-08-01T00:00:00.000Z');
    const nextMonthFirstDay = new Date('2026-09-01T00:00:00.000Z');
    expect(firstDayBill >= where.dueDate.gte && firstDayBill < where.dueDate.lt).toBe(true);
    expect(nextMonthFirstDay >= where.dueDate.gte && nextMonthFirstDay < where.dueDate.lt).toBe(
      false
    );
  });

  it('keeps going when one parent notification fails', async () => {
    mockFindMany.mockResolvedValue([invoice()]);
    mockCreateNotification.mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ id: 'n2' });

    const result = await sendMonthlySppReminders(new Date('2026-07-01'));
    expect(result.notified).toBe(1);
  });

  it('renders the bill date as the billed day on a UTC server, not the day before', async () => {
    // The defect a WIB-midnight `dueDate` introduced: 10 July at 00:00 WIB is
    // 2026-07-09T17:00Z, which `toLocaleDateString('id-ID')` on a UTC server
    // prints as "9/7/2026". The due date the generators now store is `wibDate`,
    // so the test takes its value from there and pins the string the parent
    // actually reads — not just the stored instant.
    const prevTz = process.env.TZ;
    process.env.TZ = 'UTC';
    try {
      mockFindMany.mockResolvedValue([invoice({ dueDate: wibDate(2026, 6, 10) })]);

      await sendMonthlySppReminders(new Date('2026-07-01'));

      expect(mockSend.mock.calls[0][0].message).toContain('10/7/2026');
      expect(mockSend.mock.calls[0][0].message).not.toContain('9/7/2026');
    } finally {
      if (prevTz === undefined) delete process.env.TZ;
      else process.env.TZ = prevTz;
    }
  });
});
