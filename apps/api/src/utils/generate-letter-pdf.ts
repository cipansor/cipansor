import type { Prisma } from '@prisma/client';
import { PDFDocument, PDFFont, PDFPage, StandardFonts, degrees, rgb } from 'pdf-lib';
import QRCode from 'qrcode';
import {
  DECIDING_OFFICIAL,
  LETTERHEAD,
  letterTemplateFor,
  natureMarking,
  siteConfig,
  signingAuthorityLines,
  SigningAuthorityForm as SharedSigningAuthorityForm,
  unitDocumentName,
  unitPermitLine,
  type LetterNature,
  type LetterType,
} from '@cipansor/shared';
import { LOGO_CIPANSOR_PNG_BASE64 } from '@/assets/logo-cipansor';
import { letterVerificationUrl } from '@/utils/verification-url';
import { stampIfTestCopy } from './test-copy-stamp';

/** "KETUA YAYASAN …" → "Ketua Yayasan …", as it is written under a signature. */
const DECIDING_OFFICIAL_TITLE_CASE = DECIDING_OFFICIAL.split(' ')
  .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
  .join(' ');

/**
 * The naskah dinas, rendered as a real PDF.
 *
 * Text stays text and images stay images. The web app used to hand
 * `html2canvas` output to `jsPDF.addImage`, so a downloaded letter was a single
 * flat PNG: nothing could be selected, searched, or indexed by the archive, a
 * screen reader got nothing, and — decisively — a raster page cannot carry a
 * meaningful PAdES signature. Everything here is drawn with `drawText`; the
 * only images are the lambang and the QR, which are images by nature.
 *
 * **Byte determinism is a contract, not a nicety.** `LetterSignature.pdfHash`
 * is a SHA-256 of these bytes, and public verification works by re-hashing an
 * uploaded PDF and looking the hash up. So the creation and modification dates
 * are pinned to epoch 0, the lambang is frozen in source rather than read from
 * disk or a URL, and no clock or locale outside the letter's own data may leak
 * into the output. Anything that changes the bytes retroactively invalidates
 * every letter signed before the change — they would be reported to the public
 * as altered. Treat a change here as a migration.
 */

/**
 * Revisi tata letak yang menghasilkan sebuah berkas.
 *
 * Disimpan bersama setiap naskah yang diarsipkan (`LetterSignedDocument`),
 * supaya byte lama yang tidak lagi dapat dibuat ulang tetap dapat dijelaskan:
 * build inilah yang membuatnya. **Naikkan nilainya pada commit yang sama dengan
 * perubahan apa pun yang mengubah keluaran** — kop surat, jarak baris, urutan
 * gambar, atau kenaikan versi `pdf-lib`.
 */
export const LETTER_PDF_GENERATOR = 'cipansor-naskah/2026-10-05a';

export class LetterPdfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LetterPdfError';
  }
}

export interface LetterPdfInput {
  id: string;
  letterNumber?: string | null;
  agendaNumber?: string | null;
  date: Date | string;
  type?: string | null;
  nature?: string | null;
  subject: string;
  content?: string | null;
  /**
   * Jalur penyusunan naskah, dan berkas unggahannya bila jalurnya `UPLOADED`.
   *
   * Dibaca jalur penyajian byte (`signed-pdf`) untuk memilih sumbernya: naskah
   * `GENERATED` disusun ulang sistem, naskah `UPLOADED` disajikan dari berkas
   * penyusunnya. `generateLetterPdfBuffer` sendiri tidak memakainya.
   */
  authoringTrack?: string | null;
  fileUrl?: string | null;
  senderName?: string | null;
  senderTitle?: string | null;
  recipientName?: string | null;
  recipientInstance?: string | null;
  unit?: {
    name?: string | null;
    /** Printed in place of `name` when recorded (`unitDocumentName`). */
    officialName?: string | null;
    npsn?: string | null;
    operatingPermitNumber?: string | null;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
  } | null;
  signatures?: Array<{
    verificationToken: string;
    signedAt: Date | string;
    revokedAt?: Date | string | null;
    signer?: { name: string } | null;
    /**
     * Garis kewenangan penandatanganan (a.n./u.b./Plt./Plh.). Ikut tercetak
     * pada blok tanda tangan, dan ikut ditandatangani — lihat
     * `@cipansor/shared/letter-signing-authority`.
     */
    signingAuthorityForm?: string | null;
    representedOffice?: string | null;
  }> | null;
  /** Berkas yang menyertai naskah; hanya jumlahnya yang tercetak. */
  attachments?: Array<{ name: string }> | null;
  /** Penerima naskah; yang `isCC` menjadi daftar tembusan di kaki naskah. */
  recipients?: Array<{
    isCC: boolean;
    order?: number | null;
    /** Tembusan ke pihak di luar sistem — nama ditulis penyusun. */
    externalName?: string | null;
    user?: { name: string } | null;
  }> | null;
}

/**
 * Relasi yang harus ikut terbaca setiap kali sebuah naskah dirender.
 *
 * Bukan kenyamanan, melainkan pengaman. Naskah yang sama dirender di dua jalur
 * — saat ditandatangani (`esign.service`) dan saat diunduh
 * (`correspondence/signed-pdf`) — dan hash byte-nyalah yang menjadi dasar
 * verifikasi publik. Kalau salah satu jalur lupa mengambil `attachments` atau
 * `recipients`, jalur itu mencetak naskah tanpa baris Lampiran dan tanpa blok
 * Tembusan, byte-nya berbeda, dan surat yang sah dilaporkan sebagai berubah.
 * Satu tempat, dipakai keduanya, supaya keduanya tidak dapat berselisih.
 */
export const LETTER_PDF_RELATIONS = {
  unit: true,
  attachments: { orderBy: { order: 'asc' } },
  // `unit` sengaja tidak diambil: kolom `unitId` pada baris penerima berisi unit
  // penerbit suratnya, bukan penerima, sehingga tidak ada yang dapat dicetak
  // darinya selain nama yayasan sendiri.
  recipients: {
    include: { user: { select: { name: true } } },
    orderBy: { order: 'asc' },
  },
} satisfies Prisma.LetterInclude;

const PAGE_WIDTH = 595.28; // A4
const PAGE_HEIGHT = 841.89;
const MARGIN_X = 40;
/** Nothing is drawn below this; the footer and page number live here. */
const BOTTOM_LIMIT = 56;
const BODY_SIZE = 10;
const LINE_HEIGHT = 14;

