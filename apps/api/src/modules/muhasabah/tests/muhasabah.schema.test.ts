import { describe, it, expect } from 'vitest';
import {
  createMuhasabahSchema,
  createMineMuhasabahSchema,
  dailyReportQuerySchema,
  muhasabahDay,
} from '../muhasabah.schema';

/**
 * "Hari muhasabah" adalah hari kalender WIB "yyyy-MM-dd". Kolomnya `@db.Date`
 * dan setiap pembaca membangunnya lewat `dayOf()`, jadi sebuah datetime (atau
 * hari yang tidak ada, mis. 2026-02-30) tidak boleh lolos ke `new Date()` —
 * di sana ia bergeser sehari. Lihat issue #888.
 */
describe('muhasabahDay — hari kalender WIB', () => {
  it('menerima hari kalender', () => {
    expect(muhasabahDay.safeParse('2026-10-23').success).toBe(true);
  });

  it.each(['2026-13-45', '2026-02-30', '23-10-2026', '2026-10-23T00:00:00Z', ''])(
    'menolak %s',
    (value) => {
      expect(muhasabahDay.safeParse(value).success).toBe(false);
    }
  );

  it('menyebut format yang benar pada pesan galat', () => {
    const result = muhasabahDay.safeParse('23/10/2026');
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toContain('yyyy-MM-dd');
  });
});

describe('createMuhasabahSchema', () => {
  it('menolak tanggal yang bukan hari kalender', () => {
    expect(
      createMuhasabahSchema.safeParse({ studentId: crypto.randomUUID(), date: '2026-02-30' })
        .success
    ).toBe(false);
  });
});

describe('createMineMuhasabahSchema', () => {
  it('menerima tanpa date (server memakai hari WIB)', () => {
    expect(createMineMuhasabahSchema.safeParse({ mood: 'GOOD' }).success).toBe(true);
  });

  it('menolak tanggal yang bukan hari kalender', () => {
    expect(createMineMuhasabahSchema.safeParse({ mood: 'GOOD', date: '2026-02-30' }).success).toBe(
      false
    );
  });
});

describe('dailyReportQuerySchema', () => {
  it('menerima tanpa date (server memakai hari WIB)', () => {
    expect(dailyReportQuerySchema.safeParse({}).success).toBe(true);
  });

  it('menolak tanggal yang bukan hari kalender', () => {
    expect(dailyReportQuerySchema.safeParse({ date: '2026-02-30' }).success).toBe(false);
  });
});
