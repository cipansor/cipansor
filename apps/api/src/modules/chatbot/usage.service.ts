/**
 * Apa yang benar-benar dibelanjakan asisten publik, dan berapa taksiran
 * biayanya.
 *
 * Modul ini hanya melakukan dua hal: menambah satu baris agregat harian setiap
 * kali sebuah panggilan sampai ke penyedia, dan menjumlahkan bulan berjalan
 * ketika ada yang bertanya. Keputusan "apakah ini sudah terlalu mahal" bukan di
 * sini — itu milik `jobs/chatbot-spend.job.ts`, yang punya ambang, surat, dan
 * penjadwalnya sendiri.
 *
 * Lihat `docs/planning/chatbot-design.md` §"Cost amplification": pembatas laju,
 * batas token dan cache sudah lama ada; peringatan belanja adalah satu-satunya
 * butir daftar itu yang belum pernah dibangun.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { config } from '@/config';
import type { LlmUsage } from './providers/types';
import { wibDay, wibMonthStart, wibMonthKey } from '@/utils/wib';

export interface RecordUsageInput {
  /** Model yang menjawab, seperti dikembalikan penyedia. */
  model: string;
  /** Kosong bila penyedia tidak melaporkannya — dicatat sebagai belum terukur. */
  usage?: LlmUsage;
  now?: Date;
}

/**
 * Menambahkan satu panggilan berbayar ke agregat hari ini.
 *
 * **Tidak pernah melempar.** Alasannya sama dengan yang tertulis di
 * `writeCached`: pencatatan biaya yang gagal tidak boleh menjadi chatbot yang
 * gagal. Pengunjung yang sudah menerima jawabannya tidak berkepentingan dengan
 * pembukuan kita.
 *
 * Panggilan dari cache tidak lewat sini sama sekali — yang dihitung hanyalah
 * yang benar-benar ditagih.
 */
