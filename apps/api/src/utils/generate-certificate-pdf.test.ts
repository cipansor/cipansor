import { describe, it, expect } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import zlib from 'node:zlib';
import { generateCertificatePdfBuffer, CertificatePdfInput } from './generate-certificate-pdf';

function base(overrides: Partial<CertificatePdfInput> = {}): CertificatePdfInput {
  return {
    certificateNumber: 'TAH/09/2026/ABCDE',
    title: 'Sertifikat Tahfidz',
    issueDate: new Date('2026-09-01T00:00:00.000Z'),
    signatoryName: 'Ust. Ahmad',
    signatoryTitle: 'Musyrif',
    verificationUrl: 'https://cipansor.or.id/verifikasi/TAH-09-2026-ABCDE',
    student: {
      nis: '2026001',
      user: { name: 'Aisyah Nur' },
      unit: { name: 'SMP IT Cipansor' },
      enrollments: [{ class: { name: '7A' } }],
    },
    ...overrides,
  };
}

async function pageCount(buffer: Buffer): Promise<number> {
  const doc = await PDFDocument.load(buffer);
  return doc.getPageCount();
}

/**
 * The text pdf-lib draws, read back out of the content stream. pdf-lib encodes
 * WinAnsi text as `<hex> Tj`, so this is the only way to assert *what* the PDF
 * says rather than merely that it is a PDF — which is what proves the download
 * reproduces the printed details instead of the generic layout.
 */
function pdfText(buffer: Buffer): string {
  return pdfLines(buffer)
    .map((l) => l.text)
    .join('\n');
}

const A4_WIDTH = 595.28;

/**
 * Every text run in the content streams with the x it was drawn at. pdf-lib
 * positions each `drawText` with `1 0 0 1 <x> <y> Tm` and encodes the text as
 * `<hex> Tj`, so this reads both back — which is how a test can prove a long
 * detail did not run off the page rather than merely that it was drawn.
 */
function pdfLines(buffer: Buffer): Array<{ x: number; y: number; size: number; text: string }> {
  const raw = buffer.toString('latin1');
  const streams = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  const out: Array<{ x: number; y: number; size: number; text: string }> = [];
  let stream: RegExpExecArray | null;
  while ((stream = streams.exec(raw))) {
    let content: string;
    try {
      content = zlib.inflateSync(Buffer.from(stream[1], 'latin1')).toString('latin1');
    } catch {
      continue;
    }
    if (!content.includes('Tj')) continue;
    // pdf-lib emits `/Helvetica-xxx <size> Tf` then `1 0 0 1 <x> <y> Tm` then
    // `<hex> Tj` for every drawText call; track the size as we walk the stream.
    const tokens =
      /\/[A-Za-z-]+-?\d* ([\d.]+) Tf|1 0 0 1 ([\d.]+) ([\d.]+) Tm\s*<([0-9A-Fa-f]+)>\s*Tj/g;
    let size = 12;
    let token: RegExpExecArray | null;
    while ((token = tokens.exec(content))) {
      if (token[1] !== undefined) {
        size = Number(token[1]);
      } else {
        out.push({
          x: Number(token[2]),
          y: Number(token[3]),
          size,
          text: Buffer.from(token[4], 'hex').toString('latin1'),
        });
      }
    }
  }
  return out;
}

/** Every drawn run must sit inside the page's left and right edges. */
async function assertLinesWithinContentWidth(buffer: Buffer): Promise<void> {
  const doc = await PDFDocument.load(buffer);
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  for (const line of pdfLines(buffer)) {
    const width = helv.widthOfTextAtSize(line.text, line.size);
    expect(line.x, `"${line.text}" starts left of the page`).toBeGreaterThanOrEqual(0);
    expect(
      line.x + width,
      `"${line.text}" runs past the right page edge (${line.x} + ${width})`
    ).toBeLessThanOrEqual(A4_WIDTH);
  }
}

