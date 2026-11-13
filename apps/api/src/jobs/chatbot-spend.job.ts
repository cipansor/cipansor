/**
 * Peringatan belanja asisten publik.
 *
 * `docs/planning/chatbot-design.md` menuntut empat hal sebelum chatbot boleh
 * hidup di halaman publik: pembatas per-IP, batas token, batas panjang
 * percakapan, dan **peringatan belanja bulanan**. Tiga yang pertama sudah
 * berjalan sejak 2026-07-25. Yang keempat tidak pernah dibangun, dan itulah
 * satu-satunya butir daftar itu yang menjawab pertanyaan "apakah tagihannya
 * sedang menanjak" — tiga lainnya hanya membatasi laju, dan laju yang kita
 * anggap wajar pun, bila diteruskan sebulan penuh, tetap sebuah tagihan.
 *
 * **Kenapa surel, bukan sekadar log.** Kontainer API menulis log setiap menit
 * dan memutarnya pada 10 MB × 3 berkas; peringatan yang hanya menjadi satu
 * baris `warn` di sana adalah peringatan yang tidak akan pernah dibaca. Ini
 * pelajaran yang sama yang membuat penyapuan KTP menulis baris `audit_logs`
 * setiap kali berjalan (§14 ROADMAP), dan pelajaran yang sama yang membuat
 * pembatas laju sempat hidup di kode namun mati di produksi selama enam hari.
 *
 * **Kenapa tidak diam ketika harganya belum diatur.** Harga token adalah milik
 * model dan wilayahnya, keduanya konfigurasi env di sini, jadi kode ini tidak
 * dapat mengetahuinya dan tidak boleh menebaknya. Tetapi "belum berharga" tidak
 * boleh berarti "tidak berbunyi": itu persis bentuk kegagalan yang sudah dua
 * kali terjadi di modul ini — sesuatu yang ada di kode dan tidak berlaku di
 * produksi. Karena itu, bila harga atau anggaran belum diisi sementara asisten
 * benar-benar dipakai, yang terkirim adalah pemberitahuan konfigurasi berisi
 * volume nyata bulan berjalan, sekali sebulan.
 */

import { config } from '@/config';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { deliverEmail } from '@/modules/notifications/email-transport';
import {
  emailFinePrint,
  emailHeading,
  emailLogoAttachment,
  emailNote,
  emailPanel,
  emailParagraph,
  emailSignoff,
  renderEmailLayout,
} from '@/modules/notifications/email-layout';
import {
  estimateCost,
  monthToDateUsage,
  type CostEstimate,
  type MonthToDateUsage,
} from '@/modules/chatbot/usage.service';
import { wibMonthKey } from '@/utils/wib';

/** Nama tindakan pada `audit_logs`, sekaligus penanda "sudah diberitahukan". */
export const CHATBOT_SPEND_AUDIT_ACTION = 'CHATBOT_SPEND_ALERT';
export const CHATBOT_SPEND_AUDIT_ENTITY = 'ChatbotSpend';

/**
 * Ambang, dari yang tertinggi.
 *
 * Diperiksa menurun dan hanya yang tertinggi yang dikirim, supaya satu bulan
 * yang melonjak dari 0 ke 120% tidak menurunkan tiga surat sekaligus. Yang
 * lebih rendah tetap tercatat sebagai tidak terkirim — itu benar: 50% yang
 * terlewati bersamaan dengan 100% bukan kabar yang perlu berdiri sendiri.
 */
export const SPEND_ALERT_LEVELS = [100, 80, 50] as const;

export type SpendAlertKind = `budget-${(typeof SPEND_ALERT_LEVELS)[number]}` | 'unpriced';

export interface ChatbotSpendCheckResult {
  monthKey: string;
  /** Null hanya bila pemeriksaan tidak jadi berjalan. */
  usage: MonthToDateUsage | null;
  cost: CostEstimate | null;
  /** Null bila anggaran belum diisi atau harganya belum ada. */
  percentOfBudget: number | null;
  /** Yang benar-benar terkirim, bila ada. */
  sent: SpendAlertKind | null;
  skipped:
    | 'chatbot-disabled'
    | 'no-usage'
    | 'already-notified'
    | 'below-thresholds'
    | 'send-failed'
    | null;
}

