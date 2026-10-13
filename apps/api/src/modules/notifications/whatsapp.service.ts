/**
 * WhatsApp Notification Service
 *
 * Integrasi WhatsApp Business API untuk notifikasi:
 * - Official WhatsApp Cloud API (Meta)
 * - Fonnte (Provider Indonesia)
 * - WATroop (Alternative)
 * - Whacenter (Alternative)
 *
 * Fitur:
 * - Send template messages
 * - Send text messages
 * - Send media messages
 * - Bulk messaging
 * - Message status tracking
 */

import { config as appConfig } from '../../config';
import { logger } from '../../lib/logger';

// WhatsApp provider types
type WhatsAppProvider = 'META' | 'FONNTE' | 'WATROOP' | 'WHACENTER' | 'SIMULATOR';

/**
 * The provider this process sends through.
 *
 * `WA_PROVIDER` picks it; unset means the simulator. With outbound messages
 * switched off (staging) it is the simulator regardless, so a staging copy that
 * inherits a real provider key still reaches no wali's phone.
 */
export function resolveWhatsAppProvider(
  envProvider: string | undefined,
  outboundEnabled: boolean
): WhatsAppProvider {
  if (!outboundEnabled) return 'SIMULATOR';
  return (envProvider as WhatsAppProvider) || 'SIMULATOR';
}

interface WhatsAppConfig {
  provider: WhatsAppProvider;
  apiKey?: string;
  phoneNumberId?: string;
  accessToken?: string;
  baseUrl?: string;
}

interface SendMessageOptions {
  to: string;
  message: string;
  type: 'text' | 'template' | 'image' | 'document';
  templateName?: string;
  templateParams?: string[];
  mediaUrl?: string;
  fileName?: string;
}

interface SendResult {
  success: boolean;
  messageId?: string;
  provider: WhatsAppProvider;
  error?: string;
  timestamp: Date;
  /**
   * Whether the message actually left the building. `success: true` with
   * `delivered: false` is the simulator (no phone was messaged) — the call
   * worked, nothing was sent. Callers that record delivery state must check
   * this, not `success` alone, or a log-only run is mistaken for a real one.
   */
  delivered?: boolean;
}