/**
 * The characters the PDF standard fonts can actually encode.
 *
 * `StandardFonts.TimesRoman` and its siblings are WinAnsi-encoded, and pdf-lib
 * throws when asked to draw anything outside that repertoire. Arabic is the
 * realistic case here — a pesantren letter may well quote the Qur'an — and
 * before this guard the throw was swallowed by a `try/catch` in the signing
 * path, producing a letter that was SIGNED but could never be verified.
 *
 * We refuse clearly instead of failing obscurely. Supporting Arabic properly
 * needs an embedded Unicode font *and* a shaping engine (pdf-lib does neither:
 * fontkit would embed the glyphs, but contextual joining and right-to-left
 * ordering would still be wrong), plus a build change to ship the font. That is
 * tracked separately — see `docs/EOFFICE_ESIGN_PLAN.md`.
 */
const WINANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ' + '‘’“”•–—˜™š›œžŸ');

function isEncodable(ch: string): boolean {
  const code = ch.codePointAt(0)!;
  if (code === 0x0a || code === 0x0d || code === 0x09) return true;
  if (code >= 0x20 && code <= 0x7e) return true;
  if (code >= 0xa0 && code <= 0xff) return true;
  return WINANSI_EXTRA.has(ch);
}

/** Distinct characters in `text` that the naskah font cannot render. */
/**
 * Ganti aksara yang tidak dapat dikodekan WinAnsi dengan tanda tanya.
 *
 * Dipakai HANYA pada keterangan pencabutan, bukan pada naskahnya. Sebuah naskah
 * yang memuat aksara di luar WinAnsi ditolak sejak awal (`assertRenderable`)
 * supaya penulisnya memperbaikinya — tetapi menolak mencetak cap pencabutan
 * karena alasannya memuat satu aksara asing akan meninggalkan surat yang sudah
 * dicabut beredar tanpa tanda apa pun. Di sini, tercetak dengan satu aksara
 * pengganti jauh lebih baik daripada tidak tercetak.
 */
function sanitizeForWinAnsi(text: string): string {
  return [...text].map((ch) => (isEncodable(ch) ? ch : '?')).join('');
}

function unsupportedCharacters(text: string): string[] {
  const bad = new Set<string>();
  for (const ch of text) if (!isEncodable(ch)) bad.add(ch);
  return [...bad];
}

/**
 * Nama-nama penerima tembusan, dalam urutan yang disusun penulisnya.
 *
 * Dua asal yang sama sahnya: seorang pengguna sistem, atau nama pihak luar yang
 * ditulis penyusun — Kepala KUA, Ketua RW, dinas terkait — yang tidak punya akun
 * di sini dan tetap harus tercetak. Baris tanpa nama sama sekali dilewati
 * daripada mencetak nomor urut yang kosong.
 *
 * `unit` bukan salah satunya, walau kolomnya ada: `LetterRecipient.unitId`
 * menyimpan unit *penerbit* surat, jadi memakainya akan mencetak nama yayasan
 * sendiri sebagai penerima tembusannya sendiri.
 *
 * Diurutkan di sini, bukan hanya di kueri, supaya pemanggil yang menyusun
 * datanya sendiri (uji, skrip) tetap mendapat daftar yang sama.
 */
function copyRecipients(letter: LetterPdfInput): string[] {
  return (letter.recipients ?? [])
    .filter((r) => r.isCC)
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((r) => r.user?.name?.trim() || r.externalName?.trim() || '')
    .filter((name) => name.length > 0);
}

/**
 * Bilangan kecil dalam huruf, untuk "Lampiran : 2 (dua) berkas".
 *
 * Tata naskah dinas menulis jumlah lampiran dengan angka *dan* huruf, dengan
 * alasan yang sama seperti pada kuitansi: satu angka mudah diubah setelah
 * naskah ditandatangani, dua bentuk yang harus cocok jauh lebih sulit. Cukup
 * sampai 99 — sebuah surat dengan seratus lampiran punya masalah lain.
 */
const SATUAN = [
  'nol',
  'satu',
  'dua',
  'tiga',
  'empat',
  'lima',
  'enam',
  'tujuh',
  'delapan',
  'sembilan',
  'sepuluh',
  'sebelas',
];

function spellOut(n: number): string {
  if (n < 12) return SATUAN[n];
  if (n < 20) return `${SATUAN[n - 10]} belas`;
  const puluh = Math.floor(n / 10);
  const sisa = n % 10;
  const head = `${SATUAN[puluh]} puluh`;
  return sisa ? `${head} ${SATUAN[sisa]}` : head;
}

function assertRenderable(letter: LetterPdfInput): void {
  const fields: Array<[string, string | null | undefined]> = [
    ['Perihal', letter.subject],
    ['Isi surat', letter.content],
    ['Penerima', letter.recipientName],
    ['Instansi penerima', letter.recipientInstance],
    ['Jabatan penanda tangan', letter.senderTitle],
    ['Nama pengirim', letter.senderName],
    // Nama tembusan ikut tercetak, jadi ia ikut diperiksa. Menolak di sini
    // menyebut bagian mana yang bermasalah; membiarkannya lolos berarti
    // pdf-lib yang melempar dari kedalaman, tanpa menyebut apa pun.
    ...copyRecipients(letter).map((name, i) => [`Tembusan ${i + 1}`, name] as [string, string]),
  ];

  const offenders = new Set<string>();
  const where: string[] = [];
  for (const [label, value] of fields) {
    if (!value) continue;
    const bad = unsupportedCharacters(value);
    if (bad.length) {
      bad.forEach((c) => offenders.add(c));
      where.push(label);
    }
  }

  if (offenders.size) {
    throw new LetterPdfError(
      `Naskah memuat karakter yang belum didukung pada PDF resmi (${where.join(', ')}): ` +
        `${[...offenders].join(' ')}. Aksara Arab dan simbol di luar Latin belum dapat ` +
        `dicetak pada naskah dinas. Ganti bagian tersebut dengan transliterasi Latin, ` +
        `atau sertakan sebagai lampiran gambar.`
    );
  }
}