const idNumber = new Intl.NumberFormat('id-ID');

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** `USD 0,0034` tetap terbaca; `USD 0.00` tidak memberi tahu apa pun. */
function formatMoney(amount: number, currency: string): string {
  return `${currency} ${amount.toFixed(amount > 0 && amount < 1 ? 4 : 2)}`;
}

/** Ambang tertinggi yang sudah terlampaui, atau null. */
function crossedLevel(percent: number): (typeof SPEND_ALERT_LEVELS)[number] | null {
  return SPEND_ALERT_LEVELS.find((level) => percent >= level) ?? null;
}

/**
 * Apakah kabar ini sudah pernah dikirim bulan ini.
 *
 * Penandanya baris `audit_logs`, bukan kolom pada tabel pemakaian, karena
 * pertanyaannya bukan "berapa" melainkan "apakah sudah pernah diberitahukan" —
 * dan jawaban itu harus tetap ada meskipun agregat hariannya kelak dipangkas.
 */
async function alreadyNotified(monthKey: string, kind: SpendAlertKind): Promise<boolean> {
  const existing = await prisma.auditLog.findFirst({
    where: {
      action: CHATBOT_SPEND_AUDIT_ACTION,
      entity: CHATBOT_SPEND_AUDIT_ENTITY,
      entityId: `${monthKey}:${kind}`,
    },
    select: { id: true },
  });
  return existing !== null;
}

function usageRows(usage: MonthToDateUsage): Array<[string, string]> {
  const rows: Array<[string, string]> = [
    ['Bulan', usage.monthKey],
    ['Panggilan berbayar', idNumber.format(usage.requests)],
    ['Token masukan', idNumber.format(usage.promptTokens)],
    ['Token keluaran', idNumber.format(usage.completionTokens)],
  ];
  if (usage.cachedPromptTokens > 0) {
    rows.push(['— di antaranya dari cache penyedia', idNumber.format(usage.cachedPromptTokens)]);
  }
  if (usage.byModel.length > 0) {
    rows.push([
      'Model',
      usage.byModel.map((m) => `${esc(m.model)} (${idNumber.format(m.requests)})`).join('<br>'),
    ]);
  }
  return rows;
}

/**
 * Kalimat yang harus ikut setiap angka yang tidak lengkap.
 *
 * Tanpa ini, taksiran dari sebagian panggilan akan terbaca sebagai biaya bulan
 * ini — jenis angka yang paling merugikan di sistem ini, yang terdengar pasti
 * padahal tidak. Lihat memori "Figures that lie".
 */
function incompleteNote(usage: MonthToDateUsage, cost: CostEstimate): string | null {
  const notes: string[] = [];

  if (usage.unmeteredRequests > 0) {
    notes.push(
      `${idNumber.format(usage.unmeteredRequests)} panggilan berhasil tidak melaporkan jumlah token, ` +
        'sehingga pemakaiannya tidak ikut terhitung — angka di atas <strong>kurang dari ' +
        'yang sebenarnya</strong> sebesar itu.'
    );
  }

  // Arah galat yang berlawanan dengan di atas, dan keduanya bisa muncul
  // bersamaan. Karena itu keduanya disebut apa adanya alih-alih diringkas
  // menjadi satu kata "taksiran" yang tidak memberi tahu ke arah mana ia meleset.
  if (cost.cacheUnreported) {
    notes.push(
      'Penyedia tidak melaporkan token masukan mana yang dilayani dari cache-nya, ' +
        'sehingga semuanya dihitung pada harga penuh — angka di atas <strong>lebih dari ' +
        'yang sebenarnya</strong> sebesar selisih tarif itu.'
    );
  }

  return notes.length === 0 ? null : emailNote(notes.join(' '));
}

