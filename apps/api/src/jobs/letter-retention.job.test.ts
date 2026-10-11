import { describe, it, expect, vi } from 'vitest';
import {
  reviewLetterRetention,
  reviewLetterRetentionForActor,
  LETTER_RETENTION_AUDIT_ACTION,
} from './letter-retention.job';

/**
 * Cakupan akses diambil dari modul aslinya, tetapi ditiru di sini supaya uji
 * ini dapat membuktikan bahwa ia benar-benar **diterapkan** — bukan sekadar
 * dipanggil. Sentinelnya membedakan "dipakai" dari "kebetulan cocok".
 */
vi.mock('@/utils/letter-access', () => ({
  letterScopeWhere: vi.fn(() => ({ __scope: 'ACTOR_SCOPE' })),
}));

import { letterScopeWhere } from '@/utils/letter-access';

/**
 * Prisma tiruan yang cukup untuk pekerjaan ini.
 *
 * `letter.findMany` mengembalikan baris apa adanya; penyaringan tanggalnya
 * dilakukan di kode yang diuji, bukan di SQL — itulah yang ingin dibuktikan
 * uji ini, jadi tiruannya tidak boleh ikut menyaring.
 */
function fakePrisma(rows: any[], opts: { auditThrows?: boolean } = {}) {
  const auditCreate = vi.fn(async (_args: { data: Record<string, unknown> }) => {
    if (opts.auditThrows) throw new Error('audit_logs tidak dapat ditulis');
    return { id: 'a1' };
  });
  return {
    prisma: {
      letter: { findMany: vi.fn(async () => rows) },
      auditLog: { create: auditCreate },
    } as any,
    auditCreate,
  };
}

/** Surat bertanggal lama dengan klasifikasi bermasa retensi tertentu. */
function letter(overrides: Record<string, unknown> = {}) {
  return {
    id: 'l1',
    letterNumber: '001/YYS/2020',
    agendaNumber: null,
    subject: 'Undangan rapat',
    unitId: 'unit-smp',
    nature: 'PUBLIC',
    date: new Date('2015-01-01'),
    classification: { code: '005', name: 'Undangan', retention: 5 },
    ...overrides,
  };
}