// WhatsApp message templates for Indonesian education context
export const WA_TEMPLATES = {
  // Pengingat pembayaran
  paymentReminder: {
    name: 'payment_reminder',
    text: (data: { parentName: string; studentName: string; amount: string; dueDate: string }) =>
      `Assalamu'alaikum Bapak/Ibu *${data.parentName}*,

Ini adalah pengingat pembayaran untuk:
📚 *Nama Santri:* ${data.studentName}
💰 *Jumlah:* ${data.amount}
📅 *Jatuh Tempo:* ${data.dueDate}

Mohon segera melakukan pembayaran melalui:
- Transfer Bank
- Pembayaran di Tata Usaha

Jazakallahu khairan.

_Pesan otomatis dari Sistem Informasi Pesantren Cipansor_`,
  },

  // Tagihan overdue
  paymentOverdue: {
    name: 'payment_overdue',
    text: (data: { parentName: string; studentName: string; amount: string; overdueDay: number }) =>
      `Assalamu'alaikum Bapak/Ibu *${data.parentName}*,

⚠️ *PEMBERITAHUAN PENTING*

Tagihan untuk *${data.studentName}* sudah melewati jatuh tempo selama *${data.overdueDay} hari*.

💰 *Tunggakan:* ${data.amount}

Mohon segera melakukan pembayaran untuk menghindari denda keterlambatan.

Hubungi TU untuk informasi lebih lanjut.

_Pesan otomatis dari Sistem Informasi Pesantren Cipansor_`,
  },

  // Notifikasi pelanggaran
  violationAlert: {
    name: 'violation_alert',
    text: (data: {
      parentName: string;
      studentName: string;
      type: string;
      description: string;
      date: string;
    }) =>
      `Assalamu'alaikum Bapak/Ibu *${data.parentName}*,

📋 *LAPORAN PELANGGARAN*

Dengan hormat kami sampaikan bahwa:
👤 *Nama:* ${data.studentName}
📅 *Tanggal:* ${data.date}
⚠️ *Jenis:* ${data.type}
📝 *Keterangan:* ${data.description}

Mohon kerja sama Bapak/Ibu untuk memberikan pembinaan kepada putra/putri.

Jazakallahu khairan atas perhatiannya.

_Tim Pembinaan Pesantren Cipansor_`,
  },

  // Notifikasi kehadiran alpha
  absenceAlert: {
    name: 'absence_alert',
    text: (data: { parentName: string; studentName: string; date: string }) =>
      `Assalamu'alaikum Bapak/Ibu *${data.parentName}*,

📅 *Hari ini (${data.date})*

Kami informasikan bahwa *${data.studentName}* tidak hadir tanpa keterangan (Alpha).

Mohon konfirmasi kondisi putra/putri Bapak/Ibu atau hubungi pihak pesantren.

_Pesan otomatis dari Sistem Informasi Pesantren Cipansor_`,
  },

  // Update status izin
  permitStatus: {
    name: 'permit_status',
    text: (data: {
      parentName: string;
      studentName: string;
      permitType: string;
      status: string;
      startDate: string;
      endDate: string;
    }) =>
      `Assalamu'alaikum Bapak/Ibu *${data.parentName}*,

📋 *UPDATE STATUS IZIN*

Pengajuan izin:
👤 *Santri:* ${data.studentName}
📝 *Jenis:* ${data.permitType}
📅 *Tanggal:* ${data.startDate} - ${data.endDate}
✅ *Status:* *${data.status}*

${data.status === 'APPROVED' ? 'Silakan ikuti prosedur izin sesuai ketentuan.' : ''}
${data.status === 'REJECTED' ? 'Silakan hubungi TU untuk informasi lebih lanjut.' : ''}

_Pesan otomatis dari Sistem Informasi Pesantren Cipansor_`,
  },

  // Progress tahfidz
  tahfidzProgress: {
    name: 'tahfidz_progress',
    text: (data: {
      parentName: string;
      studentName: string;
      surah: string;
      ayahStart: number;
      ayahEnd: number;
      juz: number;
      score?: string;
    }) =>
      `Assalamu'alaikum Bapak/Ibu *${data.parentName}*,

🕌 *LAPORAN TAHFIDZ*

Alhamdulillah, kami sampaikan progress hafalan:

👤 *Santri:* ${data.studentName}
📖 *Surah:* ${data.surah}
📜 *Ayat:* ${data.ayahStart} - ${data.ayahEnd}
📚 *Juz:* ${data.juz}
${data.score ? `⭐ *Nilai:* ${data.score}` : ''}

Barakallahu fiikum, semoga putra/putri Bapak/Ibu istiqomah dalam menghafal Al-Qur'an.

_Tim Tahfidz Pesantren Cipansor_`,
  },

  // Raport terbit
  reportCardPublished: {
    name: 'report_card_published',
    text: (data: {
      parentName: string;
      studentName: string;
      semester: string;
      academicYear: string;
    }) =>
      `Assalamu'alaikum Bapak/Ibu *${data.parentName}*,

📊 *PENGUMUMAN RAPORT*

Raport semester *${data.semester}* tahun ajaran *${data.academicYear}* untuk *${data.studentName}* telah diterbitkan.

Silakan akses melalui Portal Orang Tua atau mengambil di TU.

Barakallahu fiikum.

_Pesan otomatis dari Sistem Informasi Pesantren Cipansor_`,
  },

  // Pengumuman umum
  announcement: {
    name: 'announcement',
    text: (data: { title: string; content: string; priority: string }) =>
      `🔔 *${data.priority === 'HIGH' ? '⚠️ PENTING - ' : ''}PENGUMUMAN*

*${data.title}*

${data.content}

_Pesantren Cipansor_`,
  },

  // Jadwal kegiatan
  eventReminder: {
    name: 'event_reminder',
    text: (data: {
      parentName: string;
      eventName: string;
      date: string;
      time: string;
      location: string;
    }) =>
      `Assalamu'alaikum Bapak/Ibu *${data.parentName}*,

📅 *PENGINGAT KEGIATAN*

Mengingatkan akan diadakan:
📌 *Kegiatan:* ${data.eventName}
📅 *Tanggal:* ${data.date}
🕐 *Waktu:* ${data.time}
📍 *Tempat:* ${data.location}

Mohon kehadiran Bapak/Ibu.

_Pesantren Cipansor_`,
  },

  // Konfirmasi registrasi PSB
  psbRegistration: {
    name: 'psb_registration',
    text: (data: {
      parentName: string;
      studentName: string;
      registrationNo: string;
      testDate?: string;
    }) =>
      `Assalamu'alaikum Bapak/Ibu *${data.parentName}*,

✅ *KONFIRMASI PENDAFTARAN*

Pendaftaran calon santri:
👤 *Nama:* ${data.studentName}
📋 *No. Pendaftaran:* ${data.registrationNo}
${data.testDate ? `📅 *Jadwal Tes:* ${data.testDate}` : ''}

Mohon simpan nomor pendaftaran ini.
Dokumen dapat diunggah melalui portal PSB.

Jazakallahu khairan.

_Panitia PSB Pesantren Cipansor_`,
  },

  // Laporan harian PAUD/TK
  dailyReport: {
    name: 'daily_report',
    text: (data: {
      parentName: string;
      studentName: string;
      date: string;
      mood?: string | null;
      healthStatus?: string | null;
    }) =>
      `Assalamu'alaikum Bapak/Ibu *${data.parentName}*,

📝 *LAPORAN HARIAN*

Alhamdulillah, berikut adalah ringkasan kegiatan *${data.studentName}* hari ini (${data.date}):

${data.mood ? `😊 *Mood:* ${data.mood}` : ''}
${data.healthStatus ? `🤒 *Kondisi:* ${data.healthStatus}` : ''}

Laporan lengkap dapat dilihat melalui aplikasi atau Portal Orang Tua.

Terima kasih atas kepercayaannya.

_Pesan otomatis dari Sistem Informasi Pesantren Cipansor_`,
  },

  // OTP verification
  otpVerification: {
    name: 'otp_verification',
    text: (data: { code: string; expiry: string }) =>
      `🔐 *KODE VERIFIKASI*

Kode OTP Anda: *${data.code}*

Berlaku hingga: ${data.expiry}

⚠️ Jangan bagikan kode ini kepada siapapun.

_Sistem Informasi Pesantren Cipansor_`,
  },
};