/**
 * A cursor that spills onto a new page instead of dropping content.
 *
 * The previous version created exactly one page and stopped drawing at
 * `if (y < 120) break;`, so any letter longer than a page was silently
 * truncated — and the truncated render was what got hashed and signed. A
 * multi-article SK was cut off mid-way and still verified as authentic.
 */
class Cursor {
  readonly pages: PDFPage[] = [];
  page!: PDFPage;
  y = 0;

  constructor(private readonly doc: PDFDocument) {
    this.newPage(PAGE_HEIGHT - 40);
  }

  newPage(startY = PAGE_HEIGHT - 60): PDFPage {
    this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.pages.push(this.page);
    this.y = startY;
    return this.page;
  }

  /** Guarantee `height` points of room, breaking the page if necessary. */
  ensure(height: number): void {
    if (this.y - height < BOTTOM_LIMIT) this.newPage();
  }

  text(
    value: string,
    opts: { x: number; size?: number; font: PDFFont; color?: ReturnType<typeof rgb> }
  ): void {
    const size = opts.size ?? BODY_SIZE;
    this.ensure(size + 2);
    this.page.drawText(value, {
      x: opts.x,
      y: this.y,
      size,
      font: opts.font,
      color: opts.color ?? rgb(0, 0, 0),
    });
  }

  down(by = LINE_HEIGHT): void {
    this.y -= by;
  }
}

