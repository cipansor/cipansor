import crypto from 'node:crypto';
import { DocumentParseRequest, DocumentOcrResult } from '@cipansor/shared';
import engData from '@tesseract.js-data/eng';

export type DocumentParseResult = DocumentOcrResult;

/** Reads the text out of an image. Injected in tests so comparison logic is
 *  exercised without a real OCR run; production uses Tesseract.js (WASM). */
export type OcrTextReader = (image: Buffer) => Promise<string>;

export interface ParseDocumentDeps {
  /** Test seam: replace the OCR engine. */
  readText?: OcrTextReader;
  /** Test seam: override `SPMB_OCR_ENABLED`. */
  enabled?: boolean;
}

const OCR_ENABLED_FLAG = 'SPMB_OCR_ENABLED';
const IMAGE_DATA_URI = /^data:image\/(jpeg|jpg|png|webp);base64,/i;
const PDF_DATA_URI = /^data:application\/pdf;base64,/i;
const MAX_IMAGE_BYTES = 2_800_000;

const MANUAL_NOTE =
  'Berkas foto/PDF tidak dipindai otomatis (OCR visual tidak tersedia). Dokumen akan diverifikasi manual oleh petugas panitia SPMB.';
const ENGINE_NOTE =
  'Isi dokumen dibaca mesin di sistem yayasan sendiri (tanpa pihak ketiga). Hasil ini menandai kecocokan isian, bukan bukti keaslian — keputusan tetap di tangan petugas.';
const PDF_NOTE =
  'Berkas PDF belum dibaca mesin. Dokumen akan diverifikasi manual oleh petugas panitia SPMB.';
const OCR_FAILED_NOTE =
  'Pembacaan dokumen otomatis gagal. Dokumen akan diverifikasi manual oleh petugas panitia SPMB.';

function ocrEnabled(deps?: ParseDocumentDeps): boolean {
  return deps?.enabled ?? process.env[OCR_ENABLED_FLAG] === 'true';
}

function decodeBase64(imageBase64: string): Buffer {
  return Buffer.from(imageBase64.replace(/^data:[^;]+;base64,/, ''), 'base64');
}

function sha256Hex(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function looksLikeImage(buffer: Buffer): boolean {
  const png = buffer[0] === 0x89 && buffer[1] === 0x50;
  const jpeg = buffer[0] === 0xff && buffer[1] === 0xd8;
  const webp = buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46;
  return png || jpeg || webp;
}

function looksLikePdf(buffer: Buffer): boolean {
  return buffer.subarray(0, 4).toString('latin1') === '%PDF';
}

/**
 * The real OCR engine: Tesseract.js compiled to WebAssembly, reading the
 * traineddata bundled in `@tesseract.js-data/eng` so no image (and no request)
 * leaves this deployment. A worker is created per call and terminated after;
 * the endpoint's rate limit caps how many can run at once. The 2026-11-25 spike
 * on `node:26-alpine` measured ~0.4–0.6 s/page and ~205 MB peak RSS.
 */
async function tesseractReadText(image: Buffer): Promise<string> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker(engData.code, 1, {
    langPath: engData.langPath,
    gzip: engData.gzip,
    // The traineddata is already a local file; caching it again would drop a
    // 14 MB `eng.traineddata` into the process CWD.
    cacheMethod: 'none',
    logger: () => {},
  });
  try {
    const { data } = await worker.recognize(image);
    return data.text ?? '';
  } finally {
    await worker.terminate();
  }
}

const norm = (s: string): string =>
  s
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function lines(text: string): string[] {
  return text.split(/\r?\n/);
}

/** Collapse spaces inside long digit runs — Tesseract often groups digits. */
function digitRuns(text: string): string[] {
  return (text.match(/\d[\d \t]{13,}\d/g) ?? [])
    .map((m) => m.replace(/\s+/g, ''))
    .filter((m) => m.length === 16);
}

function nikCandidates(text: string): string[] {
  return [...new Set([...(text.match(/\d{16}/g) ?? []), ...digitRuns(text)])];
}

function lineMatching(text: string, re: RegExp): string {
  return lines(text).find((l) => re.test(l.toUpperCase())) ?? '';
}

/** Value after a `LABEL :` prefix, on the first line that carries it. */
function valueAfterLabel(text: string, prefix: RegExp): string | undefined {
  for (const line of lines(text)) {
    const m = line.match(prefix);
    if (m) {
      const value = norm(line.slice(m[0].length));
      if (value) return value;
    }
  }
  return undefined;
}

