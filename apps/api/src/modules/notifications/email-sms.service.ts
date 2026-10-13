/**
 * Email/SMS Notification Service
 * Phase 7A.2 - Notification Integration
 *
 * Supports:
 * - Email notifications (Gmail API or SMTP — see email-transport.ts)
 * - SMS notifications via Twilio/AWS SNS
 * - Push notifications (future)
 * - Notification templates
 * - Delivery tracking
 */

import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { Twilio } from 'twilio';
import { config } from '../../config';
import { whatsAppService } from './whatsapp.service';
import {
  deliverEmail,
  describeEmailTransport,
  resetEmailTransport,
  type EmailTransportKind,
} from './email-transport';
import {
  BRAND,
  emailButton,
  emailFinePrint,
  emailHeading,
  emailLogoAttachment,
  emailNote,
  emailPanel,
  emailParagraph,
  emailSignoff,
  renderEmailLayout,
} from './email-layout';

/**
 * Escapes unsafe characters for HTML interpolation.
 */
function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Notification templates
const templates = {
  welcome: {
    subject: 'Akun Anda di Sistem Cipansor sudah aktif',
    html: (data: { name: string; email: string; password?: string }) =>
      renderEmailLayout({
        title: 'Akun Anda sudah aktif',
        preheader: `Detail akun untuk ${data.name}. Ganti kata sandi sementara setelah masuk pertama kali.`,
        bodyHtml:
          emailHeading('Akun Anda sudah aktif') +
          emailParagraph(`Halo <strong>${escapeHtml(data.name)}</strong>,`) +
          emailParagraph(
            'Akun Anda pada Sistem Informasi Yayasan Pesantren Cipansor telah dibuat dan siap digunakan.'
          ) +
          emailPanel([
            ['Email', escapeHtml(data.email)],
            ...(data.password
              ? ([['Kata sandi sementara', escapeHtml(data.password)]] as Array<[string, string]>)
              : []),
          ]) +
          (data.password
            ? emailNote(
                'Kata sandi di atas bersifat sementara. Mohon segera menggantinya setelah masuk pertama kali.'
              )
            : '') +
          emailSignoff('Tim Pengelola Sistem Cipansor'),
      }),
  },

  passwordReset: {
    subject: 'Atur ulang kata sandi akun Cipansor Anda',
    html: (data: { name: string; resetLink: string; expiresInHours?: number }) =>
      renderEmailLayout({
        title: 'Atur ulang kata sandi',
        preheader: `Tautan berlaku ${data.expiresInHours ?? 1} jam. Abaikan pesan ini bila Anda tidak memintanya.`,
        bodyHtml:
          emailHeading('Atur ulang kata sandi') +
          emailParagraph(`Halo <strong>${escapeHtml(data.name)}</strong>,`) +
          emailParagraph(
            'Kami menerima permintaan untuk mengatur ulang kata sandi akun Anda. Tekan tombol di bawah untuk menetapkan kata sandi baru.'
          ) +
          emailButton(data.resetLink, 'Atur Kata Sandi Baru') +
          // The lifetime is passed in rather than written here. Admin-initiated
          // resets last an hour; the tokens minted when a santri or wali account
          // is created last 24, and this line used to claim "1 jam" for both.
          emailFinePrint(
            `Tautan ini berlaku selama <strong>${data.expiresInHours ?? 1} jam</strong>. Bila tombol tidak berfungsi, salin alamat berikut ke peramban Anda:<br><span style="word-break:break-all;">${escapeHtml(data.resetLink)}</span>`
          ) +
          emailFinePrint(
            'Jika Anda tidak meminta pengaturan ulang, abaikan pesan ini — kata sandi Anda tidak berubah.'
          ) +
          emailSignoff('Tim Keamanan Sistem Cipansor'),
      }),
  },

  paymentReminder: {
    subject: 'Pengingat tagihan pendidikan',
    html: (data: {
      parentName: string;
      studentName: string;
      invoiceNumber: string;
      amount: string;
      dueDate: string;
    }) =>
      renderEmailLayout({
        title: 'Pengingat tagihan pendidikan',
        preheader: `Tagihan ${data.invoiceNumber} untuk ${data.studentName} jatuh tempo ${data.dueDate}.`,
        bodyHtml:
          emailHeading('Pengingat tagihan pendidikan') +
          emailParagraph(`Yth. Bapak/Ibu <strong>${escapeHtml(data.parentName)}</strong>,`) +
          emailParagraph('Berikut rincian tagihan untuk putra/putri Bapak/Ibu.') +
          emailPanel([
            ['Nama santri', escapeHtml(data.studentName)],
            ['Nomor tagihan', escapeHtml(data.invoiceNumber)],
            [
              'Jumlah',
              `<span style="color:${BRAND.greenDeep};font-size:16px;">${escapeHtml(data.amount)}</span>`,
            ],
            ['Jatuh tempo', `<span style="color:${BRAND.red};">${escapeHtml(data.dueDate)}</span>`],
          ]) +
          emailParagraph(
            'Pembayaran dapat dilakukan melalui Portal Wali atau rekening resmi yayasan sebelum tanggal jatuh tempo.'
          ) +
          emailSignoff('Bagian Keuangan Yayasan Pesantren Cipansor'),
      }),
  },

  paymentReceipt: {
    subject: 'Bukti pembayaran resmi',
    html: (data: {
      parentName: string;
      studentName: string;
      receiptNumber: string;
      amount: string;
      paymentDate: string;
      paymentMethod: string;
      description: string;
    }) =>
      renderEmailLayout({
        title: 'Bukti pembayaran resmi',
        preheader: `Pembayaran ${data.amount} untuk ${data.studentName} telah kami terima dan verifikasi.`,
        bodyHtml:
          emailHeading('Pembayaran Anda telah kami terima') +
          emailParagraph(`Yth. Bapak/Ibu <strong>${escapeHtml(data.parentName)}</strong>,`) +
          emailParagraph(
            'Pembayaran berikut telah diterima dan diverifikasi oleh Bagian Keuangan Yayasan Pesantren Cipansor.'
          ) +
          emailPanel([
            ['Nomor bukti', escapeHtml(data.receiptNumber)],
            ['Nama santri', escapeHtml(data.studentName)],
            ['Keterangan', escapeHtml(data.description)],
            ['Metode', escapeHtml(data.paymentMethod)],
            ['Tanggal', escapeHtml(data.paymentDate)],
            [
              'Total dibayar',
              `<span style="color:${BRAND.greenDeep};font-size:17px;">${escapeHtml(data.amount)}</span>`,
            ],
          ]) +
          emailParagraph(
            'Simpan pesan ini sebagai bukti pembayaran. Terima kasih atas kepercayaan Bapak/Ibu.'
          ) +
          emailSignoff('Bagian Keuangan Yayasan Pesantren Cipansor'),
      }),
  },

  violationNotification: {
    subject: 'Catatan kedisiplinan santri',
    html: (data: {
      parentName: string;
      studentName: string;
      violationType: string;
      description: string;
      points: number;
      date: string;
    }) =>
      renderEmailLayout({
        title: 'Catatan kedisiplinan santri',
        preheader: `Catatan kedisiplinan ${data.studentName} pada ${data.date}: ${data.violationType}.`,
        bodyHtml:
          emailHeading('Catatan kedisiplinan santri') +
          emailParagraph(`Yth. Bapak/Ibu <strong>${escapeHtml(data.parentName)}</strong>,`) +
          emailParagraph(
            'Kami menyampaikan catatan kedisiplinan putra/putri Bapak/Ibu agar dapat ditindaklanjuti bersama.'
          ) +
          emailPanel([
            ['Nama santri', escapeHtml(data.studentName)],
            ['Kategori', escapeHtml(data.violationType)],
            ['Uraian', escapeHtml(data.description)],
            ['Poin', `<span style="color:${BRAND.red};">+${data.points} poin</span>`],
            ['Tanggal', escapeHtml(data.date)],
          ]) +
          emailParagraph(
            'Mohon kerja samanya untuk membimbing ananda. Bila ingin berdiskusi lebih lanjut, silakan balas pesan ini.'
          ) +
          emailSignoff('Bagian Pengasuhan Yayasan Pesantren Cipansor'),
      }),
  },

  attendanceAlert: {
    subject: 'Laporan kehadiran santri',
    html: (data: {
      parentName: string;
      studentName: string;
      status: string;
      date: string;
      notes?: string;
    }) =>
      renderEmailLayout({
        title: 'Laporan kehadiran santri',
        preheader: `${data.studentName} tercatat ${data.status} pada ${data.date}.`,
        bodyHtml:
          emailHeading('Laporan kehadiran santri') +
          emailParagraph(`Yth. Bapak/Ibu <strong>${escapeHtml(data.parentName)}</strong>,`) +
          emailParagraph('Berikut status kehadiran putra/putri Bapak/Ibu.') +
          emailPanel([
            ['Nama santri', escapeHtml(data.studentName)],
            ['Tanggal', escapeHtml(data.date)],
            ['Status', escapeHtml(data.status)],
            ...(data.notes
              ? ([['Keterangan', escapeHtml(data.notes)]] as Array<[string, string]>)
              : []),
          ]) +
          emailSignoff('Bagian Kesiswaan Yayasan Pesantren Cipansor'),
      }),
  },

  permitStatusUpdate: {
    subject: 'Status permohonan izin santri',
    html: (data: {
      parentName: string;
      studentName: string;
      status: string;
      permitType: string;
      startDate: string;
      endDate: string;
      notes?: string;
    }) =>
      renderEmailLayout({
        title: 'Status permohonan izin santri',
        preheader: `Permohonan izin ${data.studentName} berstatus ${data.status}.`,
        bodyHtml:
          emailHeading('Status permohonan izin santri') +
          emailParagraph(`Yth. Bapak/Ibu <strong>${escapeHtml(data.parentName)}</strong>,`) +
          emailParagraph(
            `Permohonan izin santri telah diverifikasi dengan status <strong style="color:${BRAND.greenDeep};">${escapeHtml(data.status)}</strong>.`
          ) +
          emailPanel([
            ['Nama santri', escapeHtml(data.studentName)],
            ['Jenis izin', escapeHtml(data.permitType)],
            ['Periode', `${escapeHtml(data.startDate)} &ndash; ${escapeHtml(data.endDate)}`],
            ...(data.notes
              ? ([['Catatan pengasuh', escapeHtml(data.notes)]] as Array<[string, string]>)
              : []),
          ]) +
          emailSignoff('Bagian Kesantrian Yayasan Pesantren Cipansor'),
      }),
  },

  tahfidzProgress: {
    subject: 'Laporan perkembangan tahfidz',
    html: (data: {
      parentName: string;
      studentName: string;
      surah: string;
      verses: string;
      juz: number;
      grade: string;
      teacherName: string;
      date: string;
    }) =>
      renderEmailLayout({
        title: 'Laporan perkembangan tahfidz',
        preheader: `${data.studentName} menyetorkan ${data.surah} (${data.verses}) dengan nilai ${data.grade}.`,
        bodyHtml:
          emailHeading('Laporan perkembangan tahfidz') +
          emailParagraph(`Yth. Bapak/Ibu <strong>${escapeHtml(data.parentName)}</strong>,`) +
          emailParagraph('Berikut catatan setoran hafalan Al-Qur&rsquo;an putra/putri Bapak/Ibu.') +
          emailPanel([
            ['Nama santri', escapeHtml(data.studentName)],
            ['Surah / ayat', `${escapeHtml(data.surah)} (${escapeHtml(data.verses)})`],
            ['Juz', `Juz ${data.juz}`],
            [
              'Nilai kelancaran',
              `<span style="color:${BRAND.greenDeep};">${escapeHtml(data.grade)}</span>`,
            ],
            ['Pengampu', escapeHtml(data.teacherName)],
            ['Tanggal setoran', escapeHtml(data.date)],
          ]) +
          emailParagraph('Semoga ananda istiqamah dan senantiasa diberkahi Al-Qur&rsquo;an.') +
          emailSignoff('Lembaga Tahfidz Qur&rsquo;an Cipansor'),
      }),
  },

  announcement: {
    subject: '[Pengumuman] {title}',
    html: (data: { title: string; content: string; priority: string }) =>
      renderEmailLayout({
        title: data.title,
        preheader: data.content.replace(/\s+/g, ' ').slice(0, 140),
        bodyHtml:
          (data.priority === 'HIGH'
            ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px 0;"><tr><td style="background-color:${BRAND.red};padding:6px 12px;border-radius:4px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.8px;color:#ffffff;">PENGUMUMAN PENTING</td></tr></table>`
            : '') +
          emailHeading(data.title) +
          // The white-space: pre-line below is load-bearing, not decoration.
          // Announcement bodies are typed into a textarea, so they are plain
          // text carrying real newlines; escaped and dropped into ordinary HTML
          // they collapse, and a pengumuman written in four paragraphs arrives
          // as one block.
          `<div style="margin:0 0 14px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.65;color:${BRAND.ink};white-space:pre-line;">${escapeHtml(data.content)}</div>` +
          emailSignoff('Pengurus Yayasan Pesantren Cipansor'),
      }),
  },
};

