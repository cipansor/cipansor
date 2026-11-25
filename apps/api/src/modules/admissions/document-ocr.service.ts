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

// One worker at a time keeps peak RSS (~205 MB) inside the API's 1 GB limit.
// The queue is capped so a burst falls back to manual verification instead of
// growing without bound (CWE-770).
const MAX_CONCURRENT_OCR = 1;
const MAX_OCR_QUEUE = 10;
let ocrSlots = MAX_CONCURRENT_OCR;
const ocrWaiters: Array<() => void> = [];

async function acquireOcrSlot(): Promise<void> {
  if (ocrSlots > 0) {
    ocrSlots -= 1;
    return;
  }
  if (ocrWaiters.length >= MAX_OCR_QUEUE) {
    throw new Error('OCR_QUEUE_FULL');
  }
  await new Promise<void>((resolve) => ocrWaiters.push(resolve));
}

function releaseOcrSlot(): void {
  const next = ocrWaiters.shift();
  if (next) {
    // Hand the slot straight to the waiter; `ocrSlots` stays decremented.
    next();
  } else {
    ocrSlots += 1;
  }
}

type OcrWorker = {
  recognize(image: Buffer): Promise<{ data: { text?: string } }>;
  terminate(): Promise<unknown>;
};

type OcrWorkerOptions = {
  langPath: string;
  gzip: boolean;
  cacheMethod: 'none';
  logger: () => void;
  errorHandler: (err: unknown) => void;
};

type OcrWorkerFactory = (options: OcrWorkerOptions) => Promise<OcrWorker>;

const defaultWorkerFactory: OcrWorkerFactory = async (options) => {
  const { createWorker } = await import('tesseract.js');
  return createWorker(engData.code, 1, options);
};

const OCR_INIT_TIMEOUT_MS = 30_000;
const OCR_RECOGNIZE_TIMEOUT_MS = 30_000;

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * The real OCR engine: Tesseract.js compiled to WebAssembly, reading the
 * traineddata bundled in `@tesseract.js-data/eng` so no image (and no request)
 * leaves this deployment. `acquireOcrSlot` bounds how many run at once. The
 * 2026-11-25 spike on `node:26-alpine` measured ~0.4–0.6 s/page and ~205 MB
 * peak RSS.
 *
 * Tesseract reports a failed model load through `errorHandler` without
 * rejecting `createWorker`, so both phases race that handler and carry a
 * timeout: a stuck init must still release its slot.
 */