async function sendBudgetAlert(
  usage: MonthToDateUsage,
  cost: CostEstimate,
  percent: number,
  level: number,
  to: string
): Promise<boolean> {
  const budget = config.chatbot.spend.monthlyBudget;
  const melampaui = percent >= 100;
  const subject = melampaui
    ? `[Cipansor] Belanja chatbot ${usage.monthKey} melampaui anggaran`
    : `[Cipansor] Belanja chatbot ${usage.monthKey} sudah ${Math.round(percent)}% dari anggaran`;

  const body = [
    emailHeading(melampaui ? 'Anggaran chatbot terlampaui' : 'Belanja chatbot mendekati anggaran'),
    emailParagraph(
      `Taksiran belanja asisten publik sejak awal bulan sudah <strong>${formatMoney(cost.amount, cost.currency)}</strong>, ` +
        `yaitu ${Math.round(percent)}% dari anggaran bulanan ${formatMoney(budget, cost.currency)}.`
    ),
    emailPanel([
      ...usageRows(usage),
      ['Taksiran biaya', formatMoney(cost.amount, cost.currency)],
      ['Anggaran bulanan', formatMoney(budget, cost.currency)],
    ]),
    incompleteNote(usage, cost) ?? '',
    emailParagraph(
      'Bila lonjakan ini tidak wajar, yang pertama diperiksa adalah rincian harian pada tabel ' +
        '<code>chatbot_usage_daily</code>: satu hari yang jauh menonjol berarti penyalahgunaan, ' +
        'sedangkan kenaikan yang merata berarti anggarannya memang perlu ditinjau.'
    ),
    emailFinePrint(
      'Ambang berikutnya tidak akan mengirim surat kedua untuk tingkat yang sama pada bulan yang sama. ' +
        'Anggaran dan harga token diatur lewat CHATBOT_MONTHLY_BUDGET, CHATBOT_PRICE_INPUT_PER_MTOK dan ' +
        'CHATBOT_PRICE_OUTPUT_PER_MTOK.'
    ),
    emailSignoff('Sistem Informasi Cipansor'),
  ].join('\n');

  return sendMail(to, subject, {
    title: subject,
    preheader: `Taksiran ${formatMoney(cost.amount, cost.currency)} dari anggaran ${formatMoney(budget, cost.currency)}.`,
    bodyHtml: body,
  });
}

async function sendUnpricedNotice(
  usage: MonthToDateUsage,
  cost: CostEstimate,
  to: string
): Promise<boolean> {
  const subject = `[Cipansor] Pemantauan belanja chatbot belum dapat menghitung biaya`;

  const body = [
    emailHeading('Pemakaian tercatat, biayanya belum'),
    emailParagraph(
      'Asisten publik dipakai bulan ini dan setiap panggilannya sudah tercatat, tetapi harga token ' +
        'atau anggaran bulanannya belum diisi — sehingga tidak ada angka yang dapat dibandingkan dan ' +
        'tidak ada ambang yang dapat berbunyi.'
    ),
    emailPanel(usageRows(usage)),
    incompleteNote(usage, cost) ?? '',
    emailParagraph(
      'Isi tiga nilai berikut pada <code>.env</code> API, lalu mulai ulang kontainernya: ' +
        '<code>CHATBOT_PRICE_INPUT_PER_MTOK</code>, <code>CHATBOT_PRICE_OUTPUT_PER_MTOK</code> ' +
        '(harga per satu juta token, dari halaman harga penyedia untuk model yang sedang dipakai), dan ' +
        '<code>CHATBOT_MONTHLY_BUDGET</code>.'
    ),
    emailFinePrint(
      'Harga sengaja tidak diberi nilai bawaan: ia melekat pada model dan wilayah penerapan, yang keduanya ' +
        'dapat diganti lewat env, sehingga nilai bawaan apa pun akan menghasilkan angka yang tampak pasti ' +
        'namun keliru. Surat ini dikirim paling banyak sekali sebulan, dan hanya bila asisten benar-benar dipakai.'
    ),
    emailSignoff('Sistem Informasi Cipansor'),
  ].join('\n');

  return sendMail(to, subject, {
    title: subject,
    preheader: `${idNumber.format(usage.requests)} panggilan bulan ini belum dapat dihitung biayanya.`,
    bodyHtml: body,
  });
}

