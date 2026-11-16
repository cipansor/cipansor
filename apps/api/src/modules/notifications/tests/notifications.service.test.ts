import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createNotification,
  deleteNotification,
  getChannelPolicy,
  getNotificationById,
  retryDueReminderChannels,
  MAX_CHANNEL_ATTEMPTS,
} from '../notifications.service';
import { prisma } from '../../../lib/prisma';
import type { CreateNotificationInput } from '../notifications.schema';

vi.mock('../../../lib/prisma', () => {
  const prisma = {
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
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    invoice: {
      findUnique: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    // The atomic per-channel claim/outcome are raw SQL statements (one
    // statement, so two runs cannot clobber each other's channel states).
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    // The marker and the in-app row are written in one transaction; the mock
    // hands the callback the same mocked client, so the tx calls are the ones
    // the tests already assert on.
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
  };
  return { prisma };
});

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

/** The SQL text of every call, for asserting on literals rather than values. */
function rawSql(raw: unknown): string {
  const calls = (raw as { mock: { calls: unknown[][] } }).mock.calls;
  return calls.map((call) => (call[0] as string[]).join('?')).join('\n');
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
    (prisma.notification.create as any).mockResolvedValue({ id: 'n-1', status: 'UNREAD' });

    const result = await createNotification({ ...base, dedupeKey: 'payment-reminder:inv-1' });

    // The marker is created first; the bell row is just the in-app record.
    expect(prisma.notificationDelivery.create).toHaveBeenCalledWith({
      data: { userId: 'u-1', dedupeKey: 'payment-reminder:inv-1', channels: {} },
    });
    const args = (prisma.notification.create as any).mock.calls[0][0];
    expect(args.data.dedupeKey).toBe('payment-reminder:inv-1');
    expect(args.data.userId).toBe('u-1');
    // The persisted row is returned, not the pre-insert payload — a caller
    // needing the created notification gets its generated id (review finding).
    expect(result).toMatchObject({ id: 'n-1', status: 'UNREAD' });
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

  it('records a policy-blocked channel under `skip`, not over its delivery state', async () => {
    // A retryable PENDING for EMAIL is on the marker; the admin then disables
    // EMAIL for a tick. The disablement must not overwrite PENDING with a state
    // the claim cannot recover (review finding on #804).
    (prisma.notificationDelivery.create as any).mockRejectedValue({ code: 'P2002' });
    (prisma.notificationDelivery.findUnique as any).mockResolvedValue({
      id: 'd-1',
      channels: { EMAIL: 'PENDING' },
    });
    (prisma.setting.findFirst as any).mockResolvedValue({
      value: { EMAIL: false, SMS: true, WHATSAPP: true },
    });
    (prisma.$executeRaw as any).mockResolvedValue(1);

    await createNotification({
      ...base,
      channels: ['IN_APP', 'EMAIL'],
      dedupeKey: 'payment-reminder:inv-1',
    });

    // The policy decision is written to `skip`; no channel state is overwritten
    // and the claim is never attempted for a blocked channel.
    expect(rawSql(prisma.$executeRaw)).toContain('skip');
    expect(rawValues(prisma.$executeRaw)).not.toContain('SKIPPED');
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('only writes an outcome while the claim is still the current one', async () => {
    (prisma.notificationDelivery.create as any).mockResolvedValue({ id: 'd-1', channels: {} });
    (prisma.$queryRaw as any).mockResolvedValue([{ id: 'd-1' }]);
    (prisma.$executeRaw as any).mockResolvedValue(1);
    (prisma.notification.create as any).mockResolvedValue({ id: 'n-1' });
    (prisma.setting.findFirst as any).mockResolvedValue(null);
    (prisma.user.findUnique as any).mockResolvedValue({ email: 'a@b.c', phone: null });
    dispatchExternal().mockResolvedValue({ success: true, channel: 'EMAIL', delivered: true });

    await createNotification({
      ...base,
      channels: ['IN_APP', 'EMAIL'],
      dedupeKey: 'payment-reminder:inv-1',
    });

    // The outcome UPDATE is guarded by the claim token (the epoch ms written at
    // claim time), so a late result from an expired claim matches no row and
    // cannot clobber a newer SENT.
    expect(rawSql(prisma.$executeRaw)).toContain('_claims');
  });

  it('never suppresses a one-shot notification (no dedupe key)', async () => {
    (prisma.notification.create as any).mockResolvedValue({ id: 'n-2' });

    await createNotification(base);

    expect(prisma.notificationDelivery.create).not.toHaveBeenCalled();
    const args = (prisma.notification.create as any).mock.calls[0][0];
    expect(args.data.dedupeKey).toBeUndefined();
  });

  it('caps the attempts: the claim increments `_attempts` and refuses past the cap (#1074)', async () => {
    (prisma.notificationDelivery.create as any).mockRejectedValue({ code: 'P2002' });
    (prisma.notificationDelivery.findUnique as any).mockResolvedValue({
      id: 'd-1',
      channels: { EMAIL: 'FAILED', _attempts: { EMAIL: 1 } },
    });
    (prisma.$queryRaw as any).mockResolvedValue([{ id: 'd-1' }]);
    (prisma.$executeRaw as any).mockResolvedValue(1);
    (prisma.setting.findFirst as any).mockResolvedValue(null);
    (prisma.user.findUnique as any).mockResolvedValue({ email: 'a@b.c', phone: null });
    dispatchExternal().mockResolvedValue({ success: true, channel: 'EMAIL', delivered: true });

    await createNotification({
      ...base,
      channels: ['IN_APP', 'EMAIL'],
      dedupeKey: 'payment-reminder:inv-1',
    });

    // The count rides the same atomic claim as `_claims`, so no schema column
    // is needed, and the claim refuses once the count reaches the cap.
    const sql = rawSql(prisma.$queryRaw);
    expect(sql).toContain('_attempts');
    expect(rawValues(prisma.$queryRaw)).toContain(String(MAX_CHANNEL_ATTEMPTS));
  });

  it('rolls the marker and the row back together when the insert fails', async () => {
    (prisma.notificationDelivery.create as any).mockResolvedValue({ id: 'd-1', channels: {} });
    (prisma.notification.create as any).mockRejectedValue(new Error('db down'));

    await expect(
      createNotification({ ...base, dedupeKey: 'payment-reminder:inv-9' })
    ).rejects.toThrow('db down');

    // Marker and row are written in one transaction, so the failed insert
    // rolls the marker back too — no partial slot, and no separate delete.
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.notificationDelivery.delete).not.toHaveBeenCalled();
  });

  it('`retryExisting: false` creates only, leaving an existing marker untouched (#1074)', async () => {
    // The reminder task runs the sweep first; a second attempt from the day's
    // selection would spend the same day's quota. The create-only caller must
    // not dispatch for a marker that already exists.
    (prisma.notificationDelivery.create as any).mockRejectedValue({ code: 'P2002' });
    (prisma.notificationDelivery.findUnique as any).mockResolvedValue({
      id: 'd-1',
      channels: { EMAIL: 'FAILED' },
    });
    (prisma.$queryRaw as any).mockResolvedValue([{ id: 'd-1' }]);
    (prisma.user.findUnique as any).mockResolvedValue({ email: 'a@b.c', phone: null });

    const result = await createNotification(
      { ...base, channels: ['IN_APP', 'EMAIL'], dedupeKey: 'payment-reminder:inv-1' },
      { retryExisting: false }
    );

    expect(result).toBeNull();
    expect(dispatchExternal()).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
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

/**
 * The retry sweep is driven by the delivery marker, not the day's invoice
 * selection (#1074). Before it, a channel that failed on its last in-window
 * attempt was frozen forever once its bill left the seven-day window, and a
 * bill already due dropped out of the window entirely. These tests fail at the
 * pre-#1074 base — `retryDueReminderChannels` did not exist — and pass after.
 */
describe('retryDueReminderChannels — the sweep retries a marker past the window (#1074)', () => {
  const dispatchExternal = () => vi.mocked(channelService.dispatchExternal);

  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.$queryRaw as any).mockResolvedValue([]);
    (prisma.$executeRaw as any).mockResolvedValue(0);
    (prisma.setting.findFirst as any).mockResolvedValue(null);
  });

  /** One page of markers; a short page ends the pagination loop. */
  function markerPage(rows: Array<Record<string, unknown>>) {
    (prisma.notificationDelivery.findMany as any).mockResolvedValue(rows);
  }

  /** A payment-reminder invoice whose recipient is the marker's own user. */
  function paymentInvoice(overrides: Record<string, unknown> = {}) {
    return {
      status: 'PENDING',
      amount: 500000,
      paidAmount: 0,
      period: 'Juli 2026',
      dueDate: new Date('2026-07-10T00:00:00.000Z'),
      paymentType: { name: 'SPP' },
      student: { userId: 'u-1', user: { name: 'Ahmad' }, parents: [] },
      ...overrides,
    };
  }

  /** `createNotification` finding the marker already claimed, retrying EMAIL. */
  function markerAlreadyClaimed() {
    (prisma.notificationDelivery.create as any).mockRejectedValue({ code: 'P2002' });
    (prisma.notificationDelivery.findUnique as any).mockResolvedValue({
      id: 'd-1',
      channels: { EMAIL: 'FAILED' },
    });
    (prisma.$queryRaw as any).mockResolvedValue([{ id: 'd-1' }]);
    (prisma.$executeRaw as any).mockResolvedValue(1);
    (prisma.user.findUnique as any).mockResolvedValue({ email: 'a@b.c', phone: null });
    dispatchExternal().mockResolvedValue({ success: true, channel: 'EMAIL', delivered: true });
  }

  it('retries a FAILED channel of a bill due today (its last in-window day)', async () => {
    markerPage([
      {
        id: 'm-1',
        userId: 'u-1',
        dedupeKey: 'payment-reminder:inv-1',
        channels: { EMAIL: 'FAILED', _attempts: { EMAIL: 1 } },
      },
    ]);
    (prisma.invoice.findUnique as any).mockResolvedValue(paymentInvoice());
    markerAlreadyClaimed();

    // 08:00 WIB on the due day: the bill is no longer in the *new* selection
    // window, yet the marker still owes a send and must be retried.
    const retried = await retryDueReminderChannels(new Date('2026-07-10T01:00:00.000Z'));

    expect(retried).toBe(1);
    expect(dispatchExternal()).toHaveBeenCalledTimes(1);
    expect(rawValues(prisma.$executeRaw)).toContain('SENT');
  });

  it('retries a PENDING WhatsApp channel on an SPP marker', async () => {
    markerPage([
      {
        id: 'm-2',
        userId: 'p-1',
        dedupeKey: 'spp-reminder:inv-2',
        channels: { WHATSAPP: 'PENDING', _attempts: { WHATSAPP: 0 } },
      },
    ]);
    (prisma.invoice.findUnique as any).mockResolvedValue(
      paymentInvoice({
        student: { userId: 's-1', user: { name: 'Ahmad' }, parents: [{ parentId: 'p-1' }] },
      })
    );
    (prisma.notificationDelivery.create as any).mockRejectedValue({ code: 'P2002' });
    (prisma.notificationDelivery.findUnique as any).mockResolvedValue({
      id: 'd-2',
      channels: { WHATSAPP: 'PENDING' },
    });
    (prisma.$queryRaw as any).mockResolvedValue([{ id: 'd-2' }]);
    (prisma.$executeRaw as any).mockResolvedValue(1);
    (prisma.user.findUnique as any).mockResolvedValue({ email: null, phone: '+628123' });
    dispatchExternal().mockResolvedValue({ success: true, channel: 'WHATSAPP', delivered: true });

    const retried = await retryDueReminderChannels(new Date('2026-07-10T01:00:00.000Z'));

    expect(retried).toBe(1);
    expect(dispatchExternal()).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'WHATSAPP' })
    );
  });

  it('stops once the WIB day the bill is due on has ended', async () => {
    markerPage([
      {
        id: 'm-3',
        userId: 'u-1',
        dedupeKey: 'payment-reminder:inv-3',
        channels: { EMAIL: 'FAILED', _attempts: { EMAIL: 1 } },
      },
    ]);
    // Due yesterday: past the point the reminder text holds.
    (prisma.invoice.findUnique as any).mockResolvedValue(
      paymentInvoice({ dueDate: new Date('2026-07-09T00:00:00.000Z') })
    );

    const retried = await retryDueReminderChannels(new Date('2026-07-10T01:00:00.000Z'));

    expect(retried).toBe(0);
    expect(dispatchExternal()).not.toHaveBeenCalled();
  });

  it('leaves a paid or cancelled bill alone, whatever its channel state', async () => {
    markerPage([
      {
        id: 'm-4',
        userId: 'u-1',
        dedupeKey: 'payment-reminder:inv-4',
        channels: { EMAIL: 'FAILED', _attempts: { EMAIL: 1 } },
      },
    ]);
    (prisma.invoice.findUnique as any).mockResolvedValue(paymentInvoice({ status: 'PAID' }));

    const retried = await retryDueReminderChannels(new Date('2026-07-10T01:00:00.000Z'));

    expect(retried).toBe(0);
    expect(dispatchExternal()).not.toHaveBeenCalled();
  });

  it('does not retry a channel that already reached the attempt cap', async () => {
    markerPage([
      {
        id: 'm-5',
        userId: 'u-1',
        dedupeKey: 'payment-reminder:inv-5',
        channels: { EMAIL: 'FAILED', _attempts: { EMAIL: 3 } },
      },
    ]);

    const retried = await retryDueReminderChannels(new Date('2026-07-10T01:00:00.000Z'));

    expect(retried).toBe(0);
    // The cap is decided from the marker alone, before the bill is even read.
    expect(prisma.invoice.findUnique).not.toHaveBeenCalled();
  });

  it('never touches a channel that already went out (SENT)', async () => {
    markerPage([
      {
        id: 'm-6',
        userId: 'u-1',
        dedupeKey: 'payment-reminder:inv-6',
        channels: { EMAIL: 'SENT' },
      },
    ]);

    const retried = await retryDueReminderChannels(new Date('2026-07-10T01:00:00.000Z'));

    expect(retried).toBe(0);
    expect(dispatchExternal()).not.toHaveBeenCalled();
  });

  it('retries a channel the policy blocked on the first attempt once it is re-enabled (#1074)', async () => {
    // The first attempt ran while EMAIL was disabled: `markChannelPolicySkipped`
    // recorded `skip.EMAIL` and left `EMAIL` unset. The sweep used to ignore a
    // marker whose only external channel carried just a `skip`, so once the
    // admin re-enabled EMAIL the reminder was never sent — even while the bill
    // was still inside its window.
    markerPage([
      {
        id: 'm-policy-on',
        userId: 'u-1',
        dedupeKey: 'payment-reminder:inv-policy-on',
        channels: { skip: { EMAIL: 1750000000000 } },
      },
    ]);
    (prisma.invoice.findUnique as any).mockResolvedValue(paymentInvoice());
    // EMAIL is allowed again.
    (prisma.setting.findFirst as any).mockResolvedValue({
      value: { EMAIL: true, SMS: true, WHATSAPP: true },
    });
    markerAlreadyClaimed();

    const retried = await retryDueReminderChannels(new Date('2026-07-10T01:00:00.000Z'));

    expect(retried).toBe(1);
    expect(dispatchExternal()).toHaveBeenCalledWith(expect.objectContaining({ channel: 'EMAIL' }));
  });

  it('leaves a policy-blocked channel alone while the policy still blocks it (#1074)', async () => {
    // Same marker, but EMAIL is still disabled: the sweep must not invent a send
    // for a channel the policy forbids.
    markerPage([
      {
        id: 'm-policy-off',
        userId: 'u-1',
        dedupeKey: 'payment-reminder:inv-policy-off',
        channels: { skip: { EMAIL: 1750000000000 } },
      },
    ]);
    (prisma.setting.findFirst as any).mockResolvedValue({
      value: { EMAIL: false, SMS: true, WHATSAPP: true },
    });

    const retried = await retryDueReminderChannels(new Date('2026-07-10T01:00:00.000Z'));

    expect(retried).toBe(0);
    expect(dispatchExternal()).not.toHaveBeenCalled();
  });

  it('does not revive an unclaimed channel the policy never blocked (#1074)', async () => {
    // A bare unset channel with no `skip` decision is not owed: only a policy
    // block leaves the channel unclaimed yet still due.
    markerPage([
      {
        id: 'm-unset',
        userId: 'u-1',
        dedupeKey: 'payment-reminder:inv-unset',
        channels: {},
      },
    ]);

    const retried = await retryDueReminderChannels(new Date('2026-07-10T01:00:00.000Z'));

    expect(retried).toBe(0);
    expect(dispatchExternal()).not.toHaveBeenCalled();
  });

  it('recovers a RETRYING claim whose lease has lapsed (#1074)', async () => {
    // A run killed mid-send leaves the channel RETRYING; past the lease the
    // sweep must offer it again, or the SPP reminder is wedged until it ages
    // out (the monthly job has no other daily selection).
    const claimedAt = new Date('2026-07-10T01:00:00.000Z').getTime() - 2 * 60 * 60 * 1000;
    markerPage([
      {
        id: 'm-7',
        userId: 'u-1',
        dedupeKey: 'payment-reminder:inv-7',
        channels: { EMAIL: 'RETRYING', _attempts: { EMAIL: 1 }, _claims: { EMAIL: claimedAt } },
      },
    ]);
    (prisma.invoice.findUnique as any).mockResolvedValue(paymentInvoice());
    markerAlreadyClaimed();

    const retried = await retryDueReminderChannels(new Date('2026-07-10T01:00:00.000Z'));

    expect(retried).toBe(1);
  });

  it('leaves an active RETRYING claim to its owner (#1074)', async () => {
    const claimedAt = new Date('2026-07-10T01:00:00.000Z').getTime() - 60 * 1000;
    markerPage([
      {
        id: 'm-8',
        userId: 'u-1',
        dedupeKey: 'payment-reminder:inv-8',
        channels: { EMAIL: 'RETRYING', _attempts: { EMAIL: 1 }, _claims: { EMAIL: claimedAt } },
      },
    ]);

    const retried = await retryDueReminderChannels(new Date('2026-07-10T01:00:00.000Z'));

    expect(retried).toBe(0);
    expect(dispatchExternal()).not.toHaveBeenCalled();
  });

  it('skips a former guardian whose link to the student was revoked (#1074)', async () => {
    // The marker outlives the link; the sweep re-checks entitlement at send
    // time so a revoked guardian stops receiving the child's bill details.
    markerPage([
      {
        id: 'm-9',
        userId: 'p-former',
        dedupeKey: 'spp-reminder:inv-9',
        channels: { WHATSAPP: 'FAILED', _attempts: { WHATSAPP: 1 } },
      },
    ]);
    (prisma.invoice.findUnique as any).mockResolvedValue(
      paymentInvoice({
        student: { userId: 's-1', user: { name: 'Ahmad' }, parents: [{ parentId: 'p-current' }] },
      })
    );

    const retried = await retryDueReminderChannels(new Date('2026-07-10T01:00:00.000Z'));

    expect(retried).toBe(0);
    expect(dispatchExternal()).not.toHaveBeenCalled();
  });

  it('rebuilds the message with a fresh countdown, not the stored row (#1074)', async () => {
    // The bell row is not read at all: a retry recomputes "due in N days" from
    // the invoice, so a bill due today reads "0 hari" instead of a frozen 7, and
    // a recipient deleting the row cannot end the retries.
    markerPage([
      {
        id: 'm-10',
        userId: 'u-1',
        dedupeKey: 'payment-reminder:inv-10',
        channels: { EMAIL: 'FAILED', _attempts: { EMAIL: 1 } },
      },
    ]);
    (prisma.invoice.findUnique as any).mockResolvedValue(paymentInvoice());
    markerAlreadyClaimed();

    await retryDueReminderChannels(new Date('2026-07-10T01:00:00.000Z'));

    expect(prisma.notification.findFirst).not.toHaveBeenCalled();
    // The retry path does not create a row (the marker already exists); the
    // rebuilt message is what goes out on the channel.
    expect(dispatchExternal()).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('0 hari') })
    );
  });

  it('paginates past a full page of finished markers (#1074)', async () => {
    // A finished marker stops updating, so a single capped page let it fill the
    // result and starve the retryable marker behind it. The sweep pages by a
    // stable cursor instead of stopping after one page.
    const finished = Array.from({ length: 500 }, (_, i) => ({
      id: `done-${i}`,
      userId: 'u-x',
      dedupeKey: `payment-reminder:done-${i}`,
      channels: { EMAIL: 'SENT' },
    }));
    const retryable = {
      id: 'm-11',
      userId: 'u-1',
      dedupeKey: 'payment-reminder:inv-11',
      channels: { EMAIL: 'FAILED', _attempts: { EMAIL: 1 } },
    };
    (prisma.notificationDelivery.findMany as any)
      .mockResolvedValueOnce(finished)
      .mockResolvedValueOnce([retryable]);
    (prisma.invoice.findUnique as any).mockResolvedValue(paymentInvoice());
    markerAlreadyClaimed();

    const retried = await retryDueReminderChannels(new Date('2026-07-10T01:00:00.000Z'));

    expect(prisma.notificationDelivery.findMany).toHaveBeenCalledTimes(2);
    expect(retried).toBe(1);
  });
});