// SMS templates
const smsTemplates = {
  paymentReminder: (data: { studentName: string; amount: string; dueDate: string }) =>
    `[Cipansor] Pengingat: Tagihan ${data.studentName} sebesar ${data.amount} jatuh tempo ${data.dueDate}. Info: portal.cipansor.or.id`,

  violationNotification: (data: { studentName: string; type: string }) =>
    `[Cipansor] Pemberitahuan: ${data.studentName} melakukan pelanggaran (${data.type}). Cek portal untuk detail.`,

  attendanceAlert: (data: { studentName: string; status: string }) =>
    `[Cipansor] ${data.studentName} tercatat ${data.status} hari ini.`,

  permitStatusUpdate: (data: { studentName: string; status: string }) =>
    `[Cipansor] Izin ${data.studentName} telah ${data.status}. Cek portal untuk detail.`,

  otp: (data: { code: string }) =>
    `[Cipansor] Kode OTP Anda: ${data.code}. Jangan bagikan kode ini.`,
};

export type NotificationChannel = 'EMAIL' | 'SMS' | 'WHATSAPP' | 'PUSH' | 'IN_APP';
export type ServiceNotificationType =
  | 'WELCOME'
  | 'PASSWORD_RESET'
  | 'PAYMENT_REMINDER'
  | 'VIOLATION'
  | 'ATTENDANCE'
  | 'PERMIT_STATUS'
  | 'ANNOUNCEMENT'
  | 'GENERAL';

