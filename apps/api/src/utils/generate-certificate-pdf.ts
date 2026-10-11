import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/**
 * The fields a certificate PDF needs. Deliberately structural (not the Prisma
 * type) so this renderer can be unit-tested with a plain object and does not
 * drag the database layer into a pure function.
 */
export interface CertificatePdfInput {
  certificateNumber: string;
  certificateType?: string | null;
  title: string;
  description?: string | null;
  grade?: string | null;
  rank?: number | null;
  issueDate: Date | string;
  signatoryName: string;
  signatoryTitle: string;
  verificationUrl: string;
  /**
   * Per-type render data persisted at mint time (see `DigitalCertificate.metadata`).
   * Without it a sanad's juz/teacher and a syahadah's qira'ah/silsilah — the
   * details actually printed on the document the issuer handed over — are lost
   * and the download falls back to the generic layout. Typed `unknown` because
   * the column is Prisma `JsonValue`; the renderer narrows it and ignores
   * anything unexpected, so a row minted before this column existed renders as
   * before.
   */
  metadata?: unknown;
  student?: {
    nis?: string | null;
    user?: { name: string } | null;
    unit?: { name: string } | null;
    enrollments?: Array<{ class?: { name: string } | null }> | null;
  } | null;
}

const A4 = { width: 595.28, height: 841.89 };

/**
 * `StandardFonts.Helvetica` is WinAnsi-encoded, so a character outside that set
 * (an em dash, a smart quote, Arabic) throws at draw time. Certificates carry
 * Indonesian names and titles, which can include such characters, so fold the
 * few that appear to their ASCII equivalents rather than fail the whole render.
 */
function winAnsiSafe(text: string): string {
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/[^\x00-\xff]/g, '?');
}

/** Wrap `text` to lines that fit `maxWidth` at the font's size. */
function wrap(
  text: string,
  font: { widthOfTextAtSize: (t: string, s: number) => number },
  size: number,
  maxWidth: number
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Read a metadata value as a non-empty string, or undefined. */
function metaString(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) return value.length ? value.join(', ') : undefined;
  const text = String(value).trim();
  return text.length ? text : undefined;
}

/** Narrow the untyped `metadata` JSON column to a plain object, or null. */
function asMetadata(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * The labelled details a printed sanad/syahadah carries, read back from the
 * persisted mint metadata so the download matches the document the issuer
 * handed over rather than the generic layout. Returns the same label the
 * paper prints, in the order it prints them.
 *
 * Old rows minted before the column existed have no metadata and simply return
 * nothing — the render then degrades to today's generic certificate, which is
 * exactly the previous behaviour.
 */
function certificateDetails(input: CertificatePdfInput): Array<{ label: string; value: string }> {
  const m = asMetadata(input.metadata);
  if (!m) return [];
  const type = input.certificateType ?? '';
  const details: Array<[string, string | undefined]> = [];

  // The printed syahadah shows the *number* of completed juz ("5 Juz"), not the
  // list of juz numbers. The list is long enough to run past the page anyway,
  // so the download reports the count the paper reports.
  const juzList = Array.isArray(m['completedJuz']) ? (m['completedJuz'] as unknown[]) : null;
  const juzCount = juzList?.length;

  if (type === 'SANAD') {
    // The paper prints the juz's name beside its number (`Al-Maidah (Juz 5)`);
    // the download shows the same, not just the number.
    const juz = metaString(m, 'juz');
    const juzName = metaString(m, 'juzName');
    details.push(['Juz', juz ? (juzName ? `${juzName} (Juz ${juz})` : juz) : undefined]);
    details.push(['Pengajar', metaString(m, 'teacherName')]);
  } else if (
    type === 'TAHFIDZ' ||
    type === 'TAHFIDZ_30_JUZ' ||
    type === 'TAHFIDZ_5_JUZ' ||
    type === 'TAHFIDZ_10_JUZ' ||
    type === 'TAHFIDZ_JUZ_AMMA' ||
    type === 'SANAD_QIRAAH'
  ) {
    details.push(['Qira’ah', metaString(m, 'qiraahType')]);
    details.push(['Jumlah Juz', juzCount !== undefined ? `${juzCount} Juz` : undefined]);
    details.push(['Musyrif', metaString(m, 'musyrifName')]);
  }

  // The silsilah is long and belongs on its own labelled block, not the
  // two-column detail row, so it is appended as its own entry read by the
  // caller.
  details.push(['Silsilah Sanad', metaString(m, 'sanadChain')]);

  return details
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([label, value]) => ({ label, value }));
}

