import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Prisma } from '@prisma/client';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    chatbotUsageDaily: { upsert: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  },
}));
vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { prisma } from '@/lib/prisma';
import { config } from '@/config';
import { estimateCost, monthToDateUsage, recordUsage } from '../usage.service';
import { wibDay, wibMonthKey, wibMonthStart } from '@/utils/wib';

const db = prisma as unknown as {
  chatbotUsageDaily: {
    upsert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
};

const originalSpend = { ...config.chatbot.spend };

beforeEach(() => {
  vi.clearAllMocks();
  db.chatbotUsageDaily.upsert.mockResolvedValue({});
  db.chatbotUsageDaily.update.mockResolvedValue({});
  db.chatbotUsageDaily.findMany.mockResolvedValue([]);
});

afterEach(() => {
  Object.assign(config.chatbot.spend, originalSpend);
});

/** Baris agregat sebagaimana Prisma mengembalikannya. */
function row(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'x',
    date: new Date('2026-09-04T00:00:00.000Z'),
    model: 'DeepSeek-V4-Flash',
    requests: 1,
    promptTokens: 100,
    completionTokens: 50,
    cachedPromptTokens: 0,
    unmeteredRequests: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

describe('hari WIB', () => {
  // Ini bukan kerapian zona waktu. Kolomnya `@db.Date` dan dibaca dalam UTC,
  // jadi tanpa pergeseran ini setiap pertanyaan antara 00:00 dan 07:00 WIB
  // masuk ke tanggal kemarin — persis jam ketika penyalahgunaan otomatis paling
  // mungkin berjalan, dan justru itu yang membuat laporan hariannya menyesatkan.
  it('menempatkan dini hari WIB pada tanggal WIB-nya, bukan tanggal UTC', () => {
    // 2026-09-04T20:30Z = 2026-09-05 03:30 WIB
    expect(wibDay(new Date('2026-09-04T20:30:00Z')).toISOString()).toBe('2026-09-05T00:00:00.000Z');
  });

  it('masih menghitung 23:59 WIB sebagai hari yang sama', () => {
    // 2026-09-04T16:59Z = 2026-09-04 23:59 WIB
    expect(wibDay(new Date('2026-09-04T16:59:00Z')).toISOString()).toBe('2026-09-04T00:00:00.000Z');
  });

  it('memotong bulan pada pergantian bulan WIB', () => {
    // 2026-08-31T17:10Z = 2026-09-01 00:10 WIB — bulan September, bukan Agustus.
    expect(wibMonthStart(new Date('2026-08-31T17:10:00Z')).toISOString()).toBe(
      '2026-09-01T00:00:00.000Z'
    );
    expect(wibMonthKey(new Date('2026-08-31T17:10:00Z'))).toBe('2026-09');
  });
});

describe('recordUsage', () => {
  it('menambah satu panggilan berbayar dengan tokennya', async () => {
    await recordUsage({
      model: 'DeepSeek-V4-Flash',
      usage: { promptTokens: 341, completionTokens: 16 },
      now: new Date('2026-09-04T03:00:00Z'),
    });

    const call = db.chatbotUsageDaily.upsert.mock.calls[0][0];
    expect(call.where.date_model).toEqual({
      date: new Date('2026-09-04T00:00:00.000Z'),
      model: 'DeepSeek-V4-Flash',
    });
    expect(call.create).toMatchObject({
      requests: 1,
      promptTokens: 341,
      completionTokens: 16,
      cachedPromptTokens: 0,
      unmeteredRequests: 0,
    });
    expect(call.update).toMatchObject({
      requests: { increment: 1 },
      promptTokens: { increment: 341 },
      completionTokens: { increment: 16 },
      unmeteredRequests: { increment: 0 },
    });
  });

  it('mencatat panggilan tanpa laporan token sebagai belum terukur, bukan sebagai gratis', async () => {
    await recordUsage({ model: 'gateway-model', now: new Date('2026-09-04T03:00:00Z') });

    const call = db.chatbotUsageDaily.upsert.mock.calls[0][0];
    expect(call.create).toMatchObject({
      requests: 1,
      promptTokens: 0,
      completionTokens: 0,
      unmeteredRequests: 1,
    });
  });

  it('menambah lewat update ketika dua panggilan berebut membuat baris hari yang sama', async () => {
    db.chatbotUsageDaily.upsert.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '7',
      })
    );

    await recordUsage({
      model: 'DeepSeek-V4-Flash',
      usage: { promptTokens: 10, completionTokens: 5 },
      now: new Date('2026-09-04T03:00:00Z'),
    });

    // Kalau P2002 tidak ditangani, panggilan pertama setiap hari punya peluang
    // hilang dari pembukuan — dan peluang itu terbesar justru di hari tersibuk.
    expect(db.chatbotUsageDaily.update).toHaveBeenCalledTimes(1);
    expect(db.chatbotUsageDaily.update.mock.calls[0][0].data).toMatchObject({
      requests: { increment: 1 },
      promptTokens: { increment: 10 },
    });
  });

  it('tidak melempar ketika basis datanya sedang tidak bisa ditulis', async () => {
    db.chatbotUsageDaily.upsert.mockRejectedValueOnce(new Error('connection refused'));

    // Pengunjung sudah menerima jawabannya; pembukuan yang gagal tidak boleh
    // mengubah jawaban itu menjadi galat.
    await expect(recordUsage({ model: 'm', now: new Date() })).resolves.toBeUndefined();
    expect(db.chatbotUsageDaily.update).not.toHaveBeenCalled();
  });
});