function wrapText(text: string, maxWidth: number, font: PDFFont, fontSize: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (font.widthOfTextAtSize(testLine, fontSize) <= maxWidth) {
      currentLine = testLine;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

export async function generateLetterPdfBuffer(letter: LetterPdfInput): Promise<Buffer> {
  assertRenderable(letter);

  const pdfDoc = await PDFDocument.create();

  // Fix dates to Epoch 0 for byte determinism — see the module comment.
  pdfDoc.setCreationDate(new Date(0));
  pdfDoc.setModificationDate(new Date(0));
  pdfDoc.setTitle(`Surat ${letter.letterNumber || letter.agendaNumber || 'Draft'}`);
  pdfDoc.setProducer('Cipansor E-Office');
  pdfDoc.setCreator('Cipansor E-Office');

  const fontTimes = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const fontTimesBold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
  const fontTimesItalic = await pdfDoc.embedFont(StandardFonts.TimesRomanItalic);

  const cur = new Cursor(pdfDoc);
  const width = PAGE_WIDTH;
  const centreOf = (text: string, font: PDFFont, size: number) =>
    width / 2 - font.widthOfTextAtSize(text, size) / 2;

  // ── Kop surat ────────────────────────────────────────────────────────────
  // The lambang is the one element that genuinely must be an image. Dropping it
  // when this generator replaced the browser render would have produced a kop
  // surat with no crest at all, which is not a letterhead.
  const logo = await pdfDoc.embedPng(Buffer.from(LOGO_CIPANSOR_PNG_BASE64, 'base64'));
  const logoHeight = 62;
  const logoWidth = (logo.width / logo.height) * logoHeight;
  cur.page.drawImage(logo, {
    x: MARGIN_X + 6,
    y: cur.y - logoHeight + 12,
    width: logoWidth,
    height: logoHeight,
  });

  /**
   * Nama yayasan di baris atas, nama unit penerbitnya di baris bawah.
   *
   * Untuk naskah yang terbit dari yayasan sendiri keduanya sama, dan kop surat
   * mencetak "YAYASAN PESANTREN CIPANSOR" dua kali bertumpuk. Baris unit
   * dilewati bila ia hanya mengulang baris di atasnya — kop surat sebuah unit
   * (MTs, TK Qur'an) tetap memakai dua baris sebagaimana mestinya.
   *
   * Yang dicetak adalah nama resmi unit — nama pada izin operasionalnya —
   * bila sudah dicatat, bukan nama pendek yang dipakai menu.
   */
  const orgName = LETTERHEAD.organisation;
  const rawUnitName = letter.unit?.name
    ? unitDocumentName({
        name: letter.unit.name,
        officialName: letter.unit.officialName,
      }).toUpperCase()
    : 'KANTOR YAYASAN';
  const unitName = rawUnitName === orgName ? null : rawUnitName;

  /**
   * Dasar hukum yayasan, dari kop surat aslinya.
   *
   * Sebelumnya baris ini berbunyi *"SK Kemenkumham RI No.
   * AHU-0012345.AH.01.04.Tahun 2020"* — dituliskan langsung di sini, dan
   * nomornya karangan: `0012345` adalah angka contoh, dan tahunnya pun bukan
   * tahun pengesahan yayasan ini. Artinya **setiap naskah dinas yang pernah
   * terbit dari sistem ini mencantumkan nomor badan hukum yang tidak ada.**
   *
   * Nilai yang benar sudah tersimpan sejak lama di `LETTERHEAD`, disalin dari
   * kop surat yang sungguh-sungguh dikeluarkan yayasan, dan berkas ini tidak
   * pernah membacanya. Tiga nilai berbeda hidup berdampingan: yang di sini,
   * yang di `LETTERHEAD`, dan nomor pengesahan Kemenkumham yang sah di halaman
   * legalitas publik (`AHU-3039.AH.01.04.Tahun 2022`). Yang dipakai naskah
   * sekarang adalah satu-satunya yang berasal dari dokumen.
   *
   * Alamat dan kontak cadangannya juga diambil dari sumber yang sama; nomor
   * telepon `0265-123456` yang lama adalah contoh, bukan nomor yayasan.
   *
   * Naskah sebuah unit mencetak dasar hukum unit itu sendiri — izin
   * operasional dan NPSN-nya — seperti kop surat unit yang sebenarnya (SMP IT:
   * "Izin Operasional No. 503/0671/… NPSN: 69988558"). Unit yang belum
   * mencatat keduanya, dan naskah yayasan, tetap mencetak akta yayasan.
   */
  const legalBasis =
    (unitName && letter.unit && unitPermitLine(letter.unit)) || LETTERHEAD.legalBasis;
  const address = letter.unit?.address ?? `${LETTERHEAD.addressLine1}, ${LETTERHEAD.addressLine2}`;
  const contact = `Website: ${LETTERHEAD.website} | ${LETTERHEAD.phone} | Email: ${letter.unit?.email || 'halo@cipansor.or.id'}`;

  if (unitName) {
    cur.text(orgName, { x: centreOf(orgName, fontTimesBold, 12), size: 12, font: fontTimesBold });
    cur.down(16);
    cur.text(unitName, { x: centreOf(unitName, fontTimesBold, 14), size: 14, font: fontTimesBold });
    cur.down(14);
  } else {
    cur.text(orgName, { x: centreOf(orgName, fontTimesBold, 14), size: 14, font: fontTimesBold });
    cur.down(16);
  }
  /**
   * Baris kecil di bawah nama dibungkus di dalam kolom antara lambang dan
   * cerminannya di kanan. Alamat pada izin operasional lebih panjang daripada
   * alamat yang dipakai ketika tata letak ini dibuat, dan barisnya menabrak
   * lambang. Baris yang muat tetap dicetak persis seperti sebelumnya.
   */
  const headColumn = width - 2 * (MARGIN_X + 6 + logoWidth + 6);
  const headLines = (text: string, font: PDFFont, after: number) => {
    const lines = wrapText(text, headColumn, font, 8);
    lines.forEach((line, i) => {
      cur.text(line, {
        x: centreOf(line, font, 8),
        size: 8,
        font,
        color: rgb(0.2, 0.2, 0.2),
      });
      cur.down(i === lines.length - 1 ? after : 10);
    });
  };
  headLines(legalBasis, fontTimesItalic, 12);
  headLines(address, fontTimes, 12);
  headLines(contact, fontTimes, 14);

  cur.page.drawLine({
    start: { x: MARGIN_X, y: cur.y },
    end: { x: width - MARGIN_X, y: cur.y },
    thickness: 2,
    color: rgb(0, 0, 0),
  });
  cur.down(4);
  cur.page.drawLine({
    start: { x: MARGIN_X, y: cur.y },
    end: { x: width - MARGIN_X, y: cur.y },
    thickness: 0.5,
    color: rgb(0, 0, 0),
  });
  cur.down(25);

  const type = ((letter.type as LetterType) || 'SURAT_DINAS') as LetterType;
  const template = letterTemplateFor(type);
  const isDecree = template.decree === true;
  const marking = natureMarking(letter.nature as LetterNature);

  const dateStr = new Date(letter.date).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  });
  const numberStr = letter.letterNumber || letter.agendaNumber || 'DRAFT';

  /**
   * Naskah dinas is not one shape.
   *
   * `template.title` decides whether the type is announced as a centred heading
   * above the number; `template.addressed` decides whether the naskah carries
   * "Kepada Yth." and closes "Hormat Kami,". They are separate axes — an
   * undangan is titled *and* addressed, a surat keterangan is titled and
   * addressed to no one, a surat dinas is neither. This mirrors
   * `letter-pdf-template.tsx` on purpose: the PDF that gets signed must be the
   * same naskah the staff approved on screen, or the signature attests to a
   * document nobody reviewed.
   */

  // "TERBATAS" / "RAHASIA" / "SANGAT RAHASIA" — a Biasa letter is left unmarked,
  // because stamping every letter drains the meaning from the ones that matter.
  if (marking) {
    cur.text(marking, {
      x: width - MARGIN_X - fontTimesBold.widthOfTextAtSize(marking, 11),
      size: 11,
      font: fontTimesBold,
    });
    cur.down(18);
  }

  if (template.title) {
    cur.text(template.title.toUpperCase(), {
      x: centreOf(template.title.toUpperCase(), fontTimesBold, 13),
      size: 13,
      font: fontTimesBold,
    });
    cur.down(16);

    const nomor = `Nomor: ${numberStr}`;
    cur.text(nomor, { x: centreOf(nomor, fontTimes, BODY_SIZE), font: fontTimes });
    cur.down(18);

    // "Tentang" carries the actual subject of a keputusan, edaran or
    // pengumuman — the type alone never says what was decided.
    if (template.subjectHeading && letter.subject) {
      cur.text('Tentang', { x: centreOf('Tentang', fontTimes, BODY_SIZE), font: fontTimes });
      cur.down();
      const pokok = letter.subject.toUpperCase();
      for (const line of wrapText(pokok, width - MARGIN_X * 4, fontTimesBold, 11)) {
        cur.text(line, { x: centreOf(line, fontTimesBold, 11), size: 11, font: fontTimesBold });
        cur.down();
      }
      cur.down(10);
    }

    // The office that decides, standing alone before the considerans.
    if (isDecree) {
      cur.text(DECIDING_OFFICIAL, {
        x: centreOf(DECIDING_OFFICIAL, fontTimesBold, 11),
        size: 11,
        font: fontTimesBold,
      });
      cur.down(20);
    }
  } else {
    cur.text(`Nomor     : ${numberStr}`, { x: MARGIN_X, font: fontTimes });
    cur.page.drawText(`${LETTERHEAD.city}, ${dateStr}`, {
      x: width - 180,
      y: cur.y,
      size: BODY_SIZE,
      font: fontTimes,
    });
    cur.down();
    /**
     * Berapa berkas yang menyertai naskah ini.
     *
     * Selalu "-" sebelumnya, apa pun keadaannya — dan tidak ada tempat untuk
     * mencatat lampiran, jadi "-" selalu benar secara kebetulan. Baris ini ada
     * justru supaya penerima tahu apa yang seharusnya ia terima: surat yang
     * menyatakan dua lampiran dan sampai tanpa keduanya adalah surat yang
     * kekurangannya dapat dibuktikan.
     *
     * Naskah tanpa lampiran mencetak persis kalimat yang sama seperti dahulu,
     * sehingga byte setiap surat yang sudah ditandatangani tidak berubah —
     * lihat uji "naskah tanpa lampiran dan tanpa tembusan" di berkas ujinya.
     */
    const lampiranCount = (letter.attachments ?? []).length;
    cur.text(
      lampiranCount === 0
        ? 'Lampiran : -'
        : `Lampiran : ${lampiranCount} (${spellOut(lampiranCount)}) berkas`,
      { x: MARGIN_X, font: fontTimes }
    );
    cur.down();
    cur.text(`Perihal   : ${letter.subject}`, { x: MARGIN_X, font: fontTimesBold });
    cur.down(25);
  }

  if (template.addressed) {
    const recipient = letter.recipientName || letter.recipientInstance || 'Bapak/Ibu';
    cur.text('Kepada Yth.', { x: MARGIN_X, font: fontTimes });
    cur.down();
    cur.text(recipient, { x: MARGIN_X, font: fontTimesBold });
    cur.down();
    cur.text('di Tempat', { x: MARGIN_X, font: fontTimes });
    cur.down(30);
  }

  // ── Body ─────────────────────────────────────────────────────────────────
  const contentMaxWidth = width - MARGIN_X * 2;
  /**
   * Baris tunggal adalah baris, bukan spasi.
   *
   * Sebelumnya hanya baris kosong ganda yang memisahkan alinea, dan setiap
   * pergantian baris tunggal di dalamnya menjadi satu spasi belaka. Blok data
   * yang ditulis penyusunnya sebagai
   *
   *     Nama            : …
   *     Tempat/Tgl Lahir: …
   *     Nomor Induk     : …
   *
   * — bentuk yang ada di hampir setiap surat keterangan — tercetak berdempet
   * menjadi satu paragraf panjang yang tidak terbaca. Sekarang alinea tetap
   * dipisah oleh baris kosong, dan di dalam alinea setiap baris berdiri sendiri.
   */
  const paragraphs = (letter.content || '')
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+$/gm, ''))
    .filter((p) => p.trim().length > 0);

  for (const para of paragraphs) {
    // "MEMUTUSKAN" stands alone and centred, separating the considerans from
    // the diktum. Recognised from the author's own paragraph rather than
    // injected, so the content stays one editable text.
    if (isDecree && /^MEMUTUSKAN:?$/i.test(para)) {
      const word = para.toUpperCase();
      cur.down(6);
      cur.text(word, { x: centreOf(word, fontTimesBold, 11), size: 11, font: fontTimesBold });
      cur.down(20);
      continue;
    }
    for (const sourceLine of para.split('\n')) {
      if (!sourceLine.trim()) {
        cur.down();
        continue;
      }
      for (const line of wrapText(sourceLine, contentMaxWidth, fontTimes, BODY_SIZE)) {
        cur.text(line, { x: MARGIN_X, font: fontTimes });
        cur.down();
      }
    }
    cur.down(8);
  }

  // ── Signature block ──────────────────────────────────────────────────────
  const activeSignature = (letter.signatures || []).filter((s) => !s.revokedAt).slice(-1)[0];
  // Reserve the whole block so it can never be split across pages or land on
  // top of the body: date + org + title + QR + captions + name.
  cur.ensure(activeSignature ? 200 : 150);
  cur.down(20);

  const rightAlignX = width - 220;

  /**
   * Garis kewenangan (a.n./u.b./Plt./Plh.), bila naskah ditandatangani dengan
   * salah satunya.
   *
   * Ia **bukan** hiasan: ia menyatakan dari mana wewenang penanda tangan
   * berasal, dan karena itu ikut ditandatangani (`canonicalPayload`) —
   * mengubahnya setelah penandatanganan membatalkan tanda tangannya.
   *
   * Dihitung **hanya** untuk bentuk selain NONE. Bentuk NONE (bawaan, dan
   * keadaan hampir semua naskah) mencetak blok yang persis sama seperti
   * sebelumnya: nama yayasan lalu jabatan pengirim. `signingAuthorityLines`
   * mengembalikan `[jabatan,]` untuk NONE selama ada `senderTitle`, dan
   * memakainya di sini akan menghapus nama yayasan dari setiap surat biasa —
   * karena itu bentuk NONE tidak pernah sampai ke sana.
   */
  const authorityForm = (activeSignature?.signingAuthorityForm ?? 'NONE') as unknown as
    SharedSigningAuthorityForm | undefined;
  const authorityLines =
    activeSignature && authorityForm && authorityForm !== SharedSigningAuthorityForm.NONE
      ? signingAuthorityLines({
          form: authorityForm,
          representedOffice: activeSignature.representedOffice,
          signerOffice: letter.senderTitle,
        })
      : [];
  const printAuthorityLines = () => {
    for (const line of authorityLines) {
      cur.text(sanitizeForWinAnsi(line), { x: rightAlignX, font: fontTimes });
      cur.down();
    }
  };

  if (isDecree) {
    // A keputusan records where it was *established*, not where a letter was
    // written, so it never closes "Tasikmalaya, <tanggal>" like a surat.
    cur.text(`Ditetapkan di : ${LETTERHEAD.city}`, { x: rightAlignX, font: fontTimes });
    cur.down();
    cur.text(`Pada tanggal  : ${dateStr}`, { x: rightAlignX, font: fontTimes });
    cur.down();
    if (authorityLines.length > 0) {
      printAuthorityLines();
    } else {
      cur.text(DECIDING_OFFICIAL_TITLE_CASE, { x: rightAlignX, font: fontTimes });
      cur.down();
    }
  } else if (template.addressed) {
    cur.text('Hormat Kami,', { x: rightAlignX, font: fontTimes });
    cur.down();
    // Surat alamat tidak pernah mencetak nama yayasan; hanya garis
    // kewenangannya, bila penanda tangan memilih salah satunya.
    if (authorityLines.length > 0) printAuthorityLines();
  } else {
    cur.text(`${LETTERHEAD.city}, ${dateStr}`, { x: rightAlignX, font: fontTimes });
    cur.down();

    if (authorityLines.length > 0) {
      printAuthorityLines();
    } else {
      cur.text(siteConfig.legalName, { x: rightAlignX, font: fontTimes });
      cur.down();
      if (letter.senderTitle) {
        cur.text(letter.senderTitle, { x: rightAlignX, font: fontTimes });
        cur.down();
      }
    }
  }

  if (activeSignature) {
    /**
     * Yang disandikan QR adalah **alamat halaman verifikasi**, bukan tokennya.
     *
     * Sebelumnya isinya token mentah — sebuah untai acak. Memindainya tidak
     * membuka apa pun: pembaca mendapat teks tak berarti dari sebuah kode yang
     * seluruh penampilannya menjanjikan sesuatu akan terbuka. Itu lebih buruk
     * daripada tidak ada QR sama sekali, sebab ia tampak dapat dipindai dan
     * tidak.
     *
     * Tanpa token di dalam tautannya, juga disengaja. Halaman itu memeriksa
     * berkas yang diunggah; tautan bertoken hanya dapat menjawab "ada surat
     * yang pernah ditandatangani", bukan "surat yang Anda pegang inilah surat
     * itu" — celah yang justru menjadi alasan halaman verifikasi berbasis token
     * dihapus (§1 rencana). Yang dituju pemindai adalah tempat ia menyerahkan
     * berkasnya, dan itulah yang diberikan.
     *
     * Koreksi galat H (~30%) dipilih supaya lambang yayasan boleh menutup
     * bagian tengahnya tanpa membuat kodenya gagal dibaca.
     */
    const qrBuffer = await QRCode.toBuffer(letterVerificationUrl(), {
      type: 'png',
      margin: 1,
      width: 300,
      errorCorrectionLevel: 'H',
    });
    const qrImage = await pdfDoc.embedPng(qrBuffer);
    const qrSize = 65;
    const qrX = rightAlignX + 20;
    const qrY = cur.y - qrSize;
    cur.page.drawImage(qrImage, { x: qrX, y: qrY, width: qrSize, height: qrSize });

    // Lambang yayasan di tengah kodenya — bentuk yang lazim dipakai instansi,
    // dan yang membuat naskah dikenali sebagai naskah yayasan sekali lihat.
    // Ukurannya dijaga di bawah seperlima sisi kode agar tetap di dalam
    // toleransi koreksi galat H, dengan alas putih supaya tepinya tidak
    // bercampur dengan modul-modul gelap di sekelilingnya.
    const badge = qrSize * 0.22;
    cur.page.drawRectangle({
      x: qrX + (qrSize - badge) / 2 - 1.5,
      y: qrY + (qrSize - badge) / 2 - 1.5,
      width: badge + 3,
      height: badge + 3,
      color: rgb(1, 1, 1),
    });
    cur.page.drawImage(logo, {
      x: qrX + (qrSize - badge) / 2,
      y: qrY + (qrSize - badge) / 2,
      width: badge,
      height: badge,
    });
    cur.down(72);

    // Hanya keterangan cara penandatanganan — tanggalnya tidak diulang di sini.
    // Naskah sudah memuat tanggalnya sekali, di kepala surat atau pada kaki
    // "Pada tanggal", dan mencetaknya dua kali dengan format berbeda membuat
    // pembaca bertanya mana yang berlaku.
    cur.text('Ditandatangani secara elektronik', {
      x: rightAlignX,
      size: 7,
      font: fontTimesItalic,
      color: rgb(0.3, 0.3, 0.3),
    });
    cur.down(12);
  } else {
    cur.down(50); // room for a wet signature
  }

  /**
   * Nama penanda tangan saja — NIP tidak dicetak.
   *
   * Pedoman visualisasi tanda tangan elektronik menyatakan visualisasinya tidak
   * memuat data pribadi seperti pindaian tanda tangan, NIP, atau NIK; dan bagi
   * yayasan ini nomor induk pegawai memang keterangan internal, bukan bagian
   * dari naskah yang beredar ke luar. Sebuah naskah dinas tidak menjadi lebih
   * sah karena mencantumkannya, tetapi setiap lembar yang beredar menjadi satu
   * salinan lagi dari nomor kepegawaian seseorang.
   *
   * Ini mengubah byte naskah bagi penanda tangan yang punya NIP. Byte yang
   * sudah ditandatangani tetap aman karena diarsipkan utuh (PR-3) — tetapi
   * naskah lama semacam itu tidak lagi dapat dibuat ulang secara identik, jadi
   * `db:archive-letters` harus dijalankan **sebelum** perubahan ini diterapkan
   * ke produksi.
   */
  const signerName =
    activeSignature?.signer?.name || letter.senderName || '.........................';

  cur.text(signerName, { x: rightAlignX, font: fontTimesBold });
  cur.down(12);

  // ── Tembusan ─────────────────────────────────────────────────────────────
  /**
   * Siapa saja yang menerima salinan naskah ini.
   *
   * Unsur baku naskah dinas, di kaki kiri halaman terakhir, di bawah blok
   * tanda tangan — bukan di atasnya, karena tembusan adalah keterangan
   * peredaran, bukan bagian dari isi yang ditandatangani. Kolom `isCC` sudah
   * ada sejak awal dan tidak pernah diisi apa pun selain `false`, sehingga
   * penyusun yang perlu mencantumkan tembusan menuliskannya di badan surat, di
   * mana tidak ada satu pun bagian sistem yang dapat membacanya.
   *
   * Seluruh daftar dijamin muat dalam satu halaman sebelum baris pertamanya
   * digambar: daftar tembusan yang terpotong di antara dua halaman membuat
   * pembaca menyangka salinannya berhenti di situ.
   */
  const copies = copyRecipients(letter);
  if (copies.length > 0) {
    cur.ensure(26 + copies.length * 13);
    cur.down(18);
    cur.text('Tembusan:', { x: MARGIN_X, size: 9, font: fontTimesBold });
    cur.down(13);
    copies.forEach((name, i) => {
      cur.text(`${i + 1}. ${name}`, { x: MARGIN_X, size: 9, font: fontTimes });
      cur.down(13);
    });
  }

  // ── Footers ──────────────────────────────────────────────────────────────
  const total = cur.pages.length;
  if (total > 1) {
    cur.pages.forEach((p, i) => {
      const label = `Halaman ${i + 1} dari ${total}`;
      p.drawText(label, {
        x: width / 2 - fontTimes.widthOfTextAtSize(label, 7) / 2,
        y: 30,
        size: 7,
        font: fontTimes,
        color: rgb(0.4, 0.4, 0.4),
      });
    });
  }

  if (activeSignature) {
    // Alamat yang sama dengan yang disandikan QR, dari satu tempat — supaya
    // yang dibaca mata dan yang dibaca pemindai tidak dapat berselisih.
    const verifyUrlText = `Verifikasi keaslian: ${letterVerificationUrl()}`;
    cur.pages[total - 1].drawText(verifyUrlText, {
      x: MARGIN_X,
      y: 30,
      size: 7,
      font: fontTimesItalic,
      color: rgb(0.4, 0.4, 0.4),
    });
  }

  await stampIfTestCopy(pdfDoc);
  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

