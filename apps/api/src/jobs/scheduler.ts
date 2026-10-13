import cron, { ScheduledTask } from 'node-cron';
import { logger } from '@/lib/logger';
import {
  createDailySnapshots,
  createWeeklySummary,
  cleanupOldSnapshots,
} from './dashboard-snapshot.job';
import { aggregateDashboardMetrics } from './dashboard-metrics.job';
import { runMonthlyAutoBilling } from './finance-billing.job';
import { sendMonthlySppReminders } from './spp-reminder.job';
import { purgeIdentityDocuments } from './identity-purge.job';
import { reviewLetterRetention } from './letter-retention.job';
import { runChatbotSpendCheck } from './chatbot-spend.job';
import { runChatbotTranscriptPurge } from './chatbot-transcript-purge.job';
import { runChatbotEscalationRetry } from './chatbot-escalation-retry.job';
import { runAttendanceFollowUpReminder } from './attendance-follow-up.job';
import { runAttendanceRegisterReminder } from './attendance-register-reminder.job';
import { runAttendancePatternFlags } from './attendance-pattern.job';
import { runAccreditationReminder } from './accreditation-reminder.job';
import { runPermitNoteErasure } from './permit-note-erasure.job';
import { runHolidaySync } from './holiday-sync.job';
import { runAttendanceRetention } from './attendance-retention.job';
import { runAdmissionWaveStatusUpdate } from './admission-wave-status.job';
import { prisma } from '@/lib/prisma';

/**
 * Scheduler Module
 * Manages all cron jobs for the application
 */

// Track scheduled tasks
const scheduledTasks: ScheduledTask[] = [];

/**
 * Initialize all scheduled jobs
 */
