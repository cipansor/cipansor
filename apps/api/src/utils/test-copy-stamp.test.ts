/**
 * A test copy of the system (staging, `DOCUMENT_TEST_COPY=true`) stamps every
 * page of every document it renders — a naskah dinas we lay out, a Rapor
 * Merdeka, and a naskah a drafter uploaded and had signed. Its demo accounts
 * carry the names of the yayasan's real office holders and their passwords are
 * public, so an unstamped naskah from staging would be a naskah "signed" by the
 * real Ketua on the real letterhead. Production, where the switch is off,
 * renders exactly as before.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PDFDocument, PDFPage, PDFArray, PDFRawStream, StandardFonts, degrees } from 'pdf-lib';
import zlib from 'zlib';
import { TEST_COPY_NOTE, TEST_COPY_STAMP } from '@cipansor/shared';
import { ApiError, ErrorCode } from '@/middleware/error';

const { documents } = vi.hoisted(() => ({ documents: { testCopy: false } }));
vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config')>();
  return { ...actual, config: { ...actual.config, documents } };
});

import {
  generateLetterPdfBuffer,
  stampSignatureVisualisation,
  type LetterPdfInput,
} from './generate-letter-pdf';
import { stampIfTestCopy } from './test-copy-stamp';
import {
  generateRaportMerdekaPdfBuffer,
  type RaportMerdekaPdfData,
} from './generate-raport-merdeka-pdf';

const letter = {
  id: 'letter-1',
  letterNumber: '434/Sket/Y-CPS/IX/2026',
  date: new Date('2026-09-01T00:00:00.000Z'),
  type: 'SURAT_KETERANGAN',
  nature: 'PUBLIC',
  subject: 'Keterangan Aktif Santri',
  // Long enough for a second page.
  content: Array.from({ length: 90 }, (_, i) => `Baris isi naskah nomor ${i + 1}.`).join('\n'),
  unit: { name: 'SMP IT Cipansor', address: 'Tasikmalaya' },
  signatures: [],
} as LetterPdfInput;

const raport: RaportMerdekaPdfData = {
  siswa: { nama: 'Ahmad', nis: '9021', kelas: '7A', unit: 'SMP IT Pesantren Cipansor' },
  tahunAjaran: { tahun: '2026/2027', semester: 1, semesterLabel: 'Ganjil' },
  waliKelas: { nama: 'Ustadzah Wali' },
  intrakurikuler: { kelompokUmum: [], kelompokPesantren: [] },
};

let drawn: Array<{ text: string; page: PDFPage }>;

beforeEach(() => {
  documents.testCopy = false;
  drawn = [];
  const original = PDFPage.prototype.drawText;
  vi.spyOn(PDFPage.prototype, 'drawText').mockImplementation(function (this: PDFPage, text, o) {
    drawn.push({ text, page: this });
    return original.call(this, text, o);
  });
});
afterEach(() => vi.restoreAllMocks());

const pagesWith = (text: string) =>
  new Set(drawn.filter((d) => d.text === text).map((d) => d.page));
const allPages = () => new Set(drawn.map((d) => d.page));

describe('a test copy stamps its documents', () => {
  it('stamps every page of a naskah dinas, with the note at the top', async () => {
    documents.testCopy = true;

    await generateLetterPdfBuffer(letter);

    expect(allPages().size).toBeGreaterThan(1);
    expect(pagesWith(TEST_COPY_STAMP)).toEqual(allPages());
    expect(pagesWith(TEST_COPY_NOTE)).toEqual(allPages());
  });

  it('stamps every page of a Rapor Merdeka', async () => {
    documents.testCopy = true;

    await generateRaportMerdekaPdfBuffer(raport);

    expect(pagesWith(TEST_COPY_STAMP)).toEqual(allPages());
  });

  /**
   * A naskah dinas a drafter uploaded and had signed goes through
   * `stampSignatureVisualisation`, not `generateLetterPdfBuffer` — so it needs
   * its own stamp, or a staging archive holds an officially signed upload with
   * no test-copy marking. The stamp lands on the drafter's pages *and* the
   * appended visualisation sheet, since it is applied to the whole document.
   */
  it('stamps every page of a signed uploaded naskah, drafter pages included', async () => {
    documents.testCopy = true;

    const uploaded = await PDFDocument.create();
    uploaded.addPage([595.28, 841.89]);
    uploaded.addPage([595.28, 841.89]);
    const uploadedBytes = Buffer.from(await uploaded.save());

    const signed = await stampSignatureVisualisation(uploadedBytes, {
      signedAt: new Date('2026-09-01T03:00:00.000Z'),
      signerName: 'H. Dadan Hamdani',
      signerTitle: 'Ketua Yayasan',
    });

    expect(signed).toBeInstanceOf(Buffer);
    // Two drafter pages plus the appended visualisation sheet, all stamped.
    expect(allPages().size).toBe(3);
    expect(pagesWith(TEST_COPY_STAMP)).toEqual(allPages());
    expect(pagesWith(TEST_COPY_NOTE)).toEqual(allPages());
  });

  it('stamps nothing where the switch is off — production', async () => {
    await generateLetterPdfBuffer(letter);
    await generateRaportMerdekaPdfBuffer(raport);
    await stampSignatureVisualisation(await generateLetterPdfBuffer(letter), {
      signedAt: new Date('2026-09-01T03:00:00.000Z'),
      signerName: 'X',
    });

    expect(pagesWith(TEST_COPY_STAMP).size).toBe(0);
    expect(pagesWith(TEST_COPY_NOTE).size).toBe(0);
  });
});

