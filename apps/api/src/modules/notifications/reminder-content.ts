/**
 * The text and routing of a payment reminder, rebuilt from the invoice.
 *
 * The first send and every retry build the message through these functions, so
 * a retry carries the same wording as the first attempt but with a *fresh*
 * countdown — reading the stored in-app row instead replayed a frozen "due in 7
 * days" on the due day (review finding on #1074), and made the retry depend on
 * a bell row the recipient is free to delete.
 */
import type { Prisma } from '@prisma/client';
import { dayOf, todayWib } from '../../utils/wib';
import type { CreateNotificationInput } from './notifications.schema';

const DAY_MS = 24 * 60 * 60 * 1000;

const idr = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  minimumFractionDigits: 0,
});

/** The invoice shape both reminder messages are rebuilt from. */
export interface ReminderInvoice {
  amount: Prisma.Decimal | number;
  paidAmount?: Prisma.Decimal | number | null;
  dueDate: Date;
  period?: string | null;
  paymentType?: { name: string } | null;
  student?: { user?: { name: string } | null } | null;
}

/** The routing and copy of a reminder, minus the recipient and its key. */
export type ReminderContent = Pick<
  CreateNotificationInput,
  'title' | 'message' | 'type' | 'priority' | 'channels' | 'recipientType' | 'link'
>;

/**
 * The H-7 window reminder: how many whole WIB days until the bill is due. The
 * count is recomputed on every attempt, so the day the bill is due reads "0
 * hari" rather than a stale seven.
 */
export function buildPaymentReminderContent(invoice: ReminderInvoice, now: Date): ReminderContent {
  const typeName = invoice.paymentType?.name || 'SPP';
  const amount = Number(invoice.amount).toLocaleString('id-ID');
  const daysUntilDue = Math.round(
    (invoice.dueDate.getTime() - dayOf(todayWib(now)).getTime()) / DAY_MS
  );
  return {
    title: 'Pengingat Pembayaran',
    message:
      'Tagihan ' +
      typeName +
      ' sebesar Rp ' +
      amount +
      ' akan jatuh tempo dalam ' +
      daysUntilDue +
      ' hari.',
    type: 'PAYMENT',
    priority: 'HIGH',
    channels: ['IN_APP', 'EMAIL'],
    recipientType: 'INDIVIDUAL',
  };
}

/**
 * The monthly SPP reminder: the outstanding amount (amount minus what was
 * already paid) and the bill's own date, both read from the invoice at build
 * time so a partial payment made between attempts is reflected.
 */
export function buildSppReminderContent(invoice: ReminderInvoice): ReminderContent {
  const typeName = invoice.paymentType?.name || 'SPP';
  const amountDue = Number(invoice.amount) - Number(invoice.paidAmount ?? 0);
  const studentName = invoice.student?.user?.name ?? '';
  return {
    title: 'Tagihan ' + typeName + ' Bulan Ini',
    message:
      'Tagihan ' +
      typeName +
      ' ' +
      (invoice.period ?? '') +
      ' a.n. ' +
      studentName +
      ' sebesar ' +
      idr.format(amountDue) +
      ' jatuh tempo ' +
      invoice.dueDate.toLocaleDateString('id-ID') +
      '. Mohon unggah bukti pembayaran melalui menu Tagihan & Pembayaran.',
    type: 'PAYMENT',
    priority: 'HIGH',
    channels: ['IN_APP', 'WHATSAPP'],
    recipientType: 'INDIVIDUAL',
    link: '/parent/finance',
  };
}