export function initializeScheduler(): void {
  logger.info('[Scheduler] Initializing scheduled jobs...');

  // Dashboard metrics history (the dashboard's trend) - every minute
  const metricsTask = cron.schedule(
    '* * * * *',
    async () => {
      logger.debug('[Scheduler] Running dashboard metrics job');
      try {
        await aggregateDashboardMetrics();
      } catch (error) {
        logger.error('[Scheduler] Dashboard metrics job failed:', error);
      }
    },
    {
      timezone: 'Asia/Jakarta',
    }
  );
  scheduledTasks.push(metricsTask);
  logger.info('[Scheduler] Dashboard metrics job scheduled (every minute)');

  // Daily metric snapshots - Run at 1:00 AM every day
  // Cron: minute hour day month dayOfWeek
  const dailySnapshotTask = cron.schedule(
    '0 1 * * *',
    async () => {
      logger.info('[Scheduler] Running daily snapshot job');
      try {
        await createDailySnapshots();
      } catch (error) {
        logger.error('[Scheduler] Daily snapshot job failed:', error);
      }
    },
    {
      timezone: 'Asia/Jakarta',
    }
  );
  scheduledTasks.push(dailySnapshotTask);
  logger.info('[Scheduler] Daily snapshot job scheduled at 01:00 WIB');

  // Weekly summary - Run at 2:00 AM every Sunday
  const weeklySummaryTask = cron.schedule(
    '0 2 * * 0',
    async () => {
      logger.info('[Scheduler] Running weekly summary job');
      try {
        await createWeeklySummary();
      } catch (error) {
        logger.error('[Scheduler] Weekly summary job failed:', error);
      }
    },
    {
      timezone: 'Asia/Jakarta',
    }
  );
  scheduledTasks.push(weeklySummaryTask);
  logger.info('[Scheduler] Weekly summary job scheduled at 02:00 WIB on Sundays');

  // Cleanup - daily at 3:00 AM.
  //
  // Was monthly ('0 3 1 * *'), which contradicted the policy it enforces:
  // cleanupOldSnapshots prunes dashboard_history to the **last 24 hours**, and a
  // table written every minute cannot be held to a 24-hour window by a job that
  // runs once every 30 days. Production showed exactly that — 131,190 rows
  // spanning 16 days where the retention rule allows about 8,600.
  //
  // Daily is the smallest change that makes the two agree. It is safe for the
  // other half of the job: snapshots keep 365 days, and pruning a 365-day window
  // more often simply deletes fewer rows each time.
  //
  // The write rate itself is a separate question, deliberately left alone here:
  // aggregateDashboardMetrics runs every minute and writes 6 rows per run —
  // 8,640 a day, ~3.2M a year — for an institution whose figures move on the
  // timescale of a class period. That is a product decision, not a bug fix.
  const cleanupTask = cron.schedule(
    '0 3 * * *',
    async () => {
      logger.info('[Scheduler] Running cleanup job');
      try {
        await cleanupOldSnapshots();
      } catch (error) {
        logger.error('[Scheduler] Cleanup job failed:', error);
      }
    },
    {
      timezone: 'Asia/Jakarta',
    }
  );
  scheduledTasks.push(cleanupTask);
  logger.info('[Scheduler] Cleanup job scheduled daily at 03:00 WIB');

  // Auto-Billing - Run at 4:00 AM on the 1st of each month
  const autoBillingTask = cron.schedule(
    '0 4 1 * *',
    async () => {
      logger.info('[Scheduler] Running monthly auto-billing job');
      try {
        await runMonthlyAutoBilling();
      } catch (error) {
        logger.error('[Scheduler] Auto-billing job failed:', error);
      }
    },
    {
      timezone: 'Asia/Jakarta',
    }
  );
  scheduledTasks.push(autoBillingTask);
  logger.info('[Scheduler] Auto-billing job scheduled at 04:00 WIB on the 1st of each month');

  // SPP reminder: after auto-billing has generated the month's invoices,
  // remind every parent with an unpaid invoice (in-app + WhatsApp).
  const sppReminderTask = cron.schedule(
    '0 6 1 * *',
    async () => {
      logger.info('[Scheduler] Running monthly SPP reminder job');
      try {
        await sendMonthlySppReminders();
      } catch (error) {
        logger.error('[Scheduler] SPP reminder job failed:', error);
      }
    },
    {
      timezone: 'Asia/Jakarta',
    }
  );
  scheduledTasks.push(sppReminderTask);
  logger.info('[Scheduler] SPP reminder job scheduled at 06:00 WIB on the 1st of each month');

  /**
   * Penyapuan foto KTP — tiap hari pukul 02.30 WIB.
   *
   * Di sini, bukan di crontab host, karena berkasnya ada di volume yang
   * terpasang ke kontainer ini dan basis datanya hanya terjangkau dari jaringan
   * Compose. Penjadwal di luar kontainer terikat pada satu mesin dan tidak ikut
   * berpindah bersama image-nya. Alasan selengkapnya ada di berkas jobnya.
   *
   * 02.30 dipilih di celah yang kosong: snapshot harian 01.00, ringkasan
   * mingguan 02.00, cleanup 03.00. Pekerjaannya sendiri ringan — sebuah kueri
   * berindeks dan pembacaan satu direktori — tetapi menaruhnya bertumpuk dengan
   * yang lain hanya menyulitkan pembacaan log ketika ada yang salah.
   *
   * Kegagalan dicatat sebagai error dan tidak menjatuhkan penjadwal; berhasil
   * atau gagal, jalannya meninggalkan baris di `audit_logs` — yang menjawab
   * "kapan terakhir retensi ini benar-benar ditegakkan" setelah log diputar.
   */
  const identityPurgeTask = cron.schedule(
    '30 2 * * *',
    async () => {
      logger.info('[Scheduler] Running identity document purge job');
      try {
        const summary = await purgeIdentityDocuments(prisma);
        logger.info(
          `[Scheduler] Identity purge: ${summary.expired.length} expired, ` +
            `${summary.orphans.length} orphaned, ` +
            `${summary.onDiskCount} on disk, ${summary.referencedCount} referenced`
        );
      } catch (error) {
        logger.error('[Scheduler] Identity document purge job failed:', error);
      }
    },
    {
      timezone: 'Asia/Jakarta',
    }
  );
  scheduledTasks.push(identityPurgeTask);
  logger.info('[Scheduler] Identity document purge job scheduled daily at 02:30 WIB');

  /**
   * Peninjauan retensi naskah dinas — setiap Senin pukul 05:00 WIB.
   *
   * Mingguan, bukan harian: masa retensi dihitung dalam tahun, sehingga
   * memeriksanya tiap hari hanya mengulang daftar yang sama. Pukul 05:00
   * berada di celah yang kosong — setelah pekerjaan tengah malam dan sebelum
   * jam kerja, jadi daftarnya sudah ada ketika petugas arsip mulai bekerja.
   *
   * Ia **tidak memusnahkan** apa pun; yang dilakukannya adalah menghitung dan
   * mencatat (lihat `letter-retention.job.ts` untuk alasannya). Kegagalan
   * dicatat dan tidak menjatuhkan penjadwal.
   *
   * **Di mana petugas arsip menemukan hasilnya.** Baris log di bawah ini
   * hanyalah jumlah, dan `summary.due` sengaja tidak dicetak ke log: perihal
   * naskah Rahasia tidak boleh berakhir di pengumpul log. Daftar usulnya
   * tersedia di tiga permukaan, yang satu-satunya berisi perihal adalah
   * halaman:
   *   - `/e-office/retention` — daftar lengkap dan ekspor CSV, dibatasi
   *     cakupan jabatan pemanggilnya;
   *   - `pnpm --filter api db:retention-review` — daftar untuk terminal, tanpa
   *     perihal naskah rahasia;
   *   - `audit_logs` dengan `action = 'REVIEW_LETTER_RETENTION'` — jejak bahwa
   *     peninjauan benar-benar berjalan, beserta jumlahnya.
   * Jadi "hasil mingguan" bukan sesuatu yang menunggu dikirim: ia adalah daftar
   * yang dapat dibuka kapan saja, dan baris log yang menandai bahwa minggu itu
   * sudah diperiksa.
   */
  const retentionReviewTask = cron.schedule(
    '0 5 * * 1',
    async () => {
      logger.info('[Scheduler] Running letter retention review job');
      try {
        const summary = await reviewLetterRetention(prisma);
        logger.info(
          `[Scheduler] Retention review: ${summary.due.length} jatuh tempo, ` +
            `${summary.consideredCount} diperiksa, ` +
            `${summary.missingRetention} tanpa masa retensi`
        );
      } catch (error) {
        logger.error('[Scheduler] Letter retention review failed:', error);
      }
    },
    {
      timezone: 'Asia/Jakarta',
    }
  );
  scheduledTasks.push(retentionReviewTask);
  logger.info('[Scheduler] Letter retention review scheduled weekly on Monday 05:00 WIB');

  /**
   * Peringatan belanja chatbot — setiap hari pukul 07:00 WIB.
   *
   * Harian, bukan bulanan, meskipun anggarannya bulanan: peringatan yang datang
   * pada tanggal 1 hanya bisa mengabarkan uang yang sudah habis. Pukul 07:00
   * dipilih supaya suratnya berada di kotak masuk sebelum jam kerja, bukan
   * bersama pekerjaan tengah malam yang tidak dibaca siapa pun.
   *
   * Pekerjaan ini menahan diri sendiri: satu tingkat ambang hanya dikirim sekali
   * per bulan, dan bulan tanpa pemakaian tidak mengirim apa pun.
   */
  const chatbotSpendTask = cron.schedule(
    '0 7 * * *',
    async () => {
      logger.debug('[Scheduler] Running chatbot spend check');
      try {
        const result = await runChatbotSpendCheck();
        if (result.sent) {
          logger.warn(`[Scheduler] Chatbot spend alert sent: ${result.sent}`);
        }
      } catch (error) {
        logger.error('[Scheduler] Chatbot spend check failed:', error);
      }
    },
    {
      timezone: 'Asia/Jakarta',
    }
  );
  scheduledTasks.push(chatbotSpendTask);
  logger.info('[Scheduler] Chatbot spend check scheduled daily at 07:00 WIB');

  /**
   * Penyapuan riwayat percakapan asisten publik.
   *
   * Retensi 90 hari adalah separuh alasan mengapa menyimpan kalimat pengunjung
   * dapat dipertanggungjawabkan sama sekali; kalau penyapunya berhenti, janji
   * itu berhenti benar tanpa satu pun gejala yang terlihat. Karena itu ia
   * menulis baris audit setiap kali berjalan, termasuk ketika tidak ada yang
   * dihapus.
   *
   * Pukul 03:15 WIB: sesudah pembersihan snapshot pukul 03:00 dan jauh dari
   * penyapuan KTP pukul 02:30, supaya dua penghapusan besar tidak berebut
   * basis data yang sama.
   */
  const chatbotTranscriptTask = cron.schedule(
    '15 3 * * *',
    async () => {
      logger.debug('[Scheduler] Running chatbot transcript purge');
      try {
        await runChatbotTranscriptPurge();
      } catch (error) {
        logger.error('[Scheduler] Chatbot transcript purge failed:', error);
      }
    },
    {
      timezone: 'Asia/Jakarta',
    }
  );
  scheduledTasks.push(chatbotTranscriptTask);
  logger.info('[Scheduler] Chatbot transcript purge scheduled daily at 03:15 WIB');

  /**
   * Penerusan pertanyaan yang belum terkirim, dicoba lagi tiap 30 menit.
   *
   * Percobaan PERTAMA sudah terjadi di dalam permintaan penanya; yang ini
   * hanya untuk yang gagal. Jadi pada hari yang sehat pekerjaan ini tidak
   * menemukan apa-apa dan tidak menulis satu baris log pun — sengaja, supaya
   * ketika ia MENEMUKAN sesuatu, barisnya berarti.
   *
   * Tiap 30 menit dengan batas 5 percobaan memberi jendela sekitar dua jam,
   * cukup untuk melewati gangguan penyedia surel yang lazim.
   */
  const chatbotEscalationTask = cron.schedule(
    '*/30 * * * *',
    async () => {
      try {
        await runChatbotEscalationRetry();
      } catch (error) {
        logger.error('[Scheduler] Chatbot escalation retry failed:', error);
      }
    },
    {
      timezone: 'Asia/Jakarta',
    }
  );
  scheduledTasks.push(chatbotEscalationTask);
  logger.info('[Scheduler] Chatbot escalation retry scheduled every 30 minutes');

  /**
   * Pengingat tindak lanjut absensi (decisions/absensi-harian.md).
   *
   * Pukul 15:00 WIB: sesudah jam pelajaran usai, masih di jam kerja, dan
   * masih sempat menghubungi wali hari itu juga. Wali kelas murid pulang-pergi
   * dan musyrif santri mukim diingatkan sekali tentang Alpa hari ini yang
   * belum ada keterangannya; hari tanpa Alpa tidak mengirim apa pun.
   */
  const attendanceFollowUpTask = cron.schedule(
    '0 15 * * *',
    async () => {
      try {
        const { reminded } = await runAttendanceFollowUpReminder();
        if (reminded) logger.info(`[Scheduler] Attendance follow-up reminders: ${reminded}`);
      } catch (error) {
        logger.error('[Scheduler] Attendance follow-up reminder failed:', error);
      }
    },
    {
      timezone: 'Asia/Jakarta',
    }
  );
  scheduledTasks.push(attendanceFollowUpTask);
  logger.info('[Scheduler] Attendance follow-up reminder scheduled daily at 15:00 WIB');

  /**
   * Pengingat register (decisions/absensi-harian.md).
   *
   * Tiap 5 menit pukul 05:00–16:55 WIB: kelas yang registernya belum lengkap
   * 30 menit sesudah jam pertamanya hari itu mengingatkan guru jam itu dan
   * wali kelasnya, sekali. Hari libur di kalender tidak mengingatkan siapa pun.
   */
  const registerReminderTask = cron.schedule(
    '*/5 5-16 * * *',
    async () => {
      try {
        const { reminded } = await runAttendanceRegisterReminder();
        if (reminded) logger.info(`[Scheduler] Register reminders: ${reminded}`);
      } catch (error) {
        logger.error('[Scheduler] Register reminder failed:', error);
      }
    },
    {
      timezone: 'Asia/Jakarta',
    }
  );
  scheduledTasks.push(registerReminderTask);
  logger.info('[Scheduler] Register reminder scheduled every 5 minutes, 05:00–16:55 WIB');

  /**
   * Tanda pola kehadiran (decisions/absensi-harian.md, diputuskan 2026-09-28).
   *
   * Pukul 16:00 WIB, sesudah register hari itu masuk: santri yang tidak hadir
   * pada ≥10% hari tercatat semester ini (sesudah 10 hari), atau terlambat 3
   * kali dalam 30 hari, ditandai sekali per semester; wali kelas, guru BK
   * unitnya, dan musyrif santri mukim diberi tahu.
   */
  const attendancePatternTask = cron.schedule(
    '0 16 * * *',
    async () => {
      try {
        const { raised, told } = await runAttendancePatternFlags();
        if (raised) logger.info(`[Scheduler] Attendance patterns raised: ${raised}, told: ${told}`);
      } catch (error) {
        logger.error('[Scheduler] Attendance pattern flag failed:', error);
      }
    },
    {
      timezone: 'Asia/Jakarta',
    }
  );
  scheduledTasks.push(attendancePatternTask);
  logger.info('[Scheduler] Attendance pattern flag scheduled daily at 16:00 WIB');

  /**
   * Pengingat akreditasi (decisions/akreditasi-unit.md, diputuskan 2026-09-28).
   *
   * Pukul 07:00 WIB: unit yang sertifikat akreditasinya berakhir dalam 12
   * bulan, tanpa sertifikat yang lebih baru, mengingatkan kepala sekolah dan
   * admin unitnya, sekali.
   */
  const accreditationReminderTask = cron.schedule(
    '0 7 * * *',
    async () => {
      try {
        const { units } = await runAccreditationReminder();
        if (units) logger.info(`[Scheduler] Accreditation reminders: ${units} unit(s)`);
      } catch (error) {
        logger.error('[Scheduler] Accreditation reminder failed:', error);
      }
    },
    {
      timezone: 'Asia/Jakarta',
    }
  );
  scheduledTasks.push(accreditationReminderTask);
  logger.info('[Scheduler] Accreditation reminder scheduled daily at 07:00 WIB');

  /**
   * Penghapusan surat dokter izin (decisions/pemutus-izin-santri.md,
   * diputuskan 2026-09-28).
   *
   * Pukul 01:15 WIB, sebelum cadangan malam: berkas surat dokter yang tahun
   * ajarannya sudah berakhir dihapus; faktanya tetap di izin.
   */
  const permitNoteErasureTask = cron.schedule(
    '15 1 * * *',
    async () => {
      try {
        await runPermitNoteErasure();
      } catch (error) {
        logger.error('[Scheduler] Permit note erasure failed:', error);
      }
    },
    {
      timezone: 'Asia/Jakarta',
    }
  );
  scheduledTasks.push(permitNoteErasureTask);
  logger.info("[Scheduler] Doctor's note erasure scheduled daily at 01:15 WIB");

  /**
   * Penarikan libur nasional (decisions/absensi-pegawai.md, diputuskan
   * 2026-09-29).
   *
   * Tanggal 1 pukul 05:00 WIB: `api-hari-libur` memperbarui datanya tiap
   * tanggal 1, dan 05:00 sudah melewati pekerjaan tengah malam. Hasilnya
   * disimpan ke kalender, jadi sumber yang mati tidak mengubah hari libur
   * menjadi Alpa. Super Admin juga bisa menariknya sendiri dari Pengaturan.
   */
  const holidaySyncTask = cron.schedule(
    '0 5 1 * *',
    async () => {
      try {
        const result = await runHolidaySync();
        if (result && result.created) {
          logger.info(`[Scheduler] Holiday sync added ${result.created} holiday(s)`);
        }
      } catch (error) {
        logger.error('[Scheduler] Holiday sync failed:', error);
      }
    },
    {
      timezone: 'Asia/Jakarta',
    }
  );
  scheduledTasks.push(holidaySyncTask);
  logger.info('[Scheduler] Holiday sync scheduled at 05:00 WIB on the 1st of each month');

  // SPMB waves open and close by their dates; a minute past midnight WIB, when
  // a day's windows have just opened or closed.
  const admissionWaveStatusTask = cron.schedule(
    '1 0 * * *',
    async () => {
      try {
        await runAdmissionWaveStatusUpdate();
      } catch (error) {
        logger.error('[Scheduler] SPMB wave status update failed:', error);
      }
    },
    {
      timezone: 'Asia/Jakarta',
    }
  );
  scheduledTasks.push(admissionWaveStatusTask);
  logger.info('[Scheduler] SPMB wave statuses scheduled daily at 00:01 WIB');

  /**
   * Retensi absensi pegawai (decisions/absensi-pegawai.md).
   *
   * Selfie dan koordinat adalah data pribadi spesifik (UU 27/2022 Ps. 4); Pasal
   * 42 mewajibkan pemrosesan berakhir saat masa retensi tercapai. 03:15 WIB, di
   * celah kosong antara pembersihan snapshot 03:00 dan pekerjaan pagi.
   */
  const attendanceRetentionTask = cron.schedule(
    '15 3 * * *',
    async () => {
      try {
        const result = await runAttendanceRetention();
        if (result.photosErased || result.recordsDeleted) {
          logger.info(
            `[Scheduler] Attendance retention: ${result.photosErased} photo(s), ` +
              `${result.recordsDeleted} record(s)`
          );
        }
      } catch (error) {
        logger.error('[Scheduler] Attendance retention failed:', error);
      }
    },
    {
      timezone: 'Asia/Jakarta',
    }
  );
  scheduledTasks.push(attendanceRetentionTask);
  logger.info('[Scheduler] Attendance retention scheduled daily at 03:15 WIB');

  logger.info(`[Scheduler] ${scheduledTasks.length} jobs scheduled successfully`);
}