describe('monthToDateUsage', () => {
  it('menjumlahkan seluruh bulan dan merinci per model', async () => {
    db.chatbotUsageDaily.findMany.mockResolvedValue([
      row({ model: 'a', requests: 2, promptTokens: 100, completionTokens: 40 }),
      row({
        model: 'a',
        requests: 3,
        promptTokens: 150,
        completionTokens: 60,
        unmeteredRequests: 1,
      }),
      row({ model: 'b', requests: 1, promptTokens: 10, completionTokens: 5 }),
    ]);

    const usage = await monthToDateUsage(new Date('2026-09-04T03:00:00Z'));

    expect(usage.requests).toBe(6);
    expect(usage.promptTokens).toBe(260);
    expect(usage.completionTokens).toBe(105);
    expect(usage.unmeteredRequests).toBe(1);
    expect(usage.monthKey).toBe('2026-09');
    expect(usage.byModel).toEqual([
      {
        model: 'a',
        requests: 5,
        promptTokens: 250,
        completionTokens: 100,
        cachedPromptTokens: 0,
        unmeteredRequests: 1,
      },
      {
        model: 'b',
        requests: 1,
        promptTokens: 10,
        completionTokens: 5,
        cachedPromptTokens: 0,
        unmeteredRequests: 0,
      },
    ]);
  });

  it('membatasi kueri pada bulan WIB berjalan', async () => {
    await monthToDateUsage(new Date('2026-09-04T03:00:00Z'));

    expect(db.chatbotUsageDaily.findMany.mock.calls[0][0].where.date).toEqual({
      gte: new Date('2026-09-01T00:00:00.000Z'),
      lte: new Date('2026-09-04T00:00:00.000Z'),
    });
  });
});

describe('estimateCost', () => {
  const totals = {
    requests: 10,
    promptTokens: 2_000_000,
    completionTokens: 500_000,
    cachedPromptTokens: 0,
    unmeteredRequests: 0,
  };

  it('mengalikan token dengan harga per satu juta', () => {
    Object.assign(config.chatbot.spend, {
      inputPricePerMillionTokens: 0.3,
      outputPricePerMillionTokens: 1.2,
      currency: 'USD',
    });

    const cost = estimateCost(totals);
    expect(cost.amount).toBeCloseTo(2 * 0.3 + 0.5 * 1.2, 10);
    expect(cost.priced).toBe(true);
    expect(cost.currency).toBe('USD');
  });

  it('menyatakan dirinya belum berharga ketika kedua harga masih nol', () => {
    Object.assign(config.chatbot.spend, {
      inputPricePerMillionTokens: 0,
      outputPricePerMillionTokens: 0,
    });

    const cost = estimateCost(totals);
    expect(cost.priced).toBe(false);
    expect(cost.amount).toBe(0);
  });

  it('menagih token cache pada tarifnya sendiri, dan tidak dua kali', () => {
    // Harga sebenarnya per 2026-09-04: masukan 0,19, cache 0,028, keluaran 0,51.
    Object.assign(config.chatbot.spend, {
      inputPricePerMillionTokens: 0.19,
      cachedInputPricePerMillionTokens: 0.028,
      outputPricePerMillionTokens: 0.51,
    });

    // 2 juta token masukan, 1,5 juta di antaranya dari cache → 0,5 juta penuh.
    const cost = estimateCost({ ...totals, cachedPromptTokens: 1_500_000 });

    expect(cost.amount).toBeCloseTo(0.5 * 0.19 + 1.5 * 0.028 + 0.5 * 0.51, 10);
    expect(cost.cacheUnreported).toBe(false);
  });

  it('menyatakan dirinya batas atas ketika penyedia tidak melaporkan token cache', () => {
    // Bukan galat, dan BUKAN pula keadaan normal: produksi ternyata melaporkan
    // token cache (2.304 dari 8.589 pada hari pertama pencatatan). Yang diuji
    // di sini adalah bulan yang benar-benar tidak melaporkannya — karena
    // "USD 7,10" dan "paling banyak USD 7,10" adalah dua pernyataan berbeda.
    Object.assign(config.chatbot.spend, {
      inputPricePerMillionTokens: 0.19,
      cachedInputPricePerMillionTokens: 0.028,
    });

    expect(estimateCost(totals).cacheUnreported).toBe(true);
  });

  it('tidak menerbitkan biaya negatif dari laporan cache yang mustahil', () => {
    Object.assign(config.chatbot.spend, {
      inputPricePerMillionTokens: 0.19,
      cachedInputPricePerMillionTokens: 0.028,
      outputPricePerMillionTokens: 0,
    });

    const cost = estimateCost({
      ...totals,
      completionTokens: 0,
      cachedPromptTokens: 9_000_000,
    });

    expect(cost.amount).toBeCloseTo(2 * 0.028, 10);
  });

  it('menandai taksiran sebagai tidak lengkap bila ada panggilan yang tak terukur', () => {
    Object.assign(config.chatbot.spend, { inputPricePerMillionTokens: 0.3 });

    expect(estimateCost({ ...totals, unmeteredRequests: 4 }).incomplete).toBe(true);
    expect(estimateCost(totals).incomplete).toBe(false);
  });
});