export async function tesseractReadText(
  image: Buffer,
  createWorker: OcrWorkerFactory = defaultWorkerFactory
): Promise<string> {
  await acquireOcrSlot();
  let finished = false;
  let worker: OcrWorker | undefined;
  try {
    let rejectOnWorkerError: (reason: unknown) => void = () => {};
    const workerError = new Promise<never>((_, reject) => {
      rejectOnWorkerError = reject;
    });
    const workerPromise = createWorker({
      langPath: engData.langPath,
      gzip: engData.gzip,
      // The traineddata is already a local file; caching it again would drop a
      // 14 MB `eng.traineddata` into the process CWD.
      cacheMethod: 'none',
      logger: () => {},
      // Route worker-level failures (a corrupt image, a failed model load, a
      // crashed wasm worker) into the promise. Left unhandled, the callback
      // throws outside it, and `main.ts` treats that as an uncaughtException
      // and stops the API.
      errorHandler: (err) => rejectOnWorkerError(err),
    });
    workerPromise.then(
      (created) => {
        // A worker that arrives after the race was lost must not leak.
        if (finished) void created.terminate().catch(() => {});
        else worker = created;
      },
      () => {}
    );
    worker = await withTimeout(
      Promise.race([workerPromise, workerError]),
      OCR_INIT_TIMEOUT_MS,
      'OCR worker init'
    );
    const { data } = await withTimeout(
      Promise.race([worker.recognize(image), workerError]),
      OCR_RECOGNIZE_TIMEOUT_MS,
      'OCR recognize'
    );
    return data.text ?? '';
  } finally {
    finished = true;
    if (worker) {
      try {
        await worker.terminate();
      } catch {
        // A worker that already crashed cannot be terminated again.
      }
    }
    releaseOcrSlot();
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
  // A certificate number (`474.1/1234/2012`) also looks like a date and would
  // otherwise win over the birth date printed after it, so a labelled date
  // wins; the unlabelled pattern is only a fallback for garbled OCR.
  const labelled = text.match(
    /(?:TGL\.?\s*LAHIR|TANGGAL\s+LAHIR|LAHIR\s+DI\s+[A-Za-z][A-Za-z .'-]*?\s+PADA\s+TANGGAL|LAHIR\s+PADA\s+TANGGAL)\s*:?\s*(?:[A-Za-z][A-Za-z .'-]{0,40}?,\s*)?(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{4})/i
  );
  const m = labelled ?? text.match(/(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{4})/);
  if (!m) return undefined;
  return `${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}-${m[3]}`;
}

function readPlace(text: string): string | undefined {
  const m = text.match(/TEMPAT(?:\s*\/\s*TGL)?\s*LAHIR\s*:?\s*([A-Za-z][A-Za-z .,'-]*)/i);
  if (!m) return undefined;
  // A place may carry an abbreviation ("KAB. CIAMIS") and is often followed by
  // the birth date on the same line; keep the name, drop the date.
  const raw = m[1].replace(/\s*\d{1,2}\s*[-/.]\s*\d{1,2}\s*[-/.]\s*\d{4}.*$/, '').split(',')[0];
  return norm(raw) || undefined;
}

/**
 * The numbered member rows. The NIK may arrive with OCR-inserted spaces
 * (`3201 2301 1023 0001`), so the run is matched loosely here and normalised
 * in `parseKkRow`.
 */
function kkMemberRows(text: string): string[] {
  return lines(text).filter((l) => /^\s*\d+\s+\D/.test(l) && /\d[\d ]{14,}\d/.test(l));
}

/**
 * The KK row that belongs to the child. An exact NIK wins; failing that, the
 * full normalised name — never the first token, which also appears in the head
 * of the card and in a relative's row (Ahmad Hidayat vs Ahmad Fauzi).
 */
function kkChildRow(text: string, name?: string, nik?: string): string {
  const rows = kkMemberRows(text);
  if (nik) {
    const byNik = rows.find((l) => parseKkRow(l).nik === nik);
    if (byNik) return byNik;
  }
  const target = name ? norm(name) : '';
  if (target) {
    const byName = rows.find((l) => parseKkRow(l).name === target);
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
  const nikMatch = row.match(/\d[\d ]{14,}\d/);
  if (!nikMatch || nikMatch.index === undefined) return {};
  const nik = nikMatch[0].replace(/\s+/g, '');
  if (nik.length !== 16) return {};
  // Name from the leading columns; the rest of the row may carry extra columns
  // (religion, marital status) after the date, so nothing requires the row to
  // end there.
  const name = norm(row.slice(0, nikMatch.index).replace(/^\s*\d+\s+/, ''));
  const after = row.slice(nikMatch.index + nikMatch[0].length);
  const gender = after.match(/LAKI-LAKI|PEREMPUAN/i);
  let place: string | undefined;
  if (gender && gender.index !== undefined) {
    const rest = after.slice(gender.index + gender[0].length);
    // Only read a place when the birth date can be located: without it the
    // "place" would swallow the garbled date (and the next column) and report a
    // false mismatch against a correct birth place.
    const dateAt = rest.search(/\d{1,2}\s*[-/.]\s*\d{1,2}\s*[-/.]\s*\d{4}/);
    if (dateAt >= 0) place = norm(rest.slice(0, dateAt)) || undefined;
  }
  return {
    name: name || undefined,
    nik,
    place,
    date: canonicalDate(after),
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
    // The KK number only comes from its own label. A bare 16-digit run could be
    // any member's NIK, and the form auto-fills an empty KK number — so a
    // misread head must stay empty, not borrow a NIK.
    out.familyCardNumber = nikCandidates(lineMatching(text, /NO\.?\s*(KK|KARTU\s+KELUARGA)/))[0];
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
    }
    // No row identified: leave the child's fields empty rather than guess.
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

/**
 * A KTP may belong to the father, the mother or the guardian, so the read name
 * matches if it equals any candidate the form sent. No candidate means no
 * comparison — never a mismatch.
 */
function compareName(
  extracted: string | undefined,
  input: DocumentParseRequest['userInputData']
): boolean | undefined {
  if (!extracted) return undefined;
  const candidates = [input?.fullName, ...(input?.fullNameCandidates ?? [])].filter(
    (value): value is string => Boolean(value && value.trim())
  );
  if (candidates.length === 0) return undefined;
  const target = norm(extracted);
  return candidates.some((candidate) => norm(candidate) === target);
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
  let ocrAttempted = false;
  if (canRunOcr && buffer) {
    try {
      const readText = deps?.readText ?? tesseractReadText;
      const text = await readText(buffer);
      ocrAttempted = true;
      Object.assign(extractedData, extractFields(text, documentType, userInputData));
      notes.push(ENGINE_NOTE);
    } catch (err) {
      // A full queue rejects before the engine is invoked; every other failure
      // means the engine ran and failed.
      ocrAttempted = !(err instanceof Error && err.message === 'OCR_QUEUE_FULL');
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
  const fullNameMatch = compareName(extractedData.fullName, userInputData);
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
      ocrAttempted,
      notes,
    },
  };
}