/**
 * Cap "DICABUT" pada salinan naskah yang sudah dicabut.
 *
 * Bukan menolak mencetaknya. Kantor tetap perlu mengarsipkan salinannya, dan
 * penerima yang sudah memegang surat itu berhak mendapat lembar yang menjelaskan
 * dirinya sendiri; platform tanda tangan elektronik pun begitu — DocuSign
 * membubuhkan watermark VOID dan tetap membiarkan dokumennya diunduh.
 *
 * Yang dibubuhkan cap adalah **salinan**, bukan berkas yang ditandatangani.
 * Pemanggilnya wajib lebih dulu membuktikan bahwa naskah yang dihasilkan ulang
 * masih sama persis dengan yang di-hash saat penandatanganan (lihat
 * `correspondence.controller.ts`), sehingga salinan yang telanjur beredar tetap
 * terverifikasi dan tetap dilaporkan sebagai dicabut, bukan sebagai palsu.
 */
export async function stampRevoked(
  pdfBuffer: Buffer,
  revocation: { reason: string; revokedAt: Date; revokedByName?: string | null }
): Promise<Buffer> {
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdfDoc.embedFont(StandardFonts.TimesRomanItalic);

  const stampedOn = revocation.revokedAt.toISOString().slice(0, 10);
  const foot = sanitizeForWinAnsi(
    `DICABUT ${stampedOn}${revocation.revokedByName ? ` oleh ${revocation.revokedByName}` : ''} — ${revocation.reason}`
  );

  for (const page of pdfDoc.getPages()) {
    const { width, height } = page.getSize();
    const label = 'DICABUT';
    const size = 92;
    const textWidth = bold.widthOfTextAtSize(label, size);

    // Melintang, di belakang teksnya, cukup pucat untuk tetap terbaca isinya
    // dan cukup jelas untuk tidak mungkin terlewat.
    page.drawText(label, {
      x: width / 2 - (textWidth * Math.cos(Math.PI / 6)) / 2,
      y: height / 2 - (textWidth * Math.sin(Math.PI / 6)) / 2,
      size,
      font: bold,
      color: rgb(0.85, 0.35, 0.25),
      opacity: 0.22,
      rotate: degrees(30),
    });

    // Keterangan kaki: watermark mengatakan "dicabut", baris ini mengatakan
    // sejak kapan dan mengapa — yang justru dicari pembacanya.
    const footSize = 7;
    let line = foot;
    while (italic.widthOfTextAtSize(line, footSize) > width - 2 * 40 && line.length > 12) {
      line = `${line.slice(0, -4)}…`;
    }
    page.drawText(line, {
      x: 40,
      y: 18,
      size: footSize,
      font: italic,
      color: rgb(0.7, 0.2, 0.15),
    });
  }

  pdfDoc.setCreationDate(new Date(0));
  pdfDoc.setModificationDate(new Date(0));
  return Buffer.from(await pdfDoc.save());
}