/**
 * Where the markings land, read back from the saved bytes.
 *
 * A viewer shows the CropBox and applies `/Rotate`; `page.getSize()` measures
 * the MediaBox. A mark placed with the MediaBox can sit outside the visible
 * area — in the signed bytes but invisible to the reader — so these tests place
 * the CropBox off-origin and rotate the page, then read the text matrices back
 * out of the page's content stream and check every corner of the run falls
 * inside what is shown.
 *
 * (No rasteriser is installed in this repo, so the bytes are the closest
 * available witness to what a viewer would draw.)
 */
describe('test-copy markings sit inside the visible page', () => {
  /** One content stream, decompressed. */
  const contentOf = async (pdf: Buffer) => {
    const doc = await PDFDocument.load(pdf);
    const page = doc.getPage(0);
    const streams: PDFRawStream[] = [];
    const collect = (obj: unknown) => {
      if (obj instanceof PDFRawStream) streams.push(obj);
      else if (obj instanceof PDFArray) {
        for (let i = 0; i < obj.size(); i++) collect(obj.lookup(i));
      }
    };
    collect(page.node.Contents());
    return streams
      .map((s) => {
        try {
          return zlib.inflateSync(Buffer.from(s.contents)).toString('latin1');
        } catch {
          return Buffer.from(s.contents).toString('latin1');
        }
      })
      .join('\n');
  };

  /**
   * The text matrix and font size of the run whose encoded text is `needle`. The
   * size is read from the `Tf` before the `Tm`, so the check stays honest if the
   * stamping logic shrinks a marking to fit a small page.
   */
  const runFor = (content: string, needle: string) => {
    // pdf-lib encodes text as WinAnsi hex; the em-dash in the stamp is 0x97
    // there, not its code point.
    const winAnsi = (ch: string) => (ch === '—' ? 0x97 : ch.charCodeAt(0));
    const encoded = Buffer.from([...needle].map(winAnsi))
      .toString('hex')
      .toUpperCase();
    const re = new RegExp(
      `([-\\d.]+) ([-\\d.]+) ([-\\d.]+) ([-\\d.]+) ([-\\d.]+) ([-\\d.]+) Tm\\s*\\n?<${encoded}> Tj`,
      'g'
    );
    const m = re.exec(content);
    if (!m) throw new Error(`no text run for ${JSON.stringify(needle.slice(0, 12))}`);
    const before = content.slice(0, m.index);
    const tf = [...before.matchAll(/\/[^\s/]+ ([-.\d]+) Tf/g)].pop();
    return {
      a: Number(m[1]),
      b: Number(m[2]),
      e: Number(m[5]),
      f: Number(m[6]),
      size: tf ? Number(tf[1]) : 0,
    };
  };

  /**
   * The four corners of a text run in the page's coordinates: the anchor plus
   * the baseline vector (`length`, along the run's angle) and the ascent
   * (`height`, perpendicular to it, rising from the baseline). Checking every
   * corner, not the midpoint, is what proves the whole marking is visible.
   */
  const cornersOf = (
    run: { a: number; b: number; e: number; f: number },
    length: number,
    height: number
  ) => {
    const angle = Math.atan2(run.b, run.a);
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    const px = -Math.sin(angle);
    const py = Math.cos(angle);
    return [
      [0, 0],
      [length, 0],
      [length, height],
      [0, height],
    ].map(([along, across]) => ({
      x: run.e + along * ux + across * px,
      y: run.f + along * uy + across * py,
    }));
  };

  const measure = async (text: string, size: number, bold = false) => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(bold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica);
    return {
      width: font.widthOfTextAtSize(text, size),
      height: font.heightAtSize(size),
    };
  };

  /**
   * A page whose CropBox is a 400×400 square inside a 595×842 MediaBox — at the
   * origin or offset into the sheet, the shape a scanner or "print to PDF"
   * leaves — optionally rotated. The MediaBox centre (≈298, 421) and top edge
   * (≈842) both fall outside every crop here, so a mark placed from the MediaBox
   * lands where the reader cannot see it.
   */
  const cropped = async (rotation: 0 | 90 | 180 | 270, crop: [number, number, number, number]) => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595.28, 841.89]);
    page.setCropBox(...crop);
    if (rotation) page.setRotation(degrees(rotation));
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText('isi naskah', { x: crop[0] + 4, y: crop[1] + 4, size: 9, font });
    const reopened = await PDFDocument.load(Buffer.from(await doc.save()));
    await stampIfTestCopy(reopened);
    reopened.setCreationDate(new Date(0));
    reopened.setModificationDate(new Date(0));
    return { bytes: Buffer.from(await reopened.save()), crop };
  };

  const inside = (
    point: { x: number; y: number },
    [x1, y1, w, h]: [number, number, number, number],
    slack = 1
  ) => {
    expect(point.x).toBeGreaterThanOrEqual(x1 - slack);
    expect(point.x).toBeLessThanOrEqual(x1 + w + slack);
    expect(point.y).toBeGreaterThanOrEqual(y1 - slack);
    expect(point.y).toBeLessThanOrEqual(y1 + h + slack);
  };

  // Pages big enough to carry both markings (each ≥ MIN_MARK_SIZE at 4pt).
  const crops: Array<[number, number, number, number]> = [
    [0, 0, 400, 400],
    [60, 90, 400, 400],
    [95.28, 41.89, 400, 400],
    // Narrower than the note at its full size (≈349pt), so the note only fits
    // because the logic shrinks it — a midpoint check would pass here while the
    // ends hang off both sides.
    [0, 0, 320, 400],
    // The strongest shrink that is still above the legibility floor, so the
    // containment check covers a heavily shrunk marking, not only a full-size
    // one.
    [0, 0, 240, 240],
  ];
  const rotations = [0, 90, 180, 270] as const;

  it.each(crops.map((c) => [c]))(
    'keeps the whole note inside a %o-cropped page at every rotation',
    async (crop) => {
      documents.testCopy = true;
      for (const rotation of rotations) {
        const { bytes } = await cropped(rotation, crop);
        const content = await contentOf(bytes);
        const run = runFor(content, TEST_COPY_NOTE);
        // The mark must be visible at all — a size of 0 is what the guard
        // refuses, and what pdf-lib would redraw at its own default size.
        expect(run.size).toBeGreaterThan(0);
        const { width, height } = await measure(TEST_COPY_NOTE, run.size);
        for (const corner of cornersOf(run, width, height)) inside(corner, crop);
      }
    }
  );

  it.each(crops.map((c) => [c]))(
    'keeps the whole diagonal stamp inside a %o-cropped page at every rotation',
    async (crop) => {
      documents.testCopy = true;
      for (const rotation of rotations) {
        const { bytes } = await cropped(rotation, crop);
        const content = await contentOf(bytes);
        const run = runFor(content, TEST_COPY_STAMP);
        expect(run.size).toBeGreaterThan(0);
        const { width, height } = await measure(TEST_COPY_STAMP, run.size, true);
        for (const corner of cornersOf(run, width, height)) inside(corner, crop);
      }
    }
  );
});