/**
 * Render a digital certificate to an A4 PDF.
 *
 * Portrait, matching the app's other printed pages; the QR below the signature
 * is scanned from paper. The verification URL is printed as text because the QR
 * image is generated by the client, not stored here.
 *
 * A description may run to 2,000 characters, so the body flows across pages and
 * the signature block owns the bottom of the last page — content stops above it
 * rather than being drawn through it, which is what the fixed `y` allowed.
 */
export async function generateCertificatePdfBuffer(input: CertificatePdfInput): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const ink = rgb(0.12, 0.12, 0.15);
  const muted = rgb(0.45, 0.45, 0.5);
  const margin = 56;
  const centerX = A4.width / 2;
  const maxWidth = A4.width - margin * 2;

  // The signature block is drawn from y=236 downward; the body stops a line
  // above it so a wrapped description can never run through the signature.
  const CONTENT_FLOOR = 236 + 18;
  const FIRST_PAGE_TOP = A4.height - 200;
  const NEXT_PAGE_TOP = A4.height - 120;

  let page = pdf.addPage([A4.width, A4.height]);
  let y = FIRST_PAGE_TOP;

  const centered = (
    text: string,
    atY: number,
    size: number,
    font = helv,
    color = ink,
    target = page
  ) => {
    const t = winAnsiSafe(text);
    target.drawText(t, {
      x: centerX - font.widthOfTextAtSize(t, size) / 2,
      y: atY,
      size,
      font,
      color,
    });
  };
  const ensureSpace = (needed: number) => {
    if (y - needed < CONTENT_FLOOR) {
      page = pdf.addPage([A4.width, A4.height]);
      y = NEXT_PAGE_TOP;
    }
  };

  centered('YAYASAN PESANTREN CIPANSOR', A4.height - 90, 13, bold, muted);
  centered(input.title, A4.height - 150, 22, bold);

  const studentName = input.student?.user?.name ?? '-';
  centered(studentName, y, 16, bold);
  y -= 26;
  const klass = input.student?.enrollments?.[0]?.class?.name;
  const unit = input.student?.unit?.name;
  const subtitle = [unit, klass].filter(Boolean).join(' · ');
  if (subtitle) {
    centered(subtitle, y, 11, helv, muted);
    y -= 24;
  }
  if (input.student?.nis) {
    centered(`NIS: ${input.student.nis}`, y, 11, helv, muted);
    y -= 24;
  }

  y -= 16;
  if (input.description) {
    for (const line of wrap(winAnsiSafe(input.description), helv, 12, maxWidth)) {
      ensureSpace(18);
      centered(line, y, 12);
      y -= 18;
    }
  }

  if (input.grade || input.rank) {
    y -= 10;
    ensureSpace(22);
    const bits: string[] = [];
    if (input.grade) bits.push(`Predikat: ${input.grade}`);
    if (input.rank) bits.push(`Peringkat: ${input.rank}`);
    centered(bits.join('   ·   '), y, 12, bold);
    y -= 22;
  }

  // The details the printed sanad/syahadah carries and the generic layout
  // cannot derive — juz, qira'ah, teacher, silsilah. Rendered from the mint
  // metadata so the downloaded file matches the document the issuer handed
  // over, not just the holder's name and grade. Values wrap to the content
  // width: a 30-juz list or a multi-generation chain is wider than A4, and a
  // single unwrapped line would run off both page edges.
  for (const { label, value } of certificateDetails(input)) {
    y -= 10;
    for (const line of wrap(winAnsiSafe(`${label}: ${value}`), helv, 11, maxWidth)) {
      ensureSpace(16);
      centered(line, y, 11, helv, muted);
      y -= 16;
    }
  }

  // Signature block, lower right of the last page's content column.
  const sigX = A4.width - margin;
  const sig = (text: string, atY: number, size: number, font = helv, color = ink) => {
    const t = winAnsiSafe(text);
    const width = font.widthOfTextAtSize(t, size);
    page.drawText(t, { x: sigX - width, y: atY, size, font, color });
  };
  const issueDate = input.issueDate instanceof Date ? input.issueDate : new Date(input.issueDate);
  sig(
    issueDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }),
    220,
    11,
    helv,
    muted
  );
  sig(input.signatoryName, 150, 13, bold);
  sig(input.signatoryTitle, 132, 11, helv, muted);

  const footer = `Nomor: ${input.certificateNumber}`;
  centered(footer, 84, 10, helv, muted);
  const verify = `Verifikasi: ${input.verificationUrl}`;
  centered(verify, 66, 9, helv, muted);

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}