// Prisma NotificationType enum values
type PrismaNotificationType =
  'INFO' | 'ANNOUNCEMENT' | 'REMINDER' | 'ALERT' | 'PAYMENT' | 'ACADEMIC';

interface SendNotificationOptions {
  userId?: string;
  recipientEmail?: string;
  recipientPhone?: string;
  channel: NotificationChannel;
  type: ServiceNotificationType;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  templateKey?: keyof typeof templates;
  templateData?: Record<string, unknown>;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH';
}

interface NotificationResult {
  success: boolean;
  channel: NotificationChannel;
  messageId?: string;
  error?: string;
  /** EMAIL only: which transport handled it (`gmail_api`, `smtp` or `log`). */
  transport?: EmailTransportKind;
  /**
   * EMAIL only: whether the message actually left the building.
   *
   * `success: true, delivered: false` is the log-only transport — the call
   * worked, nothing was sent. Callers that need certainty must check this and
   * not `success` alone.
   */
  delivered?: boolean;
}

class NotificationService {
  /**
   * Reset the cached mail transport (useful for runtime/config updates).
   *
   * The transport itself now lives in `email-transport.ts`; this stays as the
   * entry point callers already know about.
   */
  resetTransporter(): void {
    resetEmailTransport();
  }

  /** Which transport is configured, and the identity it sends under. */
  emailTransportStatus() {
    return describeEmailTransport();
  }

