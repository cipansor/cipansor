import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createNotification,
  deleteNotification,
  getChannelPolicy,
  getNotificationById,
} from '../notifications.service';
import { prisma } from '../../../lib/prisma';
import type { CreateNotificationInput } from '../notifications.schema';

vi.mock('../../../lib/prisma', () => ({
  prisma: {
    setting: {
      findFirst: vi.fn(),
    },
    notification: {
      findFirst: vi.fn(),
      deleteMany: vi.fn(),
      create: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
  },
}));

describe('Notifications Service - Channel Policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return default policy when no setting exists in DB', async () => {
    (prisma.setting.findFirst as any).mockResolvedValue(null);

    const policy = await getChannelPolicy();
    expect(policy).toEqual({ EMAIL: true, SMS: true, WHATSAPP: true });
  });

  it('should return configured policy when setting exists in DB', async () => {
    (prisma.setting.findFirst as any).mockResolvedValue({
      value: { EMAIL: false, SMS: true, WHATSAPP: false },
    });

    const policy = await getChannelPolicy();
    expect(policy).toEqual({ EMAIL: false, SMS: true, WHATSAPP: false });
  });

  it('should throw on DB lookup error so admin reads propagate errors', async () => {
    (prisma.setting.findFirst as any).mockRejectedValue(new Error('Database Connection Error'));

    await expect(getChannelPolicy()).rejects.toThrow('Database Connection Error');
  });
});

describe("Notifications Service - a notification is its owner's", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads one only together with its owner', async () => {
    (prisma.notification.findFirst as any).mockResolvedValue(null);

    expect(await getNotificationById('n-1', 'someone-else')).toBeNull();
    expect((prisma.notification.findFirst as any).mock.calls[0][0].where).toEqual({
      id: 'n-1',
      userId: 'someone-else',
    });
  });

  it('deletes one only together with its owner, whatever the role', async () => {
    (prisma.notification.deleteMany as any).mockResolvedValue({ count: 0 });

    await deleteNotification('n-1', 'admin-1');
    expect((prisma.notification.deleteMany as any).mock.calls[0][0].where).toEqual({
      id: 'n-1',
      userId: 'admin-1',
    });
  });
});

describe('createNotification — recurring delivery key (#802)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const base: CreateNotificationInput = {
    userId: 'u-1',
    title: 'Pengingat Pembayaran',
    message: 'Tagihan akan jatuh tempo.',
    type: 'PAYMENT',
    priority: 'HIGH',
    channels: ['IN_APP'],
    recipientType: 'INDIVIDUAL',
  };

  it('writes the dedupe key into the row so the unique index can back it', async () => {
    (prisma.notification.findFirst as any).mockResolvedValue(null);
    (prisma.notification.create as any).mockResolvedValue({ id: 'n-1' });

    await createNotification({ ...base, dedupeKey: 'payment-reminder:inv-1' });

    const args = (prisma.notification.create as any).mock.calls[0][0];
    expect(args.data.dedupeKey).toBe('payment-reminder:inv-1');
    expect(args.data.userId).toBe('u-1');
  });

  it('returns null without a second insert when the slot was already delivered', async () => {
    (prisma.notification.findFirst as any).mockResolvedValue({ id: 'n-existing' });

    const result = await createNotification({
      ...base,
      dedupeKey: 'payment-reminder:inv-1',
    });

    expect(result).toBeNull();
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  it('turns a lost race (P2002) into a no-op, not a duplicate', async () => {
    (prisma.notification.findFirst as any).mockResolvedValue(null);
    (prisma.notification.create as any).mockRejectedValue({ code: 'P2002' });

    const result = await createNotification({
      ...base,
      dedupeKey: 'budget-overrun:p-1:admin-1',
    });

    expect(result).toBeNull();
  });

  it('never suppresses a one-shot notification (no dedupe key)', async () => {
    (prisma.notification.create as any).mockResolvedValue({ id: 'n-2' });

    await createNotification(base);

    expect(prisma.notification.findFirst).not.toHaveBeenCalled();
    const args = (prisma.notification.create as any).mock.calls[0][0];
    expect(args.data.dedupeKey).toBeUndefined();
  });

  it('rethrows a create error that is not a unique violation', async () => {
    (prisma.notification.findFirst as any).mockResolvedValue(null);
    (prisma.notification.create as any).mockRejectedValue(new Error('db down'));

    await expect(
      createNotification({ ...base, dedupeKey: 'payment-reminder:inv-9' })
    ).rejects.toThrow('db down');
  });
});
