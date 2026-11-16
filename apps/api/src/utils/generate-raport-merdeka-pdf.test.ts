import { describe, it, expect, vi, afterEach } from 'vitest';
import { PDFDict, PDFDocument, PDFName, PDFPage } from 'pdf-lib';
import {
  generateRaportMerdekaPdfBuffer,
  type RaportMerdekaPdfData,
} from './generate-raport-merdeka-pdf';

/**
 * The raport's page headers name the school. They used to print the unit's
 * name followed by " Cipansor" — every unit's name already ends with it, so
 * each page read "SMP IT CIPANSOR CIPANSOR". The name is printed as given:
 * the official one (`unitDocumentName`, raport-merdeka.service).
 *
 * The PDF embeds a subset font, whose text is glyph ids rather than letters,
 * so what is drawn is read where it is drawn.
 */

const data: RaportMerdekaPdfData = {
  siswa: {
    nama: 'Ahmad',
    nis: '9021',
    kelas: '7A',
    unit: 'SMP IT Pesantren Cipansor',
    unitType: 'SMP_IT',
    fase: 'D',
  },
  tahunAjaran: { tahun: '2026/2027', semester: 1, semesterLabel: 'Ganjil' },
  waliKelas: { nama: 'Ustadzah Wali' },
  pimpinanUnit: { nama: 'Kepala', jabatan: 'Kepala SMP IT Pesantren Cipansor' },
  intrakurikuler: {
    kelompokUmum: [
      {
        subjectName: 'Matematika',
        nilaiAkhir: 85,
        predikat: 'B',
        levelCapaian: 'Cakap',
        deskripsi: 'Baik.',
      },
    ],
    kelompokPesantren: [],
  },
};

afterEach(() => vi.restoreAllMocks());

describe('Rapor Merdeka PDF header', () => {
  it("names the school once, as given — not with a second ' Cipansor'", async () => {
    const drawn: string[] = [];
    const original = PDFPage.prototype.drawText;
    vi.spyOn(PDFPage.prototype, 'drawText').mockImplementation(function (
      this: PDFPage,
      text,
      options
    ) {
      drawn.push(text);
      return original.call(this, text, options);
    });

    await generateRaportMerdekaPdfBuffer(data);

    expect(drawn).toContain('SMP IT PESANTREN CIPANSOR');
    expect(drawn.join('\n')).not.toMatch(/CIPANSOR CIPANSOR/i);
  });
});

describe('Rapor Merdeka PDF signature place', () => {
  // The wali kelas and the pimpinan signed "Bogor, …" on every raport; the
  // yayasan is in Tasikmalaya (LETTERHEAD.city).
  it("is the yayasan's city", async () => {
    const drawn: string[] = [];
    const original = PDFPage.prototype.drawText;
    vi.spyOn(PDFPage.prototype, 'drawText').mockImplementation(function (
      this: PDFPage,
      text,
      options
    ) {
      drawn.push(text);
      return original.call(this, text, options);
    });

    await generateRaportMerdekaPdfBuffer(data);

    expect(drawn.some((t) => t.startsWith('Tasikmalaya, '))).toBe(true);
    expect(drawn.join('\n')).not.toMatch(/Bogor/);
  });

  // The date beside the city printed the *UTC* day: the container runs UTC, so
  // every raport made 00:00–06:59 WIB was dated the day before, and on a month
  // or year boundary the wrong month and year too. The block is part of the
  // printed, archived document, so it must read the WIB day the user sees.
  it('is dated in WIB, not UTC, in the small hours', async () => {
    const drawn: string[] = [];
    const original = PDFPage.prototype.drawText;
    vi.spyOn(PDFPage.prototype, 'drawText').mockImplementation(function (
      this: PDFPage,
      text,
      options
    ) {
      drawn.push(text);
      return original.call(this, text, options);
    });

    // 2026-10-31T17:30Z is 1 November 2026, 00:30 WIB.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-31T17:30:00.000Z'));
    try {
      await generateRaportMerdekaPdfBuffer(data);
    } finally {
      vi.useRealTimers();
    }

    expect(drawn).toContain('Tasikmalaya, 1 November 2026');
    expect(drawn.join('\n')).not.toContain('31 Oktober 2026');
  });
});

describe('Rapor Merdeka PDF font', () => {
  /**
   * The raport prints in the built-in Helvetica, which every viewer carries.
   * It used to embed Amiri: its subset's outlines pointed past the end of
   * their own table, and FreeType — Chrome's viewer, poppler, mupdf — drew
   * most letters as nothing.
   */
  it('uses only built-in Helvetica and embeds no font program', async () => {
    const pdf = await PDFDocument.load(await generateRaportMerdekaPdfBuffer(data));

    const fonts = [...pdf.context.enumerateIndirectObjects()]
      .map(([, obj]) => obj)
      .filter(
        (obj): obj is PDFDict =>
          obj instanceof PDFDict && String(obj.get(PDFName.of('Type'))) === '/Font'
      );

    expect(fonts.length).toBeGreaterThan(0);
    for (const font of fonts) {
      expect(String(font.get(PDFName.of('BaseFont')))).toMatch(/^\/Helvetica/);
    }
    const embedded = [...pdf.context.enumerateIndirectObjects()].filter(
      ([, obj]) =>
        obj instanceof PDFDict &&
        ['FontFile', 'FontFile2', 'FontFile3'].some((k) => obj.get(PDFName.of(k)))
    );
    expect(embedded).toEqual([]);
  });

  it('keeps an accented name whole', async () => {
    const drawn: string[] = [];
    const original = PDFPage.prototype.drawText;
    vi.spyOn(PDFPage.prototype, 'drawText').mockImplementation(function (
      this: PDFPage,
      text,
      options
    ) {
      drawn.push(text);
      return original.call(this, text, options);
    });

    // "é" typed as "e" + a combining accent, as some keyboards send it.
    await generateRaportMerdekaPdfBuffer({
      ...data,
      siswa: { ...data.siswa, nama: 'Rene\u0301 Ahmad' },
    });

    expect(drawn.join('\n')).toContain('Ren\u00e9 Ahmad');
  });
});