  /**
   * Send a notification through specified channel
   */
  async send(options: SendNotificationOptions): Promise<NotificationResult> {
    const { channel, userId, type, title, message } = options;

    try {
      // Record the notification in-app, but only when it belongs to a real
      // account.
      //
      // `Notification.userId` is a required foreign key to `users`. This used
      // to write `userId || ''`, and an empty string is not a user id: Prisma
      // raised a foreign-key error, the catch below swallowed it, and the
      // method returned `success: false` — WITHOUT EVER REACHING THE SWITCH.
      // Any caller addressing a recipient by e-mail alone silently sent
      // nothing. Dispatch no longer depends on the in-app row existing.
      let notificationLogId: string | undefined;

      if (userId) {
        const notificationLog = await prisma.notification.create({
          data: {
            userId,
            type: this.mapNotificationType(type),
            title,
            // An empty body renders as a blank row in the bell menu. Falling
            // back to the title keeps the record readable.
            message: message || title,
            status: 'UNREAD',
          },
        });
        notificationLogId = notificationLog.id;
      }

      let result: NotificationResult;

      switch (channel) {
        case 'EMAIL':
          result = await this.sendEmail(options);
          break;
        case 'SMS':
          result = await this.sendSMS(options);
          break;
        case 'WHATSAPP':
          result = await this.sendWhatsApp(options);
          break;
        case 'IN_APP':
          result = notificationLogId
            ? { success: true, channel, messageId: notificationLogId }
            : { success: false, channel, error: 'In-app notification requires a userId' };
          break;
        default:
          result = { success: false, channel, error: 'Unsupported channel' };
      }

      return result;
    } catch (error) {
      logger.error('Failed to send notification:', error);
      return {
        success: false,
        channel,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Send email notification
   * Currently logs emails - extend with nodemailer/SendGrid/AWS SES as needed
   */
  private async sendEmail(options: SendNotificationOptions): Promise<NotificationResult> {
    const { recipientEmail, title, templateKey, templateData } = options;

    if (!recipientEmail) {
      return { success: false, channel: 'EMAIL', error: 'Recipient email required' };
    }

    let subject = title;
    // A notification's message is plain text somebody typed — a rejection
    // reason, a reminder. As the body of an e-mail it becomes HTML, so it is
    // escaped: unescaped, a `<a href>` in a reason arrived as a live link in a
    // wali's inbox. The templates below escape their own fields.
    let htmlContent = escapeHtml(options.message).replace(/\n/g, '<br>');

    // Build email content from template
    if (templateKey && templateData && templates[templateKey]) {
      const template = templates[templateKey];
      subject = template.subject.replace('{title}', (templateData.title as string) || title);

      // Type-safe template rendering based on key
      switch (templateKey) {
        case 'welcome':
          htmlContent = templates.welcome.html(
            templateData as Parameters<typeof templates.welcome.html>[0]
          );
          break;
        case 'passwordReset':
          htmlContent = templates.passwordReset.html(
            templateData as Parameters<typeof templates.passwordReset.html>[0]
          );
          break;
        case 'paymentReminder':
          htmlContent = templates.paymentReminder.html(
            templateData as Parameters<typeof templates.paymentReminder.html>[0]
          );
          break;
        case 'violationNotification':
          htmlContent = templates.violationNotification.html(
            templateData as Parameters<typeof templates.violationNotification.html>[0]
          );
          break;
        case 'attendanceAlert':
          htmlContent = templates.attendanceAlert.html(
            templateData as Parameters<typeof templates.attendanceAlert.html>[0]
          );
          break;
        case 'permitStatusUpdate':
          htmlContent = templates.permitStatusUpdate.html(
            templateData as Parameters<typeof templates.permitStatusUpdate.html>[0]
          );
          break;
        case 'paymentReceipt':
          htmlContent = templates.paymentReceipt.html(
            templateData as Parameters<typeof templates.paymentReceipt.html>[0]
          );
          break;
        case 'tahfidzProgress':
          htmlContent = templates.tahfidzProgress.html(
            templateData as Parameters<typeof templates.tahfidzProgress.html>[0]
          );
          break;
        case 'announcement':
          htmlContent = templates.announcement.html(
            templateData as Parameters<typeof templates.announcement.html>[0]
          );
          break;
      }
    }

    try {
      const result = await deliverEmail({
        to: recipientEmail,
        subject,
        html: htmlContent,
        // The lambang rides along as an inline part. Sent as a hosted URL it
        // would be blocked by default in Outlook and in Gmail's ask-first mode
        // — precisely the readers who most need to see at a glance that this is
        // the yayasan writing to them, not someone impersonating it.
        attachments: [emailLogoAttachment()],
      });

      // `delivered` distinguishes a real send from the log-only transport. The
      // call still counts as successful — nothing went wrong — but the two must
      // never look identical in the logs, because for months they did.
      logger.info(
        result.delivered
          ? `Email sent to ${recipientEmail} via ${result.kind}: ${result.messageId}`
          : `Email NOT sent (transport=${result.kind}) to ${recipientEmail}: ${subject}`
      );

      return {
        success: true,
        channel: 'EMAIL',
        messageId: result.messageId,
        transport: result.kind,
        delivered: result.delivered,
      };
    } catch (error) {
      logger.error(`Failed to send email to ${recipientEmail}:`, error);
      return {
        success: false,
        channel: 'EMAIL',
        delivered: false,
        error: error instanceof Error ? error.message : 'Unknown email error',
      };
    }
  }

  /**
   * Send SMS notification
   * Currently logs SMS - extend with Twilio/AWS SNS/local SMS gateway as needed
   */
  private async sendSMS(options: SendNotificationOptions): Promise<NotificationResult> {
    const { recipientPhone, message } = options;

    if (!recipientPhone) {
      return { success: false, channel: 'SMS', error: 'Recipient phone required' };
    }

    // Log SMS for development/debugging
    // Redact potential sensitive info in message
    const redactedMessage = message.replace(/\b\d{4,8}\b/g, '****');
    logger.info(`[SMS] To: ${recipientPhone}, Message: ${redactedMessage}`);

    // Outbound messages switched off (staging): log only, whatever is configured.
    if (!config.outboundMessages.enabled) {
      logger.info(`SMS not sent (OUTBOUND_MESSAGES_ENABLED=false) to ${recipientPhone}`);
      return { success: true, channel: 'SMS', messageId: `log_${Date.now()}`, delivered: false };
    }

    // Check if Twilio is configured
    const { accountSid, authToken, phoneNumber } = config.twilio;

    if (!accountSid || !authToken || !phoneNumber) {
      logger.warn(
        'SMS not configured - TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, or TWILIO_PHONE_NUMBER not set. SMS logged only.'
      );
      return { success: true, channel: 'SMS', messageId: `log_${Date.now()}`, delivered: false };
    }

    try {
      const client = new Twilio(accountSid, authToken);
      const response = await client.messages.create({
        body: message,
        from: phoneNumber,
        to: recipientPhone,
      });

      logger.info(`SMS sent to ${recipientPhone}, SID: ${response.sid}`);
      return { success: true, channel: 'SMS', messageId: response.sid, delivered: true };
    } catch (error) {
      logger.error('Failed to send SMS via Twilio:', error);
      return {
        success: false,
        channel: 'SMS',
        error: error instanceof Error ? error.message : 'Twilio error',
      };
    }
  }

  /**
   * Route a message to an EXTERNAL channel (email/SMS/WhatsApp) without
   * creating an in-app Notification row — used by notifications.service,
   * which has already persisted the in-app record and now fans out to the
   * external channels listed on it.
   */
  async dispatchExternal(options: SendNotificationOptions): Promise<NotificationResult> {
    switch (options.channel) {
      case 'EMAIL':
        return this.sendEmail(options);
      case 'SMS':
        return this.sendSMS(options);
      case 'WHATSAPP':
        return this.sendWhatsApp(options);
      default:
        return { success: false, channel: options.channel, error: 'Not an external channel' };
    }
  }

  /**
   * Send a WhatsApp message through the module's multi-provider WhatsApp
   * service (whatsapp.service.ts). Default provider is Meta's WhatsApp
   * Business Cloud API — direct, no BSP middleman; configure via
   * WA_PROVIDER / WA_ACCESS_TOKEN / WA_PHONE_NUMBER_ID. The SIMULATOR
   * provider (default when unconfigured) logs instead of sending.
   */
  private async sendWhatsApp(options: SendNotificationOptions): Promise<NotificationResult> {
    const { recipientPhone, message } = options;

    if (!recipientPhone) {
      return { success: false, channel: 'WHATSAPP', error: 'Recipient phone required' };
    }

    const redactedMessage = message.replace(/\b\d{4,8}\b/g, '****');
    logger.info(`[WHATSAPP] To: ${recipientPhone}, Message: ${redactedMessage}`);

    try {
      const result = await whatsAppService.sendMessage({
        to: recipientPhone,
        message,
        type: 'text',
      });
      return {
        success: result.success,
        channel: 'WHATSAPP',
        messageId: result.messageId,
        error: result.error,
        delivered: result.delivered,
      };
    } catch (error) {
      logger.error('Failed to send WhatsApp:', error);
      return {
        success: false,
        channel: 'WHATSAPP',
        error: error instanceof Error ? error.message : 'WhatsApp error',
      };
    }
  }

  /**
   * Send bulk notifications
   */
  async sendBulk(
    recipients: Array<{ userId: string; email?: string; phone?: string }>,
    options: Omit<SendNotificationOptions, 'userId' | 'recipientEmail' | 'recipientPhone'>
  ): Promise<NotificationResult[]> {
    const results: NotificationResult[] = [];

    for (const recipient of recipients) {
      const result = await this.send({
        ...options,
        userId: recipient.userId,
        recipientEmail: recipient.email,
        recipientPhone: recipient.phone,
      });
      results.push(result);
    }

    return results;
  }

  /**
   * Send payment receipt email
   */
  async sendPaymentReceipt(receipt: {
    userId: string;
    recipientEmail: string;
    parentName: string;
    studentName: string;
    receiptNumber: string;
    amount: string;
    paymentDate: string;
    paymentMethod: string;
    description: string;
  }): Promise<NotificationResult> {
    return this.send({
      userId: receipt.userId,
      recipientEmail: receipt.recipientEmail,
      channel: 'EMAIL',
      type: 'PAYMENT_REMINDER',
      title: 'Bukti Pembayaran Resmi - Cipansor',
      message: `Pembayaran ${receipt.amount} untuk ${receipt.studentName} telah diterima (${receipt.receiptNumber}).`,
      templateKey: 'paymentReceipt',
      templateData: receipt,
      priority: 'HIGH',
    });
  }

  /**
   * Send tahfidz progress update
   */
  async sendTahfidzProgress(progress: {
    userId: string;
    recipientEmail: string;
    parentName: string;
    studentName: string;
    surah: string;
    verses: string;
    juz: number;
    grade: string;
    teacherName: string;
    date: string;
  }): Promise<NotificationResult> {
    return this.send({
      userId: progress.userId,
      recipientEmail: progress.recipientEmail,
      channel: 'EMAIL',
      type: 'ATTENDANCE',
      title: 'Laporan Perkembangan Tahfidz Santri - Cipansor',
      message: `Setoran ${progress.studentName}: ${progress.surah} ayat ${progress.verses} — nilai ${progress.grade}.`,
      templateKey: 'tahfidzProgress',
      templateData: progress,
      priority: 'MEDIUM',
    });
  }

  /*
   * `sendEOfficeLetter` and its `eofficeLetter` template were removed here.
   *
   * They had no caller anywhere in the API — only a unit test that invoked the
   * helper directly — so nothing ever sent an e-office letter by e-mail, and a
   * template that is never rendered by the product cannot be kept honest by a
   * test that renders it. E-office correspondence is the subject of its own
   * change (#414); the mail for it belongs there, wired to a real event, rather
   * than sitting here looking finished.
   */

  /**
   * Send payment reminder to parents
   */
  async sendPaymentReminder(invoice: {
    id: string;
    invoiceNumber: string;
    amount: number;
    dueDate: Date;
    student: {
      id: string;
      name: string;
      parents: Array<{
        parent: { id: string; name: string; email: string; phone?: string };
        isPrimary: boolean;
      }>;
    };
  }): Promise<NotificationResult[]> {
    const results: NotificationResult[] = [];

    for (const sp of invoice.student.parents) {
      if (!sp.parent.email) continue;

      const emailResult = await this.send({
        userId: sp.parent.id,
        recipientEmail: sp.parent.email,
        channel: 'EMAIL',
        type: 'PAYMENT_REMINDER',
        title: 'Pengingat Pembayaran',
        message: `Tagihan ${invoice.invoiceNumber} untuk ${invoice.student.name} jatuh tempo ${invoice.dueDate.toLocaleDateString('id-ID')}.`,
        templateKey: 'paymentReminder',
        templateData: {
          parentName: sp.parent.name,
          studentName: invoice.student.name,
          invoiceNumber: invoice.invoiceNumber,
          amount: new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(
            invoice.amount
          ),
          dueDate: invoice.dueDate.toLocaleDateString('id-ID', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          }),
        },
        priority: 'HIGH',
      });
      results.push(emailResult);

      if (sp.isPrimary && sp.parent.phone) {
        const smsResult = await this.send({
          userId: sp.parent.id,
          recipientPhone: sp.parent.phone,
          channel: 'SMS',
          type: 'PAYMENT_REMINDER',
          title: 'Pengingat Pembayaran',
          message: smsTemplates.paymentReminder({
            studentName: invoice.student.name,
            amount: new Intl.NumberFormat('id-ID', {
              style: 'currency',
              currency: 'IDR',
              minimumFractionDigits: 0,
            }).format(invoice.amount),
            dueDate: invoice.dueDate.toLocaleDateString('id-ID'),
          }),
        });
        results.push(smsResult);
      }
    }

    return results;
  }

  /**
   * Send violation notification to parents
   */
  async sendViolationNotification(violation: {
    id: string;
    type: string;
    description: string;
    points: number;
    occurredAt: Date;
    student: {
      id: string;
      name: string;
      parents: Array<{
        parent: { id: string; name: string; email: string; phone?: string };
        isPrimary: boolean;
      }>;
    };
  }): Promise<NotificationResult[]> {
    const results: NotificationResult[] = [];

    for (const sp of violation.student.parents) {
      if (!sp.parent.email) continue;

      const emailResult = await this.send({
        userId: sp.parent.id,
        recipientEmail: sp.parent.email,
        channel: 'EMAIL',
        type: 'VIOLATION',
        title: 'Pemberitahuan Pelanggaran',
        message: `${violation.student.name}: ${violation.type} (${violation.points} poin).`,
        templateKey: 'violationNotification',
        templateData: {
          parentName: sp.parent.name,
          studentName: violation.student.name,
          violationType: violation.type,
          description: violation.description,
          points: violation.points,
          date: violation.occurredAt.toLocaleDateString('id-ID'),
        },
        priority: 'HIGH',
      });
      results.push(emailResult);
    }

    return results;
  }

  /**
   * Send attendance alert
   */
  async sendAttendanceAlert(attendance: {
    studentId: string;
    studentName: string;
    status: string;
    date: Date;
    notes?: string;
    parents: Array<{
      parent: { id: string; name: string; email: string; phone?: string };
      isPrimary: boolean;
    }>;
  }): Promise<NotificationResult[]> {
    const results: NotificationResult[] = [];

    const statusLabels: Record<string, string> = {
      ABSENT: 'Tidak Hadir (Alpha)',
      SICK: 'Sakit',
      PERMITTED: 'Izin',
      LATE: 'Terlambat',
    };
    const statusLabel = statusLabels[attendance.status] || attendance.status;

    for (const sp of attendance.parents) {
      if (attendance.status === 'PRESENT' || !sp.isPrimary) continue;

      if (sp.parent.email) {
        const emailResult = await this.send({
          userId: sp.parent.id,
          recipientEmail: sp.parent.email,
          channel: 'EMAIL',
          type: 'ATTENDANCE',
          title: 'Pemberitahuan Kehadiran',
          message: `${attendance.studentName} tercatat ${statusLabel} pada ${attendance.date.toLocaleDateString('id-ID')}.`,
          templateKey: 'attendanceAlert',
          templateData: {
            parentName: sp.parent.name,
            studentName: attendance.studentName,
            status: statusLabel,
            date: attendance.date.toLocaleDateString('id-ID'),
            notes: attendance.notes,
          },
        });
        results.push(emailResult);
      }

      if (sp.parent.phone) {
        const smsResult = await this.send({
          userId: sp.parent.id,
          recipientPhone: sp.parent.phone,
          channel: 'SMS',
          type: 'ATTENDANCE',
          title: 'Pemberitahuan Kehadiran',
          message: smsTemplates.attendanceAlert({
            studentName: attendance.studentName,
            status: statusLabel,
          }),
        });
        results.push(smsResult);
      }
    }

    return results;
  }

  /**
   * Map notification type to Prisma enum
   */
  private mapNotificationType(type: ServiceNotificationType): PrismaNotificationType {
    switch (type) {
      case 'PAYMENT_REMINDER':
        return 'PAYMENT';
      case 'ATTENDANCE':
      case 'VIOLATION':
        return 'ACADEMIC';
      case 'ANNOUNCEMENT':
        return 'ANNOUNCEMENT';
      case 'PASSWORD_RESET':
      case 'PERMIT_STATUS':
        return 'ALERT';
      case 'WELCOME':
      case 'GENERAL':
      default:
        return 'INFO';
    }
  }
}

export const notificationService = new NotificationService();
export { templates, smsTemplates };