class WhatsAppService {
  private config: WhatsAppConfig;

  constructor() {
    // Load configuration from environment
    this.config = {
      provider: resolveWhatsAppProvider(
        process.env.WA_PROVIDER,
        appConfig.outboundMessages.enabled
      ),
      apiKey: process.env.WA_API_KEY,
      phoneNumberId: process.env.WA_PHONE_NUMBER_ID,
      accessToken: process.env.WA_ACCESS_TOKEN,
      baseUrl: process.env.WA_BASE_URL,
    };
  }

  /**
   * Send WhatsApp message
   */
  async sendMessage(options: SendMessageOptions): Promise<SendResult> {
    const { to, message, type } = options;
    const phoneNumber = this.formatPhoneNumber(to);

    if (!phoneNumber) {
      return {
        success: false,
        error: 'Invalid phone number format',
        provider: this.config.provider,
        timestamp: new Date(),
      };
    }

    try {
      let result: SendResult;

      switch (this.config.provider) {
        case 'META':
          result = await this.sendViaMeta(phoneNumber, options);
          break;
        case 'FONNTE':
          result = await this.sendViaFonnte(phoneNumber, options);
          break;
        case 'WATROOP':
          result = await this.sendViaWatroop(phoneNumber, options);
          break;
        case 'WHACENTER':
          result = await this.sendViaWhacenter(phoneNumber, options);
          break;
        case 'SIMULATOR':
        default:
          result = await this.sendViaSimulator(phoneNumber, options);
          break;
      }

      // Log message
      await this.logMessage(phoneNumber, message, type, result);

      // The simulator reports success without touching a phone; a real
      // provider's `success` means the message actually left. Surface that so a
      // caller recording delivery state does not mistake a log-only run for a
      // delivered one.
      return { ...result, delivered: result.success && this.config.provider !== 'SIMULATOR' };
    } catch (error) {
      logger.error(`WhatsApp send error: ${error}`);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        provider: this.config.provider,
        timestamp: new Date(),
      };
    }
  }

  /**
   * Send bulk messages
   * Uses pipelining to respect rate limits (delay) without being blocked by network latency.
   * Requests are initiated sequentially with the specified delay, but awaited concurrently.
   */
  async sendBulk(
    recipients: Array<{ phone: string; userId?: string }>,
    message: string,
    delay: number = 1000, // Delay between messages to avoid rate limiting
    concurrency: number = 5
  ): Promise<{ success: number; failed: number; results: SendResult[] }> {
    const results: SendResult[] = new Array(recipients.length);
    let success = 0;
    let failed = 0;

    let currentIndex = 0;

    const worker = async () => {
      while (currentIndex < recipients.length) {
        const index = currentIndex++;
        const recipient = recipients[index];

        const result = await this.sendMessage({
          to: recipient.phone,
          message,
          type: 'text',
        });

        results[index] = result;
        if (result.success) success++;
        else failed++;

        // Add delay between messages
        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    };

    const workers = Array(Math.min(concurrency, recipients.length))
      .fill(null)
      .map(() => worker());

    await Promise.all(workers);

    return { success, failed, results };
  }

  /**
   * Send payment reminder
   */
  async sendPaymentReminder(data: {
    parentPhone: string;
    parentName: string;
    studentName: string;
    amount: number;
    dueDate: Date;
  }): Promise<SendResult> {
    const message = WA_TEMPLATES.paymentReminder.text({
      parentName: data.parentName,
      studentName: data.studentName,
      amount: new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0,
      }).format(data.amount),
      dueDate: data.dueDate.toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),
    });

    return this.sendMessage({
      to: data.parentPhone,
      message,
      type: 'text',
    });
  }

  /**
   * Send violation alert
   */
  async sendViolationAlert(data: {
    parentPhone: string;
    parentName: string;
    studentName: string;
    type: string;
    description: string;
    date: Date;
  }): Promise<SendResult> {
    const message = WA_TEMPLATES.violationAlert.text({
      parentName: data.parentName,
      studentName: data.studentName,
      type: data.type,
      description: data.description,
      date: data.date.toLocaleDateString('id-ID'),
    });

    return this.sendMessage({
      to: data.parentPhone,
      message,
      type: 'text',
    });
  }

  /**
   * Send absence alert
   */
  async sendAbsenceAlert(data: {
    parentPhone: string;
    parentName: string;
    studentName: string;
    date: Date;
  }): Promise<SendResult> {
    const message = WA_TEMPLATES.absenceAlert.text({
      parentName: data.parentName,
      studentName: data.studentName,
      date: data.date.toLocaleDateString('id-ID'),
    });

    return this.sendMessage({
      to: data.parentPhone,
      message,
      type: 'text',
    });
  }

  /**
   * Send tahfidz progress
   */
  async sendTahfidzProgress(data: {
    parentPhone: string;
    parentName: string;
    studentName: string;
    surah: string;
    ayahStart: number;
    ayahEnd: number;
    juz: number;
    score?: string;
  }): Promise<SendResult> {
    const message = WA_TEMPLATES.tahfidzProgress.text({
      parentName: data.parentName,
      studentName: data.studentName,
      surah: data.surah,
      ayahStart: data.ayahStart,
      ayahEnd: data.ayahEnd,
      juz: data.juz,
      score: data.score,
    });

    return this.sendMessage({
      to: data.parentPhone,
      message,
      type: 'text',
    });
  }

  /**
   * Send permit status update
   */
  async sendPermitStatusUpdate(data: {
    parentPhone: string;
    parentName: string;
    studentName: string;
    permitType: string;
    status: string;
    startDate: Date;
    endDate: Date;
  }): Promise<SendResult> {
    const message = WA_TEMPLATES.permitStatus.text({
      parentName: data.parentName,
      studentName: data.studentName,
      permitType: data.permitType,
      status: data.status,
      startDate: data.startDate.toLocaleDateString('id-ID'),
      endDate: data.endDate.toLocaleDateString('id-ID'),
    });

    return this.sendMessage({
      to: data.parentPhone,
      message,
      type: 'text',
    });
  }

  /**
   * Send announcement
   */
  async sendAnnouncement(data: {
    recipientPhone: string;
    title: string;
    content: string;
    priority: string;
  }): Promise<SendResult> {
    const message = WA_TEMPLATES.announcement.text({
      title: data.title,
      content: data.content,
      priority: data.priority,
    });

    return this.sendMessage({
      to: data.recipientPhone,
      message,
      type: 'text',
    });
  }

  /**
   * Send OTP
   */
  async sendOTP(phone: string, code: string, expiryMinutes: number = 5): Promise<SendResult> {
    const expiry = new Date();
    expiry.setMinutes(expiry.getMinutes() + expiryMinutes);

    const message = WA_TEMPLATES.otpVerification.text({
      code,
      expiry: expiry.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
    });

    return this.sendMessage({
      to: phone,
      message,
      type: 'text',
    });
  }

  /**
   * Send daily report notification
   */
  async sendDailyReportNotification(data: {
    parentPhone: string;
    parentName: string;
    studentName: string;
    date: Date;
    mood?: string | null;
    healthStatus?: string | null;
  }): Promise<SendResult> {
    const moodMap: Record<string, string> = {
      HAPPY: 'Senang 😊',
      NEUTRAL: 'Biasa 😐',
      SAD: 'Sedih 😢',
      TIRED: 'Lelah 😴',
      EXCITED: 'Antusias 🤩',
      SICK: 'Sakit 🤒',
    };

    const message = WA_TEMPLATES.dailyReport.text({
      parentName: data.parentName,
      studentName: data.studentName,
      date: data.date.toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),
      mood: data.mood ? moodMap[data.mood as string] || data.mood : undefined,
      healthStatus: data.healthStatus,
    });

    return this.sendMessage({
      to: data.parentPhone,
      message,
      type: 'text',
    });
  }

  // ==================== Provider Implementations ====================

  /**
   * Send via Meta WhatsApp Business API
   */
  private async sendViaMeta(phone: string, options: SendMessageOptions): Promise<SendResult> {
    const { message, type, templateName, templateParams } = options;

    if (!this.config.phoneNumberId || !this.config.accessToken) {
      return {
        success: false,
        error: 'Meta WhatsApp API not configured',
        provider: 'META',
        timestamp: new Date(),
      };
    }

    try {
      const url = `https://graph.facebook.com/v17.0/${this.config.phoneNumberId}/messages`;

      const body: Record<string, unknown> = {
        messaging_product: 'whatsapp',
        to: phone,
      };

      if (type === 'template' && templateName) {
        body.type = 'template';
        body.template = {
          name: templateName,
          language: { code: 'id' },
          components: templateParams?.length
            ? [
                {
                  type: 'body',
                  parameters: templateParams.map((p) => ({ type: 'text', text: p })),
                },
              ]
            : undefined,
        };
      } else {
        body.type = 'text';
        body.text = { body: message };
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const data = (await response.json()) as { messages?: Array<{ id: string }> };

      if (response.ok && data.messages?.[0]?.id) {
        return {
          success: true,
          messageId: data.messages[0].id,
          provider: 'META',
          timestamp: new Date(),
        };
      }

      return {
        success: false,
        error: JSON.stringify(data),
        provider: 'META',
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        provider: 'META',
        timestamp: new Date(),
      };
    }
  }

  /**
   * Send via Fonnte (Indonesian Provider)
   */
  private async sendViaFonnte(phone: string, options: SendMessageOptions): Promise<SendResult> {
    const { message, type, mediaUrl } = options;

    if (!this.config.apiKey) {
      return {
        success: false,
        error: 'Fonnte API key not configured',
        provider: 'FONNTE',
        timestamp: new Date(),
      };
    }

    try {
      const formData = new FormData();
      formData.append('target', phone);
      formData.append('message', message);

      if (type === 'image' && mediaUrl) {
        formData.append('url', mediaUrl);
      }

      const response = await fetch('https://api.fonnte.com/send', {
        method: 'POST',
        headers: {
          Authorization: this.config.apiKey,
        },
        body: formData,
      });

      const data = (await response.json()) as { status: boolean; id?: string };

      if (data.status) {
        return {
          success: true,
          messageId: data.id,
          provider: 'FONNTE',
          timestamp: new Date(),
        };
      }

      return {
        success: false,
        error: JSON.stringify(data),
        provider: 'FONNTE',
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        provider: 'FONNTE',
        timestamp: new Date(),
      };
    }
  }

  /**
   * Send via WATroop
   */
  private async sendViaWatroop(phone: string, options: SendMessageOptions): Promise<SendResult> {
    const { message } = options;

    if (!this.config.apiKey || !this.config.baseUrl) {
      return {
        success: false,
        error: 'WATroop not configured',
        provider: 'WATROOP',
        timestamp: new Date(),
      };
    }

    try {
      const response = await fetch(`${this.config.baseUrl}/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Api-Key': this.config.apiKey,
        },
        body: JSON.stringify({
          phone,
          message,
        }),
      });

      const data = (await response.json()) as { success: boolean; messageId?: string };

      return {
        success: data.success,
        messageId: data.messageId,
        provider: 'WATROOP',
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        provider: 'WATROOP',
        timestamp: new Date(),
      };
    }
  }

  /**
   * Send via Whacenter
   */
  private async sendViaWhacenter(phone: string, options: SendMessageOptions): Promise<SendResult> {
    const { message } = options;

    if (!this.config.apiKey) {
      return {
        success: false,
        error: 'Whacenter API key not configured',
        provider: 'WHACENTER',
        timestamp: new Date(),
      };
    }

    try {
      const response = await fetch('https://app.whacenter.com/api/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          device_id: this.config.apiKey,
          number: phone,
          message,
        }),
      });

      const data = (await response.json()) as { status: boolean; message_id?: string };

      return {
        success: data.status,
        messageId: data.message_id,
        provider: 'WHACENTER',
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        provider: 'WHACENTER',
        timestamp: new Date(),
      };
    }
  }

  /**
   * Simulator for development/testing
   */
  private async sendViaSimulator(phone: string, options: SendMessageOptions): Promise<SendResult> {
    const { message, type } = options;

    // Log the message for development
    logger.info(`[WhatsApp Simulator] To: ${phone}`);
    logger.info(`[WhatsApp Simulator] Type: ${type}`);
    logger.info(`[WhatsApp Simulator] Message:\n${message}`);

    // Simulate delay
    await new Promise((resolve) => setTimeout(resolve, 500));

    return {
      success: true,
      messageId: `sim_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      provider: 'SIMULATOR',
      timestamp: new Date(),
    };
  }

  // ==================== Utility Methods ====================

  /**
   * Format phone number to international format
   */
  private formatPhoneNumber(phone: string): string | null {
    // Remove all non-digits
    let cleaned = phone.replace(/\D/g, '');

    // Handle Indonesian numbers
    if (cleaned.startsWith('0')) {
      cleaned = '62' + cleaned.substring(1);
    } else if (!cleaned.startsWith('62') && cleaned.length === 10) {
      // Assume Indonesian if 10 digits (without country code)
      cleaned = '62' + cleaned;
    }

    // Validate length (Indonesian mobile: 11-13 digits with country code)
    if (cleaned.length < 10 || cleaned.length > 15) {
      return null;
    }

    return cleaned;
  }

  /**
   * Log message to database
   */
  private async logMessage(
    phone: string,
    message: string,
    type: string,
    result: SendResult
  ): Promise<void> {
    try {
      // Log to audit or dedicated WhatsApp log table
      // For now, just use logger
      logger.info({
        event: 'whatsapp_message',
        phone,
        type,
        provider: result.provider,
        success: result.success,
        messageId: result.messageId,
        error: result.error,
      });
    } catch (error) {
      logger.error('Failed to log WhatsApp message:', error);
    }
  }

  /**
   * Get provider status
   */
  async getProviderStatus(): Promise<{
    provider: WhatsAppProvider;
    configured: boolean;
    testResult?: SendResult;
  }> {
    const configured = Boolean(
      this.config.provider === 'SIMULATOR' || this.config.apiKey || this.config.accessToken
    );

    return {
      provider: this.config.provider,
      configured,
    };
  }
}

export const whatsAppService = new WhatsAppService();
export default WhatsAppService;