function readDate(text: string): string | undefined {
  const m = text.match(/(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{4})/);
  if (!m) return undefined;
  return `${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}-${m[3]}`;
}

function readPlace(text: string): string | undefined {
  const m = text.match(/TEMPAT(?:\s*\/\s*TGL)?\s*LAHIR\s*:?\s*([A-Za-z][A-Za-z ]{2,29})/i);
  return m ? norm(m[1]) : undefined;
}

/** The KK row that belongs to the child: by their NIK, else their name. */
function kkChildRow(text: string, name?: string, nik?: string): string {
  const all = lines(text);
  if (nik) {
    const byNik = all.find((l) => l.replace(/\s+/g, '').includes(nik));
    if (byNik) return byNik;
  }
  const token = name ? norm(name).split(' ')[0] : '';
  if (token) {
    const byName = all.find((l) => l.toUpperCase().includes(token));
    if (byName) return byName;
  }
  return '';
}

/**
 * One KK table row: `No  Nama  NIK  Jenis Kelamin  Tempat Lahir  Tgl Lahir`.
 * Column positions are read from the row itself, not from the header — the
 * header says "Tempat Lahir" too, so a generic "TEMPAT LAHIR" search would read
 * the header instead of the child's row.
 */
function parseKkRow(row: string): { name?: string; nik?: string; place?: string; date?: string } {
  const m = row.match(
    /^\s*\d+\s+(.+?)\s+(\d{16})\s+(?:LAKI-LAKI|PEREMPUAN)\s+(.+?)\s+(\d{1,2}\s*[-/.]\s*\d{1,2}\s*[-/.]\s*\d{4})\s*$/i
  );
  if (!m) return {};
  return {
    name: norm(m[1]),
    nik: m[2],
    place: norm(m[3]),
    date: canonicalDate(m[4]),
  };
}

interface ExtractedFields {
  nationalId?: string;
  familyCardNumber?: string;
  fullName?: string;
  birthPlace?: string;
  birthDate?: string;
}

function extractFields(
  text: string,
  documentType: DocumentParseRequest['documentType'],
  input?: DocumentParseRequest['userInputData']
): ExtractedFields {
  const out: ExtractedFields = {};
  const candidates = nikCandidates(text);

  if (documentType === 'ktp') {
    out.nationalId = nikCandidates(lineMatching(text, /\bNIK\b/))[0] ?? candidates[0];
    out.fullName = valueAfterLabel(text, /^\s*NAMA\s*:\s*/i);
    out.birthPlace = readPlace(text);
    out.birthDate = readDate(text);
  } else if (documentType === 'kk') {
    out.familyCardNumber =
      nikCandidates(lineMatching(text, /NO\.?\s*KK/))[0] ??
      nikCandidates(lineMatching(text, /KARTU\s+KELUARGA/))[0] ??
      candidates[0];
    const row = kkChildRow(text, input?.fullName, input?.nationalId);
    const parsed = row ? parseKkRow(row) : {};
    if (parsed.nik) {
      out.nationalId = parsed.nik;
      out.fullName = parsed.name;
      out.birthPlace = parsed.place;
      out.birthDate = parsed.date;
    } else if (row) {
      out.nationalId = (row.match(/\d{16}/) ?? [])[0];
      out.birthPlace = readPlace(row);
      out.birthDate = readDate(row);
    } else {
      out.nationalId = candidates[candidates.length - 1];
    }
  } else if (documentType === 'akta') {
    out.fullName = valueAfterLabel(text, /^\s*NAMA\s*:\s*/i);
    out.birthPlace = readPlace(text);
    out.birthDate = readDate(text);
  }

  return out;
}

function sameDigits(a?: string, b?: string): boolean | undefined {
  if (!a || !b) return undefined;
  return a.replace(/\s+/g, '') === b.replace(/\s+/g, '');
}

function sameText(a?: string, b?: string): boolean | undefined {
  if (!a || !b) return undefined;
  return norm(a) === norm(b);
}

