import type { QuestionType } from '@prisma/client';
import { Errors } from '@/middleware/error';

/**
 * One contract for "what is the right answer to this question".
 *
 * `Question.answerKey` is a Prisma `Json?` column and was written straight from
 * `req.body`, so its shape was whatever the caller happened to send. Grading
 * then compared `JSON.stringify(key) === JSON.stringify(studentAnswer)`, while
 * the web client always submits strings — `opt.id` for multiple choice and the
 * literals `"true"` / `"false"` for true/false. A teacher who stored the
 * natural JSON boolean `true` produced a question every student got wrong, with
 * no error anywhere: the score was simply 0, and since CBT results now sync
 * into the academic gradebook, that 0 became an official mark.
 *
 * The fix is the one the assessment standards already describe. In 1EdTech QTI
 * every response variable declares a `baseType` — `identifier`, `boolean`,
 * `string`, … — and `correctResponse` is expressed in that declared type, which
 * is what response processing then compares. So here each `QuestionType` has a
 * declared base type, every key is normalised to it on the way IN (and rejected
 * if it cannot be), and both sides are normalised again when compared.
 *
 * It also replaces a second, quieter divergence: the distractor analysis
 * unwrapped `{ id: … }` wrappers while the grader did not, so the two disagreed
 * about which option a student had picked. Both now call the same function.
 */

/** Declared base type per question type, in QTI's sense. */
const BASE_TYPE: Record<QuestionType, 'boolean' | 'identifier' | 'none'> = {
  TRUE_FALSE: 'boolean',
  MULTIPLE_CHOICE: 'identifier',
  // Essays are marked by a human; there is no machine-comparable key.
  ESSAY: 'none',
};

/**
 * Pull the comparable value out of the shapes seen in the wild: a bare value,
 * or an object wrapper from an option list / a richer client payload.
 */
function unwrap(raw: unknown): unknown {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    for (const field of ['id', 'optionId', 'value', 'key'] as const) {
      if (field in obj && obj[field] !== null && obj[field] !== undefined) return obj[field];
    }
    return null;
  }
  return raw;
}

/** `"true"` / `"false"`, or null when the value is not a usable boolean. */
function asBoolean(value: unknown): string | null {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (value === 1) return 'true';
    if (value === 0) return 'false';
    return null;
  }
  if (typeof value !== 'string') return null;
  // Indonesian labels are accepted because that is what the UI calls them, and
  // an imported question bank may carry either language.
  const v = value.trim().toLowerCase();
  if (['true', 'benar', 'b', '1', 'ya'].includes(v)) return 'true';
  if (['false', 'salah', 's', '0', 'tidak'].includes(v)) return 'false';
  return null;
}

/** A trimmed, non-empty identifier string, or null. */
function asIdentifier(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return v === '' ? null : v;
}

/**
 * The canonical comparable form of an answer or a key — the only thing that may
 * be compared. Returns null when this value cannot answer this question type,
 * and null never equals null here: an unusable value is not a correct answer.
 */
export function canonicalAnswer(type: QuestionType, raw: unknown): string | null {
  const value = unwrap(raw);
  if (value === null) return null;
  switch (BASE_TYPE[type]) {
    case 'boolean':
      return asBoolean(value);
    case 'identifier':
      return asIdentifier(value);
    default:
      return null;
  }
}

/** Whether a student's answer matches the key, both read through one rule. */
export function isAnswerCorrect(
  type: QuestionType,
  answerKey: unknown,
  studentAnswer: unknown
): boolean {
  const key = canonicalAnswer(type, answerKey);
  if (key === null) return false;
  const given = canonicalAnswer(type, studentAnswer);
  return given !== null && given === key;
}

/** Every option identifier of a multiple-choice question, in order. */
export function optionIdentifiers(options: unknown): string[] {
  if (!Array.isArray(options)) return [];
  return options.map((opt) => asIdentifier(unwrap(opt))).filter((id): id is string => id !== null);
}

/**
 * A multiple-choice question's options are choices, not labels: two options
 * with the same id cannot be told apart by an answer, and the distractor
 * analysis would report the same count for both. Refuse the row at write time.
 */
export function assertUniqueOptionIdentifiers(options: unknown): void {
  const seen = new Set<string>();
  for (const id of optionIdentifiers(options)) {
    if (seen.has(id)) {
      throw Errors.badRequest(
        `ID opsi "${id}" muncul lebih dari sekali; setiap opsi harus punya id unik.`
      );
    }
    seen.add(id);
  }
}

/**
 * Validate and normalise a key on the way into the database, so a key that can
 * never match is refused when the teacher writes it rather than discovered in
 * a student's score. Returns the value to persist.
 *
 * For multiple choice the key must name one of the question's own options —
 * the other half of the same mistake, and invisible until grading day.
 */
export function normalizeAnswerKeyForStorage(
  type: QuestionType,
  answerKey: unknown,
  options: unknown
): string | null {
  if (type === 'MULTIPLE_CHOICE') assertUniqueOptionIdentifiers(options);
  if (BASE_TYPE[type] === 'none') return null;

  if (answerKey === null || answerKey === undefined || answerKey === '') {
    // A question may legitimately be saved as a draft without its key yet; it
    // simply cannot be answered correctly until one is set.
    return null;
  }

  const canonical = canonicalAnswer(type, answerKey);
  if (canonical === null) {
    throw Errors.badRequest(
      type === 'TRUE_FALSE'
        ? 'Kunci jawaban benar-salah harus bernilai benar atau salah.'
        : 'Kunci jawaban pilihan ganda harus berupa id salah satu opsi.'
    );
  }

  if (type === 'MULTIPLE_CHOICE') {
    const ids = optionIdentifiers(options);
    if (ids.length > 0 && !ids.includes(canonical)) {
      throw Errors.badRequest(
        `Kunci jawaban "${canonical}" tidak ada di antara opsi soal ini (${ids.join(', ')}).`
      );
    }
  }

  return canonical;
}