export async function recordUsage(input: RecordUsageInput): Promise<void> {
  const { model, usage, now = new Date() } = input;
  const date = wibDay(now);

  const increments = {
    requests: { increment: 1 },
    promptTokens: { increment: usage?.promptTokens ?? 0 },
    completionTokens: { increment: usage?.completionTokens ?? 0 },
    cachedPromptTokens: { increment: usage?.cachedPromptTokens ?? 0 },
    unmeteredRequests: { increment: usage ? 0 : 1 },
  };

  try {
    await prisma.chatbotUsageDaily.upsert({
      where: { date_model: { date, model } },
      create: {
        date,
        model,
        requests: 1,
        promptTokens: usage?.promptTokens ?? 0,
        completionTokens: usage?.completionTokens ?? 0,
        cachedPromptTokens: usage?.cachedPromptTokens ?? 0,
        unmeteredRequests: usage ? 0 : 1,
      },
      update: increments,
    });
  } catch (error) {
    // Dua panggilan bersamaan pada baris hari yang belum ada: keduanya gagal
    // menemukan, keduanya mencoba membuat, salah satunya kalah di indeks unik.
    // Yang kalah cukup menambah baris yang sudah dibuat pemenangnya — kalau
    // ini tidak ditangani, permintaan pertama setiap hari punya peluang hilang
    // dari pembukuan, dan justru pada hari tersibuklah peluang itu terbesar.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      try {
        await prisma.chatbotUsageDaily.update({
          where: { date_model: { date, model } },
          data: increments,
        });
        return;
      } catch (retryError) {
        logger.error('Chatbot usage retry failed', {
          message: retryError instanceof Error ? retryError.message : String(retryError),
        });
        return;
      }
    }
    logger.error('Chatbot usage could not be recorded', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export interface UsageTotals {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  /** Bagian dari `promptTokens` yang ditagih pada harga cache penyedia. */
  cachedPromptTokens: number;
  unmeteredRequests: number;
}

export interface MonthToDateUsage extends UsageTotals {
  /** Hari pertama bulan WIB yang dijumlahkan. */
  monthStart: Date;
  monthKey: string;
  /** Rincian per model, karena harga melekat pada model. */
  byModel: Array<UsageTotals & { model: string }>;
}

/** Menjumlahkan pemakaian sejak awal bulan WIB sampai hari `now`. */
export async function monthToDateUsage(now: Date = new Date()): Promise<MonthToDateUsage> {
  const monthStart = wibMonthStart(now);
  const rows = await prisma.chatbotUsageDaily.findMany({
    where: { date: { gte: monthStart, lte: wibDay(now) } },
    orderBy: [{ model: 'asc' }, { date: 'asc' }],
  });

  const byModel = new Map<string, UsageTotals & { model: string }>();
  const totals: UsageTotals = {
    requests: 0,
    promptTokens: 0,
    completionTokens: 0,
    cachedPromptTokens: 0,
    unmeteredRequests: 0,
  };

  for (const row of rows) {
    const entry = byModel.get(row.model) ?? {
      model: row.model,
      requests: 0,
      promptTokens: 0,
      completionTokens: 0,
      cachedPromptTokens: 0,
      unmeteredRequests: 0,
    };
    entry.requests += row.requests;
    entry.promptTokens += row.promptTokens;
    entry.completionTokens += row.completionTokens;
    entry.cachedPromptTokens += row.cachedPromptTokens;
    entry.unmeteredRequests += row.unmeteredRequests;
    byModel.set(row.model, entry);

    totals.requests += row.requests;
    totals.promptTokens += row.promptTokens;
    totals.completionTokens += row.completionTokens;
    totals.cachedPromptTokens += row.cachedPromptTokens;
    totals.unmeteredRequests += row.unmeteredRequests;
  }

  return {
    ...totals,
    monthStart,
    monthKey: wibMonthKey(now),
    byModel: [...byModel.values()],
  };
}

export interface CostEstimate {
  /** Taksiran biaya dalam `currency`. 0 bila belum ada harga. */
  amount: number;
  currency: string;
  /** Salah bila semua harga masih 0 — angkanya tidak berarti apa-apa. */
  priced: boolean;
  /**
   * Benar bila tidak ada satu pun token masukan yang dilaporkan berasal dari
   * cache penyedia sementara harga cache-nya diatur lebih murah.
   *
   * Artinya seluruh token masukan dihitung pada harga penuh, sehingga angkanya
   * BATAS ATAS. Deployment yang sedang dipakai memang tidak melaporkannya, jadi
   * ini keadaan normal — bukan galat, tetapi tetap harus dikatakan, karena
   * "USD 7,10" yang sebenarnya "paling banyak USD 7,10" adalah dua pernyataan
   * yang berbeda.
   */
  cacheUnreported: boolean;
  /**
   * Benar bila ada panggilan berhasil yang tidak melaporkan token.
   *
   * Ketika ini benar, `amount` adalah batas bawah dan harus dikatakan begitu
   * kepada pembacanya. Menyebutnya "biaya bulan ini" akan menjadi jenis angka
   * yang paling merugikan: yang terdengar pasti padahal tidak.
   */
  incomplete: boolean;
}

/**
 * Taksiran biaya dari total token, memakai harga di `config.chatbot.spend`.
 *
 * Tiga tarif, karena penyedianya memang menagih tiga: token masukan baru,
 * token masukan yang dilayani dari cache-nya, dan token keluaran. Yang dari
 * cache dikurangkan dari masukan penuh supaya tidak terhitung dua kali.
 */
export function estimateCost(totals: UsageTotals): CostEstimate {
  const {
    inputPricePerMillionTokens,
    outputPricePerMillionTokens,
    cachedInputPricePerMillionTokens,
    currency,
  } = config.chatbot.spend;
  const priced =
    inputPricePerMillionTokens > 0 ||
    outputPricePerMillionTokens > 0 ||
    cachedInputPricePerMillionTokens > 0;

  // Dijaga tidak negatif: kalau sebuah penyedia kelak melaporkan token cache
  // melebihi token masukannya, yang keliru adalah laporannya — bukan alasan
  // untuk menerbitkan biaya negatif.
  const cached = Math.min(totals.cachedPromptTokens, totals.promptTokens);
  const fresh = totals.promptTokens - cached;

  const amount =
    (fresh / 1_000_000) * inputPricePerMillionTokens +
    (cached / 1_000_000) * cachedInputPricePerMillionTokens +
    (totals.completionTokens / 1_000_000) * outputPricePerMillionTokens;

  return {
    amount: priced ? amount : 0,
    currency,
    priced,
    incomplete: totals.unmeteredRequests > 0,
    cacheUnreported:
      cachedInputPricePerMillionTokens > 0 &&
      cachedInputPricePerMillionTokens < inputPricePerMillionTokens &&
      totals.cachedPromptTokens === 0 &&
      totals.promptTokens > 0,
  };
}