/** Both `YYYY-MM-DD` (the form) and `DD-MM-YYYY` (the document) → `DD-MM-YYYY`. */
function canonicalDate(value?: string): string | undefined {
  if (!value) return undefined;
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}-${iso[2]}-${iso[1]}`;
  const dmy = value.match(/(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{4})/);
  if (dmy) return `${dmy[1].padStart(2, '0')}-${dmy[2].padStart(2, '0')}-${dmy[3]}`;
  return undefined;
}

function sameDate(a?: string, b?: string): boolean | undefined {
  const ca = canonicalDate(a);
  const cb = canonicalDate(b);
  if (!ca || !cb) return undefined;
  return ca === cb;
}

export async function parseAndVerifyDocument(
  payload: DocumentParseRequest,
  deps?: ParseDocumentDeps
): Promise<DocumentOcrResult> {
  const { imageBase64, documentType, userInputData } = payload;
  const extractedData: DocumentOcrResult['extractedData'] = {};
  const notes: string[] = [];

  let sha256: string | undefined;
  let isBinary = false;
  let isPdf = false;
  let buffer: Buffer | undefined;

  if (imageBase64) {
    const decoded = decodeBase64(imageBase64);
    if (decoded.length > MAX_IMAGE_BYTES) {
      // The schema already caps this; keep the service safe on its own.
      buffer = undefined;
    } else {
      buffer = decoded;
      sha256 = sha256Hex(decoded);
      if (PDF_DATA_URI.test(imageBase64) || looksLikePdf(decoded)) {
        isBinary = true;
        isPdf = true;
      } else if (IMAGE_DATA_URI.test(imageBase64) || looksLikeImage(decoded)) {
        isBinary = true;
      } else {
        // Plain-text metadata pasted as base64 (rare): keep the original
        // behaviour of matching the digits found in the text.
        const textContent = decoded.toString('utf8');
        const digits = textContent.match(/\b\d{16}\b/g) ?? [];
        if (documentType === 'ktp') {
          if (digits[0]) extractedData.nationalId = digits[0];
        } else if (documentType === 'kk') {
          if (digits[0]) extractedData.familyCardNumber = digits[0];
          if (digits[1]) extractedData.nationalId = digits[1];
        }
      }
    }
  }

  const canRunOcr =
    Boolean(buffer) && isBinary && !isPdf && documentType !== 'foto' && ocrEnabled(deps);
  if (canRunOcr && buffer) {
    try {
      const readText = deps?.readText ?? tesseractReadText;
      const text = await readText(buffer);
      Object.assign(extractedData, extractFields(text, documentType, userInputData));
      notes.push(ENGINE_NOTE);
    } catch {
      notes.push(OCR_FAILED_NOTE);
    }
  } else if (isBinary) {
    notes.push(isPdf ? PDF_NOTE : MANUAL_NOTE);
  }

  const nationalIdMatch = sameDigits(extractedData.nationalId, userInputData?.nationalId);
  const familyCardMatch = sameDigits(
    extractedData.familyCardNumber,
    userInputData?.familyCardNumber
  );
  const fullNameMatch = sameText(extractedData.fullName, userInputData?.fullName);
  const birthPlaceMatch = sameText(extractedData.birthPlace, userInputData?.birthPlace);
  const birthDateMatch = sameDate(extractedData.birthDate, userInputData?.birthDate);

  const compared: Array<[string, boolean | undefined]> = [
    ['NIK', nationalIdMatch],
    ['Nomor KK', familyCardMatch],
    ['Nama', fullNameMatch],
    ['Tempat lahir', birthPlaceMatch],
    ['Tanggal lahir', birthDateMatch],
  ];
  const answered = compared.filter(([, v]) => v !== undefined);
  const mismatched = answered.filter(([, v]) => v === false).map(([label]) => label);

  for (const label of mismatched) {
    notes.push(
      `${label} pada dokumen tidak sama dengan isian. Periksa kembali sebelum memverifikasi.`
    );
  }
  if (answered.length > 0 && mismatched.length === 0) {
    notes.push('Semua isian yang dibandingkan cocok. Verifikasi manual tetap diperlukan.');
  }
  if (notes.length === 0) notes.push(MANUAL_NOTE);

  const matchScore = answered.length
    ? Math.round((answered.filter(([, v]) => v === true).length / answered.length) * 100)
    : 50;

  return {
    success: true,
    documentType,
    ...(sha256 ? { sha256 } : {}),
    extractedData,
    validation: {
      nationalIdMatch,
      familyCardMatch,
      fullNameMatch,
      birthPlaceMatch,
      birthDateMatch,
      matchScore,
      // Never a pass: OCR is not fraud detection, so the best outcome is still
      // a manual-verification warning for the officer.
      status: mismatched.length > 0 ? 'MISMATCH' : 'WARNING',
      notes,
    },
  };
}
