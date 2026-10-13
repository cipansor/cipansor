import { describe, it, expect, vi, beforeEach } from 'vitest';
import { notificationScheduler } from '../../src/modules/notifications/scheduler.service';
import { prisma } from '../../src/lib/prisma';

// Mock prisma
vi.mock('../../src/lib/prisma', () => ({
  prisma: {
    invoice: {
      findMany: vi.fn(),
    },
    notification: {
      findFirst: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
    },
    notificationDelivery: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    setting: {
      findFirst: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

describe('Payment Reminder Performance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.notification.findFirst).mockResolvedValue(null);
    // Each invoice is a fresh delivery slot; the marker claim succeeds and the
    // channel map is written after dispatch.
    vi.mocked(prisma.notificationDelivery.create).mockResolvedValue({
      id: 'delivery-1',
      channels: {},
    } as any);
    vi.mocked(prisma.notificationDelivery.findUnique).mockResolvedValue({
      id: 'delivery-1',
      channels: {},
    } as any);
    vi.mocked(prisma.notificationDelivery.update).mockResolvedValue({} as any);
    vi.mocked(prisma.setting.findFirst).mockResolvedValue(null as any);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null as any);
  });

  it('measures payment reminder batching', async () => {
    const invoiceCount = 100;
    const now = new Date();
    const sevenDaysLater = new Date(now);
    sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);

    // Mock invoices
    const invoices = Array.from({ length: invoiceCount }).map((_, i) => ({
      id: `invoice-${i}`,
      amount: 100000,
      dueDate: sevenDaysLater,
      status: 'PENDING',
      student: {
        user: {
          id: `user-${i}`,
          name: `Student ${i}`,
          email: `student${i}@example.com`,
          phone: `0812345678${i}`,
        },
      },
      paymentType: {
        name: 'SPP',
      },
    }));

    vi.mocked(prisma.invoice.findMany).mockResolvedValue(invoices as any);
    // No prior delivery for any invoice, so batching runs the create path.
    vi.mocked(prisma.notification.findFirst).mockResolvedValue(null as any);
    vi.mocked(prisma.notification.create).mockResolvedValue({ id: 'new-notif' } as any);
    vi.mocked(prisma.notification.createMany).mockResolvedValue({ count: invoiceCount } as any);

    const start = performance.now();
    await notificationScheduler.runTask('payment-reminder');
    const end = performance.now();
    const duration = end - start;

    process.stdout.write(
      `\n[Benchmark] Processing ${invoiceCount} invoices took ${duration.toFixed(2)}ms\n`
    );

    const createCalls = vi.mocked(prisma.notification.create).mock.calls.length;
    const createManyCalls = vi.mocked(prisma.notification.createMany).mock.calls.length;

    process.stdout.write(`[Metrics] create: ${createCalls}, createMany: ${createManyCalls}\n`);

    if (createManyCalls > 0) {
      const payload = vi.mocked(prisma.notification.createMany).mock.calls[0][0];
      const data = payload?.data;
      if (Array.isArray(data) && data.length > 0) {
        const firstItem = data[0];
        const extraData = firstItem.data as any;
        if (extraData?.priority === 'HIGH' && extraData?.channels?.includes('EMAIL')) {
          process.stdout.write(
            `[Validation] Payload has priority and channels preserved in data field.\n`
          );
        } else {
          process.stdout.write(
            `[Validation] FAILED: Payload missing priority or channels in data field.\n`
          );
          console.log('Received data:', JSON.stringify(extraData, null, 2));
        }
      }
    }
  });
});