/**
 * A page too small to carry the markings is refused, not stamped at a size that
 * cannot be seen.
 *
 * pdf-lib's `drawText` reads `options.size || this.fontSize`, so a fitted size
 * of 0 would be drawn at its 24pt default — outside a page this small — and the
 * signed, archived page would carry no readable warning. The reported case (a
 * 20×200 CropBox, whose width leaves no room once the margin is reserved), the
 * 24pt boundary the finding names, and the point just below where the note
 * reaches `MIN_MARK_SIZE` are all covered.
 */
describe('a test copy refuses a page too small to mark', () => {
  const tooSmall: Array<[number, number, number, number]> = [
    [0, 0, 20, 200],
    [0, 0, 24, 24],
    [0, 0, 100, 100],
    [0, 0, 209, 209],
  ];

  it.each(tooSmall.map((c) => [c]))(
    'rejects a %o-cropped page instead of signing it unmarked',
    async (crop) => {
      documents.testCopy = true;
      const doc = await PDFDocument.create();
      const page = doc.addPage([595.28, 841.89]);
      page.setCropBox(...crop);

      // A drafter-actionable problem, not a server fault: answered 400.
      const failure = stampIfTestCopy(doc);
      await expect(failure).rejects.toBeInstanceOf(ApiError);
      await expect(failure).rejects.toMatchObject({
        code: ErrorCode.BAD_REQUEST,
        message: expect.stringContaining('SALINAN UJI'),
      });
      // The guard runs before either marking, so nothing is drawn on it.
      expect(pagesWith(TEST_COPY_STAMP).size).toBe(0);
      expect(pagesWith(TEST_COPY_NOTE).size).toBe(0);
    }
  );

  it('accepts the smallest page that can carry both markings', async () => {
    documents.testCopy = true;
    const doc = await PDFDocument.create();
    const page = doc.addPage([595.28, 841.89]);
    page.setCropBox(0, 0, 210, 210);

    await stampIfTestCopy(doc);

    expect(pagesWith(TEST_COPY_STAMP).size).toBe(1);
    expect(pagesWith(TEST_COPY_NOTE).size).toBe(1);
  });
});