async function sendMail(
  to: string,
  subject: string,
  layout: { title: string; preheader: string; bodyHtml: string }
): Promise<boolean> {
  try {
    const result = await deliverEmail({
      to,
      subject,
      html: renderEmailLayout(layout),
      attachments: [emailLogoAttachment()],
    });
    // `delivered: false` berarti transport log-only — pesannya ditulis, bukan
    // dikirim. Itu bukan galat, tetapi juga bukan pemberitahuan; menandainya
    // sebagai sudah-terkirim akan membungkam bulan ini di penerapan yang
    // surelnya memang belum dikonfigurasi.
    if (!result.delivered) {
      logger.warn('[ChatbotSpend] Alert written to log transport, not delivered', { subject });
      return false;
    }
    return true;
  } catch (error) {
    logger.error('[ChatbotSpend] Alert could not be sent', {
      subject,
      message: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Satu baris audit setiap kali sebuah kabar benar-benar terkirim.
 *
 * Ditulis **sesudah** pengiriman berhasil, bukan sebelumnya. Kalau urutannya
 * dibalik, satu kegagalan kirim akan menelan peringatan itu untuk selamanya —
 * bulan itu sudah tertandai dan tidak akan dicoba lagi. Urutan ini memilih
 * kegagalan yang berlawanan: bila penulisan penandanya yang gagal, suratnya
 * berulang esok hari. Berisik itu terlihat; senyap tidak.
 */
async function markNotified(monthKey: string, kind: SpendAlertKind, summary: object) {
  try {
    await prisma.auditLog.create({
      data: {
        action: CHATBOT_SPEND_AUDIT_ACTION,
        entity: CHATBOT_SPEND_AUDIT_ENTITY,
        entityId: `${monthKey}:${kind}`,
        newValues: summary as never,
      },
    });
  } catch (error) {
    logger.error('[ChatbotSpend] Alert sent but not recorded', {
      monthKey,
      kind,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Memeriksa belanja bulan berjalan dan mengirim kabar bila perlu.
 *
 * Mengembalikan ringkasan alih-alih melempar: pemanggilnya adalah penjadwal,
 * dan sebuah pekerjaan yang mati tidak memberi tahu siapa pun.
 */
export async function runChatbotSpendCheck(
  now: Date = new Date()
): Promise<ChatbotSpendCheckResult> {
  const monthKey = wibMonthKey(now);
  const base: ChatbotSpendCheckResult = {
    monthKey,
    usage: null,
    cost: null,
    percentOfBudget: null,
    sent: null,
    skipped: null,
  };

  if (config.chatbot.provider === 'disabled') {
    return { ...base, skipped: 'chatbot-disabled' };
  }

  const usage = await monthToDateUsage(now);
  const cost = estimateCost(usage);

  // Nol panggilan berarti tidak ada yang dibelanjakan dan tidak ada yang perlu
  // dikabarkan — termasuk pemberitahuan konfigurasi, yang tanpa syarat ini akan
  // datang setiap bulan ke penerapan yang chatbot-nya memang tidak dipakai.
  if (usage.requests === 0) {
    return { ...base, usage, cost, skipped: 'no-usage' };
  }

  const to = config.chatbot.spend.alertTo || config.mail.replyTo;
  const budget = config.chatbot.spend.monthlyBudget;
  const comparable = cost.priced && budget > 0;
  const percent = comparable ? (cost.amount / budget) * 100 : null;

  const kind: SpendAlertKind | null = comparable
    ? (() => {
        const level = crossedLevel(percent as number);
        return level === null ? null : (`budget-${level}` as SpendAlertKind);
      })()
    : 'unpriced';

  if (kind === null) {
    return { ...base, usage, cost, percentOfBudget: percent, skipped: 'below-thresholds' };
  }

  if (await alreadyNotified(monthKey, kind)) {
    return { ...base, usage, cost, percentOfBudget: percent, skipped: 'already-notified' };
  }

  const sent =
    kind === 'unpriced'
      ? await sendUnpricedNotice(usage, cost, to)
      : await sendBudgetAlert(
          usage,
          cost,
          percent as number,
          Number(kind.slice('budget-'.length)),
          to
        );

  if (!sent) {
    return { ...base, usage, cost, percentOfBudget: percent, skipped: 'send-failed' };
  }

  await markNotified(monthKey, kind, {
    requests: usage.requests,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    unmeteredRequests: usage.unmeteredRequests,
    cachedPromptTokens: usage.cachedPromptTokens,
    estimatedCost: cost.priced ? cost.amount : null,
    cacheUnreported: cost.cacheUnreported,
    currency: cost.currency,
    budget: budget > 0 ? budget : null,
    percentOfBudget: percent,
    recipient: to,
  });

  logger.info('[ChatbotSpend] Alert sent', { monthKey, kind, to });
  return { ...base, usage, cost, percentOfBudget: percent, sent: kind };
}