describe('generateCertificatePdfBuffer', () => {
  it('renders a short certificate to a single page', async () => {
    const buffer = await generateCertificatePdfBuffer(base({ description: 'Hafal 5 juz.' }));
    expect(await pageCount(buffer)).toBe(1);
  });

  it('flows a maximum-length description onto further pages', async () => {
    // The schema accepts 2,000 characters; at 12pt across the content width
    // that is far more than one page, and the signature block still needs the
    // bottom of the last one.
    const description = Array.from({ length: 200 }, (_, i) => `prestasi-${i}`).join(' ');
    const buffer = await generateCertificatePdfBuffer(base({ description }));
    expect(description.length).toBeGreaterThan(1000);
    expect(await pageCount(buffer)).toBeGreaterThan(1);
  });

  it('is byte-identical for the same input', async () => {
    const a = await generateCertificatePdfBuffer(base({ description: 'Hafal 5 juz.' }));
    const b = await generateCertificatePdfBuffer(base({ description: 'Hafal 5 juz.' }));
    expect(a.equals(b)).toBe(true);
  });

  it('renders without a student, grade or rank', async () => {
    const buffer = await generateCertificatePdfBuffer(
      base({ student: null, description: undefined })
    );
    expect(await pageCount(buffer)).toBe(1);
  });

  it('prints a sanad’s juz, juz name and teacher from the mint metadata', async () => {
    const buffer = await generateCertificatePdfBuffer(
      base({
        certificateType: 'SANAD',
        metadata: { juz: 5, juzName: 'Al-Maidah', teacherName: 'Ust. Ahmad' },
      })
    );
    const text = pdfText(buffer);
    // The paper prints the juz's name beside its number.
    expect(text).toContain('Juz: Al-Maidah (Juz 5)');
    expect(text).toContain('Pengajar: Ust. Ahmad');
  });

  it('prints a tahfidz syahadah’s qira’ah, juz count and silsilah from the metadata', async () => {
    const buffer = await generateCertificatePdfBuffer(
      base({
        certificateType: 'TAHFIDZ',
        metadata: {
          qiraahType: 'Hafs ‘an ‘Asim',
          completedJuz: [1, 2, 3, 4, 5],
          musyrifName: 'Ust. Ahmad',
          sanadChain: 'Rasulullah → Jibril → …',
        },
      })
    );
    const text = pdfText(buffer);
    // `winAnsiSafe` folds the smart quotes and the arrow to their ASCII forms.
    expect(text).toContain("Qira'ah: Hafs 'an 'Asim");
    // The paper shows the *number* of juz ("5 Juz"), never the list.
    expect(text).toContain('Jumlah Juz: 5 Juz');
    expect(text).not.toContain('Jumlah Juz: 1, 2, 3');
    expect(text).toContain('Musyrif: Ust. Ahmad');
    expect(text).toContain('Silsilah Sanad: Rasulullah ? Jibril ? ...');
  });

  it('reports a 30-juz list as a count, not a line that overflows the page', async () => {
    const completedJuz = Array.from({ length: 30 }, (_, i) => i + 1);
    const buffer = await generateCertificatePdfBuffer(
      base({ certificateType: 'TAHFIDZ_30_JUZ', metadata: { completedJuz } })
    );
    const text = pdfText(buffer);
    expect(text).toContain('Jumlah Juz: 30 Juz');
    expect(text).not.toContain('Jumlah Juz: 1, 2, 3');
    await assertLinesWithinContentWidth(buffer);
  });

  it('wraps a long silsilah so it stays inside the page edges', async () => {
    const sanadChain = Array.from({ length: 60 }, (_, i) => `Guru Ke-${i + 1}`).join(' > ');
    const buffer = await generateCertificatePdfBuffer(
      base({ certificateType: 'TAHFIDZ', metadata: { sanadChain } })
    );
    const text = pdfText(buffer);
    // The chain is wider than A4; a single unwrapped line would run off both
    // edges. It must be broken into more than one drawn line, all within width.
    const chainLines = text.split('\n').filter((l) => l.includes('Guru Ke-'));
    expect(chainLines.length).toBeGreaterThan(1);
    await assertLinesWithinContentWidth(buffer);
  });

  it('renders the generic layout when a row has no mint metadata', async () => {
    // A row minted before the metadata column existed — the download must not
    // crash and must not invent detail that was never printed.
    const buffer = await generateCertificatePdfBuffer(base({ metadata: null }));
    const text = pdfText(buffer);
    expect(text).toContain('Sertifikat Tahfidz');
    expect(text).not.toContain('Juz:');
    expect(text).not.toContain('Qira’ah:');
  });

  it('ignores unexpected metadata shapes', async () => {
    const buffer = await generateCertificatePdfBuffer(
      base({ certificateType: 'SANAD', metadata: 'not-an-object' })
    );
    expect(await pageCount(buffer)).toBe(1);
  });
});