describe('reviewLetterRetention', () => {
  it('lists a letter whose retention has elapsed', async () => {
    const { prisma } = fakePrisma([letter()]);

    const summary = await reviewLetterRetention(prisma, {
      dryRun: true,
      now: new Date('2026-01-01'),
    });

    expect(summary.due).toHaveLength(1);
    expect(summary.due[0].id).toBe('l1');
    expect(summary.due[0].retentionYears).toBe(5);
    // 2015 + 5 = 2020, well before "now".
    expect(summary.due[0].dueAt.getFullYear()).toBe(2020);
  });

  it('leaves a letter that is not yet due', async () => {
    const { prisma } = fakePrisma([letter()]);

    const summary = await reviewLetterRetention(prisma, {
      dryRun: true,
      // A day before the five-year anniversary (2015-01-01 + 5 = 2020-01-01).
      now: new Date('2019-12-31'),
    });

    expect(summary.due).toHaveLength(0);
    expect(summary.missingRetention).toBe(0);
  });

  it('adds calendar years, not 365-day blocks', async () => {
    // A leap-year letter: 2016-02-29 + 4 years lands on 2020-02-29 because
    // 2020 is a leap year. A fixed 4×365 would land on 2020-02-28.
    const { prisma } = fakePrisma([
      letter({
        date: new Date('2016-02-29'),
        classification: { code: '900', name: 'Tetap', retention: 4 },
      }),
    ]);

    const summary = await reviewLetterRetention(prisma, {
      dryRun: true,
      now: new Date('2020-03-01'),
    });

    expect(summary.due).toHaveLength(1);
    expect(summary.due[0].dueAt.toISOString().slice(0, 10)).toBe('2020-02-29');
  });

  it('counts a classified letter with no retention as a JRA gap', async () => {
    const { prisma } = fakePrisma([
      letter({ classification: { code: '999', name: 'Tanpa jadwal', retention: null } }),
    ]);

    const summary = await reviewLetterRetention(prisma, {
      dryRun: true,
      now: new Date('2026-01-01'),
    });

    expect(summary.due).toHaveLength(0);
    expect(summary.missingRetention).toBe(1);
  });

  it('reports the total it considered', async () => {
    const { prisma } = fakePrisma([
      letter({ id: 'a' }),
      letter({ id: 'b', date: new Date('2025-01-01') }),
    ]);

    const summary = await reviewLetterRetention(prisma, {
      dryRun: true,
      now: new Date('2026-01-01'),
    });

    expect(summary.consideredCount).toBe(2);
    // Only 'a' is old enough.
    expect(summary.due.map((d) => d.id)).toEqual(['a']);
  });

  it('writes one audit row when not a dry run', async () => {
    const { prisma, auditCreate } = fakePrisma([letter()]);

    await reviewLetterRetention(prisma, { now: new Date('2026-01-01') });

    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(auditCreate.mock.calls[0][0].data).toMatchObject({
      action: LETTER_RETENTION_AUDIT_ACTION,
      entity: 'Letter',
    });
    // The count, never the subject — an audit table has more readers than a
    // letter list, and a classified subject would leak there.
    const newValues = auditCreate.mock.calls[0][0].data.newValues as Record<string, unknown>;
    expect(newValues).toEqual({ due: 1, considered: 1, missingRetention: 0 });
    expect(JSON.stringify(newValues)).not.toContain('Undangan rapat');
  });

  it('writes no audit row on a dry run', async () => {
    const { prisma, auditCreate } = fakePrisma([letter()]);

    await reviewLetterRetention(prisma, { dryRun: true, now: new Date('2026-01-01') });

    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('does not throw when the audit write fails', async () => {
    const { prisma } = fakePrisma([letter()], { auditThrows: true });

    await expect(
      reviewLetterRetention(prisma, { now: new Date('2026-01-01') })
    ).resolves.toBeTruthy();
  });

  it('query includes DISPOSED, so a disposed incoming letter is reviewed', async () => {
    const { prisma } = fakePrisma([letter()]);

    await reviewLetterRetention(prisma, { dryRun: true, now: new Date('2026-01-01') });

    const where = (prisma.letter.findMany as any).mock.calls[0][0].where;
    // Disposition sets DISPOSED before archival, so excluding it would leave
    // every acted-on incoming letter out of the review for good.
    expect(where.status.in).toContain('DISPOSED');
    expect(where.status.in).toEqual(
      expect.arrayContaining(['SIGNED', 'SENT', 'ARCHIVED', 'DISPOSED'])
    );
  });
});

describe('reviewLetterRetentionForActor', () => {
  const actor = {
    id: 'user-tu',
    role: 'UNIT_ADMIN',
    roleCode: 'SDIT_TATA_USAHA',
    unitId: 'unit-sdit',
  };

  it('applies the caller scope to the query, so one unit cannot read another', async () => {
    const { prisma } = fakePrisma([letter()]);

    await reviewLetterRetentionForActor(prisma, actor, { now: new Date('2026-01-01') });

    // The scope must be part of the same AND the retention filter is in, not
    // merely called and discarded — otherwise the list would be global.
    const where = (prisma.letter.findMany as any).mock.calls[0][0].where;
    expect(letterScopeWhere).toHaveBeenCalledWith(actor);
    expect(where.AND).toEqual(expect.arrayContaining([{ __scope: 'ACTOR_SCOPE' }]));
  });

  it('returns the same due list as the scheduler, but never records an audit row', async () => {
    const { prisma, auditCreate } = fakePrisma([letter()]);

    const summary = await reviewLetterRetentionForActor(prisma, actor, {
      now: new Date('2026-01-01'),
    });

    expect(summary.due).toHaveLength(1);
    expect(summary.dryRun).toBe(true);
    // The web surface is a *read*; only the scheduler's run is an event worth
    // auditing, and a page refresh is not.
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('counts a classified letter with no retention value as a JRA gap', async () => {
    const { prisma } = fakePrisma([
      letter({ classification: { code: '005', name: 'Undangan', retention: null } }),
    ]);

    const summary = await reviewLetterRetentionForActor(prisma, actor, {
      now: new Date('2026-01-01'),
    });

    expect(summary.due).toHaveLength(0);
    expect(summary.missingRetention).toBe(1);
  });
});