/**
 * Visualisasi tanda tangan elektronik pada naskah yang diunggah penyusunnya.
 *
 * Naskah dengan jalur penyusunan `UPLOADED` disusun di luar sistem — di Word,
 * di LibreOffice — lalu diunggah sebagai PDF. Yang ditandatangani, di-hash,
 * diarsipkan, dan dicocokkan pada verifikasi publik adalah **byte unggahan
 * itu**, bukan hasil render sistem.
 *
 * **Visualisasinya diletakkan pada lembar tersendiri di akhir naskah**, bukan
 * dicap ke atas halaman terakhir penyusunnya. Sebelumnya cap digambar langsung
 * ke halaman terakhir pada posisi tetap di kanan-bawah, dan tata letak naskah
 * unggahan tidak kita ketahui: satu instruksi pembayaran atau tanda tangan
 * basah di sudut itu tertimpa kode QR, dan salinan yang tertimpa itulah yang
 * ditandatangani serta diarsipkan. Lembar tersendiri membuat tumpang tindih
 * mustahil — tidak ada satu titik pun di sana yang berasal dari naskah
 * penyusunnya.
 *
 * Yang dicetak pada lembar itu:
 *
 * - **Kode QR** menuju halaman verifikasi publik, sama seperti pada naskah
 *   GENERATED, dengan lambang yayasan di tengahnya.
 * - **Keterangan** "Ditandatangani secara elektronik" beserta nama dan jabatan
 *   penanda tangan. NIP tidak dicetak, dengan alasan yang sama seperti pada
 *   naskah GENERATED: pedoman visualisasi TTE menyatakan visualisasinya tidak
 *   memuat NIP/NIK.
 *
 * Yang **tidak** dicetak: garis kewenangan (a.n./u.b./Plt./Plh.) dan tembusan.
 * Keduanya bagian dari tata letak naskah yang disusun penyusunnya sendiri, dan
 * mencetaknya lagi di sini akan menggandakannya. Nilainya tetap ikut
 * ditandatangani dan tetap terbaca di halaman verifikasi publik.
 *
 * Byte keluaran ini yang menjadi dasar hash dan arsip. Naskah penyusunnya
 * tidak diubah sedikit pun; yang ditambahkan hanya satu halaman di akhir.
 */
