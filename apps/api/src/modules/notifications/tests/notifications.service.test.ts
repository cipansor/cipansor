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
      update: vi.fn(),
    },
    notificationDelivery: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    // The atomic per-channel claim/outcome are raw SQL statements (one
    // statement, so two runs cannot clobber each other's channel states).
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
  },
}));

vi.mock('../email-sms.service', () => ({
  notificationService: {
    dispatchExternal: vi.fn(),
  },
}));

import { notificationService as channelService } from '../email-sms.service';

/**
 * The strings a mocked Prisma tag function received. Prisma's `$queryRaw` /
 * `$executeRaw` are called as tagged templates, so the mock's first argument is
 * the template's string parts and the rest are the interpolated values. Flatten
 * both to assert which state was recorded.
 */
function rawValues(raw: unknown): string[] {
  const calls = (raw as { mock: { calls: unknown[][] } }).mock.calls;
  return calls.flatMap((call) =>
    call.flatMap((part) => (Array.isArray(part) ? part.map(String) : [String(part ?? '')]))
  );
}

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

describe('createNotification — durable recurring delivery (#802)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Raw statements default to a clean no-op, so a channel that is never
    // claimed records nothing. Tests that expect a claim override these.
    (prisma.$queryRaw as any).mockResolvedValue([]);
    (prisma.$executeRaw as any).mockResolvedValue(0);
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

  const dispatchExternal = () => vi.mocked(channelService.dispatchExternal);

  it('claims a durable marker and writes the dedupe key onto the row', async () => {
    (prisma.notificationDelivery.create as any).mockResolvedValue({ id: 'd-1', channels: {} });
    (prisma.notification.create as any).mockResolvedValue({ id: 'n-1' });

    await createNotification({ ...base, dedupeKey: 'payment-reminder:inv-1' });

    // The marker is created first; the bell row is just the in-app record.
    expect(prisma.notificationDelivery.create).toHaveBeenCalledWith({
      data: { userId: 'u-1', dedupeKey: 'payment-reminder:inv-1', channels: {} },
    });
    const args = (prisma.notification.create as any).mock.calls[0][0];
    expect(args.data.dedupeKey).toBe('payment-reminder:inv-1');
    expect(args.data.userId).toBe('u-1');
  });

  it('suppresses a redelivery whose marker exists and owes no channel', async () => {
    // P2002 on the marker means the slot was already claimed.
    (prisma.notificationDelivery.create as any).mockRejectedValue({ code: 'P2002' });
    (prisma.notificationDelivery.findUnique as any).mockResolvedValue({
      id: 'd-1',
      channels: { IN_APP: 'SENT' },
    });

    const result = await createNotification({ ...base, dedupeKey: 'payment-reminder:inv-1' });

    expect(result).toBeNull();
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  it('retries a channel left FAILED without recreating the in-app row', async () => {
    (prisma.notificationDelivery.create as any).mockRejectedValue({ code: 'P2002' });
    (prisma.notificationDelivery.findUnique as any).mockResolvedValue({
      id: 'd-1',
      channels: { EMAIL: 'FAILED' },
    });
    // The per-channel claim wins (returns a row), so the retry runs.
    (prisma.$queryRaw as any).mockResolvedValue([{ id: 'd-1' }]);
    (prisma.$executeRaw as any).mockResolvedValue(1);
    (prisma.setting.findFirst as any).mockResolvedValue(null);
    (prisma.user.findUnique as any).mockResolvedValue({ email: 'a@b.c', phone: null });
    dispatchExternal().mockResolvedValue({
      success: true,
      channel: 'EMAIL',
      delivered: true,
    });

    const result = await createNotification({
      ...base,
      channels: ['IN_APP', 'EMAIL'],
      dedupeKey: 'payment-reminder:inv-1',
    });

    expect(result).toBeNull();
    expect(prisma.notification.create).not.toHaveBeenCalled();
    expect(dispatchExternal()).toHaveBeenCalledTimes(1);
    // The outcome is written by a deterministic statement, not a map merge.
    expect(rawValues(prisma.$executeRaw)).toContain('SENT');
  });

  it('records a failed dispatch as FAILED so the next run can retry', async () => {
    (prisma.notificationDelivery.create as any).mockResolvedValue({ id: 'd-1', channels: {} });
    (prisma.$queryRaw as any).mockResolvedValue([{ id: 'd-1' }]);
    (prisma.$executeRaw as any).mockResolvedValue(1);
    (prisma.notification.create as any).mockResolvedValue({ id: 'n-1' });
    (prisma.setting.findFirst as any).mockResolvedValue(null);
    (prisma.user.findUnique as any).mockResolvedValue({ email: 'a@b.c', phone: null });
    dispatchExternal().mockResolvedValue({
      success: false,
      channel: 'EMAIL',
      error: 'smtp down',
    });

    await createNotification({
      ...base,
      channels: ['IN_APP', 'EMAIL'],
      dedupeKey: 'payment-reminder:inv-1',
    });

    // The FAILED state is written by $executeRaw (deterministic), so the next
    // run's claim matches and retries it.
    expect(rawValues(prisma.$executeRaw)).toContain('FAILED');
  });

  it('does not mark a log-only email SENT — a later transport still delivers', async () => {
    (prisma.notificationDelivery.create as any).mockResolvedValue({ id: 'd-1', channels: {} });
    (prisma.$queryRaw as any).mockResolvedValue([{ id: 'd-1' }]);
    (prisma.$executeRaw as any).mockResolvedValue(1);
    (prisma.notification.create as any).mockResolvedValue({ id: 'n-1' });
    (prisma.setting.findFirst as any).mockResolvedValue(null);
    (prisma.user.findUnique as any).mockResolvedValue({ email: 'a@b.c', phone: null });
    // success: true, delivered: false — the log-only transport.
    dispatchExternal().mockResolvedValue({
      success: true,
      channel: 'EMAIL',
      delivered: false,
    });

    await createNotification({
      ...base,
      channels: ['IN_APP', 'EMAIL'],
      dedupeKey: 'payment-reminder:inv-1',
    });

    // PENDING must be the recorded state; a SENT here would suppress the real
    // send once email is configured. The state is written by $executeRaw.
    expect(rawValues(prisma.$executeRaw)).toContain('PENDING');
    expect(rawValues(prisma.$executeRaw)).not.toContain('SENT');
  });

  it('a lost channel claim sends nothing (concurrent retry is a no-op)', async () => {
    (prisma.notificationDelivery.create as any).mockRejectedValue({ code: 'P2002' });
    (prisma.notificationDelivery.findUnique as any).mockResolvedValue({
      id: 'd-1',
      channels: { EMAIL: 'FAILED' },
    });
    // Every claim matches 0 rows: the other run holds the channel.
    (prisma.$queryRaw as any).mockResolvedValue([]);
    (prisma.setting.findFirst as any).mockResolvedValue(null);
    (prisma.user.findUnique as any).mockResolvedValue({ email: 'a@b.c', phone: null });

    const result = await createNotification({
      ...base,
      channels: ['IN_APP', 'EMAIL'],
      dedupeKey: 'payment-reminder:inv-1',
    });

    expect(result).toBeNull();
    expect(dispatchExternal()).not.toHaveBeenCalled();
  });

  it('never suppresses a one-shot notification (no dedupe key)', async () => {
    (prisma.notification.create as any).mockResolvedValue({ id: 'n-2' });

    await createNotification(base);

    expect(prisma.notificationDelivery.create).not.toHaveBeenCalled();
    const args = (prisma.notification.create as any).mock.calls[0][0];
    expect(args.data.dedupeKey).toBeUndefined();
  });

  it('releases the slot and rethrows when the in-app row cannot be written', async () => {
    (prisma.notificationDelivery.create as any).mockResolvedValue({ id: 'd-1', channels: {} });
    (prisma.notificationDelivery.delete as any).mockResolvedValue({ id: 'd-1' });
    (prisma.notification.create as any).mockRejectedValue(new Error('db down'));

    await expect(
      createNotification({ ...base, dedupeKey: 'payment-reminder:inv-9' })
    ).rejects.toThrow('db down');

    // The marker is gone, so the next run retries the whole delivery rather
    // than leaving the reminder permanently silent.
    expect(prisma.notificationDelivery.delete).toHaveBeenCalledWith({ where: { id: 'd-1' } });
  });
});

describe('clearNotificationDeliveries — a recovery resets the slot (#804)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes every marker under the plan prefix', async () => {
    (prisma.notificationDelivery.deleteMany as any).mockResolvedValue({ count: 2 });

    const { clearNotificationDeliveries } = await import('../notifications.service');
    await clearNotificationDeliveries('budget-overrun:p-1:');

    expect((prisma.notificationDelivery.deleteMany as any).mock.calls[0][0].where).toEqual({
      dedupeKey: { startsWith: 'budget-overrun:p-1:' },
    });
  });
});