/**
 * Stop all scheduled jobs (for graceful shutdown)
 */
export function stopScheduler(): void {
  logger.info('[Scheduler] Stopping all scheduled jobs...');
  scheduledTasks.forEach((task) => task.stop());
  logger.info('[Scheduler] All jobs stopped');
}

/**
 * Run a specific job manually (for testing or manual trigger)
 */
export async function runJob(
  jobName:
    | 'dashboard-metrics'
    | 'daily-snapshot'
    | 'weekly-summary'
    | 'cleanup'
    | 'auto-billing'
    | 'spp-reminder'
    | 'identity-purge'
    | 'chatbot-spend'
    | 'chatbot-transcript-purge'
    | 'chatbot-escalation-retry'
    | 'attendance-follow-up'
    | 'attendance-register-reminder'
    | 'attendance-pattern'
    | 'accreditation-reminder'
    | 'permit-note-erasure'
    | 'holiday-sync'
    | 'attendance-retention'
): Promise<void> {
  logger.info(`[Scheduler] Manually running job: ${jobName}`);

  switch (jobName) {
    case 'dashboard-metrics':
      await aggregateDashboardMetrics();
      break;
    case 'daily-snapshot':
      await createDailySnapshots();
      break;
    case 'weekly-summary':
      await createWeeklySummary();
      break;
    case 'cleanup':
      await cleanupOldSnapshots();
      break;
    case 'auto-billing':
      await runMonthlyAutoBilling();
      break;
    case 'spp-reminder':
      await sendMonthlySppReminders();
      break;
    case 'identity-purge':
      await purgeIdentityDocuments(prisma);
      break;
    case 'chatbot-spend':
      await runChatbotSpendCheck();
      break;
    case 'chatbot-transcript-purge':
      await runChatbotTranscriptPurge();
      break;
    case 'chatbot-escalation-retry':
      await runChatbotEscalationRetry();
      break;
    case 'attendance-follow-up':
      await runAttendanceFollowUpReminder();
      break;
    case 'attendance-register-reminder':
      await runAttendanceRegisterReminder();
      break;
    case 'attendance-pattern':
      await runAttendancePatternFlags();
      break;
    case 'accreditation-reminder':
      await runAccreditationReminder();
      break;
    case 'permit-note-erasure':
      await runPermitNoteErasure();
      break;
    case 'holiday-sync':
      await runHolidaySync();
      break;
    case 'attendance-retention':
      await runAttendanceRetention();
      break;
    default:
      throw new Error(`Unknown job: ${jobName}`);
  }

  logger.info(`[Scheduler] Job ${jobName} completed`);
}