export async function stampSignatureVisualisation(
  pdfBuffer: Buffer,
  input: {
    signedAt: Date | string;
    signerName?: string | null;
    signerTitle?: string | null;
  }
): Promise<Buffer> {
  let pdfDoc: PDFDocument;
  try {
    pdfDoc = await PDFDocument.load(pdfBuffer);
  } catch {
    /**
     * Naskah yang tidak dapat dibuka tidak dapat dicap, dan tidak dapat
     * ditandatangani: yang ditandatangani adalah byte yang dapat dibaca ulang
     * oleh pemverifikasi. PDF terenkripsi dan berkas yang rusak jatuh di sini.
     * Diterjemahkan ke `LetterPdfError` supaya pemanggil menjawab 400 dengan
     * sebabnya, bukan 500.
     */
    throw new LetterPdfError(
      'Berkas naskah yang diunggah tidak dapat dibuka sebagai PDF (mungkin terproteksi ' +
        'kata sandi atau rusak). Perbaiki berkasnya lalu unggah ulang sebelum ditandatangani.'
    );
  }

  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdfDoc.embedFont(StandardFonts.TimesRomanItalic);

  const qrBuffer = await QRCode.toBuffer(letterVerificationUrl(), {
    type: 'png',
    margin: 1,
    width: 300,
    errorCorrectionLevel: 'H',
  });
  const qrImage = await pdfDoc.embedPng(qrBuffer);
  const logo = await pdfDoc.embedPng(Buffer.from(LOGO_CIPANSOR_PNG_BASE64, 'base64'));

  const qrSize = 132;
  const margin = MARGIN_X;
  const width = PAGE_WIDTH;
  const height = PAGE_HEIGHT;
  const pages = pdfDoc.getPages();
  if (pages.length === 0) {
    throw new LetterPdfError('Berkas naskah yang diunggah tidak memuat satu halaman pun.');
  }

  /**
   * Lembar tersendiri, bukan cap di atas halaman terakhir penyusun.
   *
   * Sampai sekarang cap TTE digambar langsung ke halaman terakhir pada posisi
   * tetap di kanan-bawah. Naskah unggahan tata letaknya milik penyusunnya dan
   * tidak kita ketahui: satu instruksi pembayaran, tanda tangan basah, atau
   * catatan kaki di sudut itu akan tertimpa kode QR — dan salinan yang tertimpa
   * itulah yang ditandatangani, diarsipkan, dan diserahkan. Memilih posisi
   * "yang paling kecil kemungkinannya menimpa isi" tetap sebuah tebakan, dan
   * tebakan yang salah merusak naskah resmi tanpa jejak.
   *
   * Menambahkan halaman membuat tumpang tindih itu mustahil: tidak ada satu pun
   * titik pada lembar ini yang berasal dari naskah penyusunnya, jadi tidak ada
   * yang dapat tertutup. Yang perlu dijaga tinggal bahwa halaman tambahan itu
   * tidak menyisipkan apa pun ke tengah naskah — ia selalu di **akhir**, dan
   * byte-nya tetap deterministik agar hash-nya dapat diverifikasi ulang.
   */
  const page = pdfDoc.addPage([width, height]);

  // Bingkai tipis: menandai lembar ini sebagai terbitan sistem, bukan naskah
  // penyusunnya.
  page.drawRectangle({
    x: margin / 2,
    y: margin / 2,
    width: width - margin,
    height: height - margin,
    borderColor: rgb(0.8, 0.8, 0.8),
    borderWidth: 0.7,
  });

  const heading = sanitizeForWinAnsi('LEMBAR VISUALISASI TANDA TANGAN ELEKTRONIK');
  const headingSize = 11;
  page.drawText(heading, {
    x: (width - bold.widthOfTextAtSize(heading, headingSize)) / 2,
    y: height - 96,
    size: headingSize,
    font: bold,
    color: rgb(0.15, 0.15, 0.15),
  });
  page.drawLine({
    start: { x: margin, y: height - 112 },
    end: { x: width - margin, y: height - 112 },
    thickness: 0.7,
    color: rgb(0.75, 0.75, 0.75),
  });

  const qrX = (width - qrSize) / 2;
  const qrY = height - 112 - 48 - qrSize;
  page.drawImage(qrImage, { x: qrX, y: qrY, width: qrSize, height: qrSize });

  // Lambang yayasan di tengah kode, dengan alas putih, sama seperti pada naskah
  // GENERATED — bentuk yang membuat cap ini dikenali sebagai cap yayasan.
  const badge = qrSize * 0.22;
  page.drawRectangle({
    x: qrX + (qrSize - badge) / 2 - 2,
    y: qrY + (qrSize - badge) / 2 - 2,
    width: badge + 4,
    height: badge + 4,
    color: rgb(1, 1, 1),
  });
  page.drawImage(logo, {
    x: qrX + (qrSize - badge) / 2,
    y: qrY + (qrSize - badge) / 2,
    width: badge,
    height: badge,
  });

  const caption = sanitizeForWinAnsi('Ditandatangani secara elektronik');
  const name = input.signerName ? sanitizeForWinAnsi(input.signerName) : null;
  const title = input.signerTitle ? sanitizeForWinAnsi(input.signerTitle) : null;
  const signedOn = new Date(input.signedAt).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  });

  const centerLine = (text: string, font: PDFFont, size: number, y: number) => {
    // Terpusat, dipangkas bila melebihi lebar halaman.
    let line = text;
    while (font.widthOfTextAtSize(line, size) > width - 2 * margin && line.length > 12) {
      line = `${line.slice(0, -4)}…`;
    }
    page.drawText(line, {
      x: (width - font.widthOfTextAtSize(line, size)) / 2,
      y,
      size,
      font,
      color: rgb(0.25, 0.25, 0.25),
    });
  };

  let captionY = qrY - 26;
  centerLine(caption, italic, 9, captionY);
  captionY -= 18;
  if (name) {
    centerLine(name, bold, 12, captionY);
    captionY -= 18;
  }
  if (title) {
    centerLine(title, italic, 9, captionY);
    captionY -= 14;
  }
  centerLine(signedOn, italic, 9, captionY);

  const explanation = [
    'Lembar ini diterbitkan sistem sebagai visualisasi tanda tangan elektronik.',
    'Pindai kode QR, atau buka halaman verifikasi lalu unggah berkas PDF ini,',
    'untuk memeriksa keaslian naskah dan status tanda tangannya.',
  ];
  let explanationY = 180;
  for (const line of explanation) {
    centerLine(sanitizeForWinAnsi(line), italic, 8, explanationY);
    explanationY -= 12;
  }

  /**
   * Salinan uji ikut dicap di sini, bukan hanya pada naskah GENERATED.
   *
   * `generateLetterPdfBuffer` mencap hasil rendernya, tetapi naskah unggahan
   * melewati fungsi itu: byte-nya datang dari berkas penyusun, dan yang kita
   * tambahkan hanya lembar visualisasi. Tanpa cap di sini, sebuah naskah
   * unggahan yang ditandatangani di staging terarsip resmi tanpa tanda
   * "SALINAN UJI" — persis yang hendak dicegah oleh sakelar itu. Cap dipasang
   * atas seluruh naskah (halaman penyusun dan lembar visualisasi) sebelum byte
   * di-hash, sehingga tak ada salinan yang lolos tanpa tanda.
   */
  await stampIfTestCopy(pdfDoc);

  // Tanggal pembuatan dikosongkan supaya byte-nya tidak berubah karena waktu
  // render — sama seperti `stampRevoked`. Hash-nya dihitung atas byte ini.
  pdfDoc.setCreationDate(new Date(0));
  pdfDoc.setModificationDate(new Date(0));
  return Buffer.from(await pdfDoc.save());
}
