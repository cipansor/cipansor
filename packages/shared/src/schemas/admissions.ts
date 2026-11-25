import { z } from "zod";
import { nisnSchema } from "./student-compliance";

export const parseDocumentSchema = z.object({
  imageBase64: z
    .string()
    .min(1, "Dokumen base64/image wajib diisi")
    .max(2800000, "Ukuran berkas melebihi batas maksimum (2MB)")
    .refine(
      (val) =>
        /^data:(image\/(jpeg|jpg|png|webp)|application\/pdf);base64,/i.test(
          val,
        ),
      "Tipe berkas tidak didukung. Hanya gambar (JPEG/PNG/WebP) dan PDF yang diperbolehkan",
    ),
  documentType: z.enum(["ktp", "kk", "akta", "foto", "lainnya"]),
  userInputData: z
    .object({
      fullName: z.string().optional(),
      nationalId: z.string().optional(),
      familyCardNumber: z.string().optional(),
      birthPlace: z.string().optional(),
      birthDate: z.string().optional(),
    })
    .optional(),
});

export type ParseDocumentRequest = z.infer<typeof parseDocumentSchema>;

/**
 * Persetujuan orang tua/wali sebelum data pribadi anak dikirim (UU PDP 27/2022
 * Pasal 20 dan 25). Formulir SPMB publik mengumpulkan NIK, KK, akta, dan foto
 * anak; Pasal 25 ayat (2) mewajibkan persetujuan orang tua atau wali.
 *
 * `consent` adalah `literal(true)`, bukan `boolean()`: sebuah `false` yang
 * lolos validasi lalu ditolak di service berarti dua tempat yang harus sepakat
 * selamanya. Di sini, tidak menyetujui berarti permintaannya memang tidak sah
 * bentuknya, dan API menjawabnya dengan 400 di tepi (preseden
 * `chatbot.schema.ts`).
 *
 * `consentVersion` adalah nomor versi teks Kebijakan Privasi yang benar-benar
 * dibaca pendaftar. Persetujuan hanya menaungi teks yang dibaca saat itu, jadi
 * versinya ikut terekam (`Registrant.consentVersion`) dan diperiksa ada.
 */
export const registrantConsentFields = {
  consent: z.literal(true, {
    error: "Persetujuan orang tua/wali diperlukan sebelum mendaftar",
  }),
  consentVersion: z
    .number({ error: "Versi kebijakan privasi diperlukan" })
    .int("Versi kebijakan privasi tidak valid")
    .positive("Versi kebijakan privasi tidak valid"),
};

export const registrantConsentSchema = z.object(registrantConsentFields);

export type RegistrantConsent = z.infer<typeof registrantConsentSchema>;

export const createPublicRegistrantDocumentSchema = z.object({
  type: z.string().min(1, "Tipe dokumen wajib diisi"),
  url: z.string().optional(),
  base64: z.string().optional(),
  fileName: z.string().optional(),
  registrationToken: z.string().min(1, "Registration token wajib diisi"),
  ocrNotes: z.array(z.string()).optional(),
  ocrStatus: z.enum(["WARNING", "MISMATCH"]).optional(),
});

export type CreatePublicRegistrantDocumentRequest = z.infer<
  typeof createPublicRegistrantDocumentSchema
>;

export const onboardRegistrantSchema = z.object({
  registrantId: z.string().uuid("registrantId tidak valid"),
  unitId: z.string().optional(),
  classId: z.string().optional(),
  assignedClassId: z.string().optional(),
  roomId: z.string().optional(),
  nis: z.string().optional(),
  nisn: nisnSchema,
  academicYearId: z.string().optional(),
  /**
   * Santri lama (berstatus alumni) yang melanjutkan ke unit ini. Bila diisi,
   * pendaftaran ini ditautkan ke baris santri itu — tanpa akun baru dan tanpa
   * santri kedua (audit #489 bagian 3b-2).
   */
  existingStudentId: z
    .string()
    .uuid("existingStudentId tidak valid")
    .optional(),
});

/**
 * A registrant's own account of how they read the Qur'an, from least to most;
 * the test at entry checks it. Prisma's `QuranAbility` holds the same five.
 * The public form once sent "IQRO" and "HAFIDZ" while the lead scores and the
 * seeds read "IQRA" and "TAHFIDZ", so a declared hafalan never counted.
 */
export const QURAN_ABILITIES = [
  "BELUM_BISA",
  "IQRA",
  "LANCAR",
  "TARTIL",
  "TAHFIDZ",
] as const;
export type QuranAbilityCode = (typeof QURAN_ABILITIES)[number];

export const QURAN_ABILITY_LABELS: Record<QuranAbilityCode, string> = {
  BELUM_BISA: "Belum bisa membaca",
  IQRA: "Masih belajar Iqra",
  LANCAR: "Lancar membaca Al-Qur'an",
  TARTIL: "Tartil, tajwidnya baik",
  TAHFIDZ: "Sudah hafal beberapa juz",
};

/** The label a person reads; an unknown code is shown as it is, never hidden. */
export function quranAbilityLabel(
  code: string | null | undefined,
): string | null {
  if (!code) return null;
  return QURAN_ABILITY_LABELS[code as QuranAbilityCode] ?? code;
}

export const quranAbilitySchema = z.enum(QURAN_ABILITIES, {
  message: "Pilihan kemampuan Al-Qur'an tidak dikenal",
});

export interface RegistrantDTO {
  id: string;
  admissionPeriodId: string;
  unitId?: string | null;
  registrationNo: string;
  fullName: string;
  name?: string;
  gender: "MALE" | "FEMALE";
  birthPlace: string;
  birthDate: string;
  address: string;
  phone?: string | null;
  email?: string | null;
  previousSchool?: string | null;
  quranAbility?: QuranAbilityCode | null;
  memorizedJuz?: number | null;
  parentName: string;
  parentPhone: string;
  parentEmail?: string | null;
  parentOccupation?: string | null;
  source?: string | null;
  campaign?: { id: string; name: string; code: string } | null;
  status: string;
  testScore?: number | null;
  interviewScore?: number | null;
  tahfidzScore?: number | null;
  registrationFeePaidAt?: string | null;
  registrationFeeAmount?: number | null;
  acceptedAt?: string | null;
  enrolledAt?: string | null;
  createdAt: string;
  admissionPeriod?: {
    id: string;
    name: string;
    unitId?: string | null;
    registrationFee?: number | null;
    unit?: { id: string; name: string; type: string };
  };
  wave?: {
    id: string;
    name: string;
    waveNumber: number;
    registrationFee?: number | null;
  } | null;
  documents?: RegistrantDocumentDTO[];
}

export interface RegistrantDocumentDTO {
  id: string;
  registrantId: string;
  name: string;
  type: string;
  fileUrl: string;
  isVerified: boolean;
  notes?: string | null;
  createdAt: string;
}

/**
 * Lifecycle of an admission registrant. Single-sourced here so the web tracker
 * hook/component and any API response shape stay in sync (no drift).
 */
export type RegistrationStatus =
  | "REGISTERED"
  | "DOCUMENT_CHECK"
  | "TEST_SCHEDULED"
  | "TEST_COMPLETED"
  | "ACCEPTED"
  | "REJECTED"
  | "ENROLLED"
  | "CANCELLED"
  // Legacy values still referenced by the UI
  | "DRAFT"
  | "SUBMITTED"
  | "DOCUMENT_REVIEW"
  | "INTERVIEW_SCHEDULED"
  | "INTERVIEW_COMPLETED";

/**
 * Public PPDB tracker DTO (GET /admissions/public/track). The backend requires
 * both the registration number and birth date; partial matches are rejected.
 * Kept in `@cipansor/shared` so the web tracker hook and the API contract stay
 * in sync (no drift between the two).
 */
export interface TrackedRegistrantDTO {
  id: string;
  registrationNo: string;
  fullName: string;
  status: RegistrationStatus;
  testScore: string | number | null;
  interviewScore: string | number | null;
  tahfidzScore: string | number | null;
  acceptedAt: string | null;
  enrolledAt: string | null;
  createdAt: string;
  admissionPeriod?: { name: string; unit?: { name: string } };
  documents: { id: string; name: string; isVerified: boolean }[];
}

export interface OnboardRegistrantPayload {
  registrantId: string;
  /** Santri lama (alumni) yang melanjutkan ke unit ini — audit #489 bagian 3b-2. */
  existingStudentId?: string;
  unitId?: string;
  classId?: string;
  assignedClassId?: string;
  roomId?: string;
  nis?: string;
  nisn?: string;
  academicYearId?: string;
}

// ───────────────────────── An SPMB intake ─────────────────────────
//
// One unit's intake for one academic year (an admission period), divided into
// waves. What the yayasan's brochure prints is data here, entered by the unit's
// admin each year (decisions/spmb-2027-2028.md): per wave the sessions after
// registration and the discount for paying in full; per unit the
// requirements, the minimum age and the contact person.
//
// Every date is a calendar day (`2026-12-20`), the shape a date input gives.
// The API reads a registration window as running from the first day's start to
// the last day's end in WIB, so "1 Oktober – 20 Desember" closes at midnight
// on 20 December in Tasikmalaya, wherever the server runs.

const calendarDay = z.iso.date({ message: "Tanggal tidak valid" });

/** Days are compared as strings: `YYYY-MM-DD` sorts as it reads. */
const notBefore = (end?: string | null, start?: string | null) =>
  !end || !start || end >= start;

export const admissionPeriodFields = {
  unitId: z.uuid({ message: "Unit wajib dipilih" }),
  academicYearId: z.uuid({ message: "Tahun ajaran wajib dipilih" }),
  name: z
    .string()
    .trim()
    .min(3, "Nama minimal 3 karakter")
    .max(200, "Nama maksimal 200 karakter"),
  startDate: calendarDay,
  endDate: calendarDay,
  quota: z.number().int().min(0, "Kuota tidak boleh negatif"),
  registrationFee: z.number().min(0, "Biaya tidak boleh negatif"),
  isActive: z.boolean(),
  requirements: z
    .array(
      z
        .string()
        .trim()
        .min(1, "Persyaratan tidak boleh kosong")
        .max(300, "Satu persyaratan maksimal 300 karakter"),
    )
    .max(30, "Maksimal 30 persyaratan"),
  /** Whole months: 84 is 7 years. */
  minAgeMonths: z
    .number()
    .int()
    .min(0, "Usia minimal tidak boleh negatif")
    .max(360, "Usia minimal tidak masuk akal")
    .nullable(),
  ageReferenceDate: calendarDay.nullable(),
  contactName: z
    .string()
    .trim()
    .max(100, "Nama kontak maksimal 100 karakter")
    .nullable(),
  contactPhone: z
    .string()
    .trim()
    .regex(/^\+?[0-9][0-9 -]{6,19}$/, "Nomor telepon tidak valid")
    .nullable(),
};

export const createAdmissionPeriodSchema = z
  .object({
    ...admissionPeriodFields,
    quota: admissionPeriodFields.quota.default(0),
    registrationFee: admissionPeriodFields.registrationFee.default(0),
    isActive: admissionPeriodFields.isActive.default(true),
    requirements: admissionPeriodFields.requirements.default([]),
    minAgeMonths: admissionPeriodFields.minAgeMonths.optional(),
    ageReferenceDate: admissionPeriodFields.ageReferenceDate.optional(),
    contactName: admissionPeriodFields.contactName.optional(),
    contactPhone: admissionPeriodFields.contactPhone.optional(),
  })
  .refine((p) => notBefore(p.endDate, p.startDate), {
    message: "Tanggal selesai tidak boleh sebelum tanggal mulai",
    path: ["endDate"],
  });

/** PATCH /admissions/periods/:id — the unit and the year do not move. */
export const updateAdmissionPeriodSchema = z
  .object(admissionPeriodFields)
  .omit({ unitId: true, academicYearId: true })
  .partial()
  .refine((p) => notBefore(p.endDate, p.startDate), {
    message: "Tanggal selesai tidak boleh sebelum tanggal mulai",
    path: ["endDate"],
  });

export type CreateAdmissionPeriodInput = z.infer<
  typeof createAdmissionPeriodSchema
>;
export type UpdateAdmissionPeriodInput = z.infer<
  typeof updateAdmissionPeriodSchema
>;

export const WAVE_STATUSES = ["UPCOMING", "OPEN", "CLOSED", "FULL"] as const;
export type WaveStatusCode = (typeof WAVE_STATUSES)[number];

/** A session of a wave: one day, or a range. An end needs a start. */
const SESSIONS = [
  ["testStartDate", "testEndDate", "tes"],
  ["resultsStartDate", "resultsEndDate", "pengumuman"],
  ["reRegistrationStartDate", "reRegistrationEndDate", "daftar ulang"],
] as const;

export const admissionWaveFields = {
  name: z
    .string()
    .trim()
    .min(3, "Nama minimal 3 karakter")
    .max(100, "Nama maksimal 100 karakter"),
  waveNumber: z
    .number()
    .int()
    .min(1, "Nomor gelombang minimal 1")
    .max(20, "Nomor gelombang maksimal 20"),
  startDate: calendarDay,
  endDate: calendarDay,
  quota: z.number().int().min(1, "Kuota minimal 1"),
  registrationFee: z.number().min(0, "Biaya tidak boleh negatif").nullable(),
  status: z.enum(WAVE_STATUSES),
  testStartDate: calendarDay.nullable(),
  testEndDate: calendarDay.nullable(),
  resultsStartDate: calendarDay.nullable(),
  resultsEndDate: calendarDay.nullable(),
  reRegistrationStartDate: calendarDay.nullable(),
  reRegistrationEndDate: calendarDay.nullable(),
  fullPaymentDiscount: z
    .number()
    .min(0, "Potongan tidak boleh negatif")
    .nullable(),
  notes: z
    .string()
    .trim()
    .max(1000, "Catatan maksimal 1000 karakter")
    .nullable(),
};

type WaveDates = Partial<
  Record<
    | "startDate"
    | "endDate"
    | (typeof SESSIONS)[number][0]
    | (typeof SESSIONS)[number][1],
    string | null
  >
>;

/**
 * What is wrong with a wave's dates, if anything. Run on a whole wave: on
 * create, and on update after the change is laid over the stored wave, so a
 * new end is checked against the start already saved.
 */
export function admissionWaveDateIssues(
  w: WaveDates,
): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  if (!notBefore(w.endDate, w.startDate)) {
    issues.push({
      path: "endDate",
      message: "Tanggal tutup pendaftaran tidak boleh sebelum tanggal buka",
    });
  }
  for (const [start, end, label] of SESSIONS) {
    if (w[end] && !w[start]) {
      issues.push({
        path: start,
        message: `Tanggal mulai ${label} wajib diisi bila tanggal selesainya diisi`,
      });
    } else if (!notBefore(w[end], w[start])) {
      issues.push({
        path: end,
        message: `Tanggal selesai ${label} tidak boleh sebelum tanggal mulainya`,
      });
    }
  }
  return issues;
}

function checkWaveDates(w: WaveDates, ctx: z.RefinementCtx) {
  for (const issue of admissionWaveDateIssues(w)) {
    ctx.addIssue({
      code: "custom",
      message: issue.message,
      path: [issue.path],
    });
  }
}

export const createAdmissionWaveSchema = z
  .object({
    periodId: z.uuid(),
    ...admissionWaveFields,
    registrationFee: admissionWaveFields.registrationFee.optional(),
    // Left out, the API reads it from the dates: a wave created inside its
    // window is open, not "upcoming".
    status: admissionWaveFields.status.optional(),
    testStartDate: admissionWaveFields.testStartDate.default(null),
    testEndDate: admissionWaveFields.testEndDate.default(null),
    resultsStartDate: admissionWaveFields.resultsStartDate.default(null),
    resultsEndDate: admissionWaveFields.resultsEndDate.default(null),
    reRegistrationStartDate:
      admissionWaveFields.reRegistrationStartDate.default(null),
    reRegistrationEndDate:
      admissionWaveFields.reRegistrationEndDate.default(null),
    fullPaymentDiscount: admissionWaveFields.fullPaymentDiscount.default(null),
    notes: admissionWaveFields.notes.optional(),
  })
  .superRefine(checkWaveDates);

/**
 * PUT /admissions/waves/:id. Fields left out are kept. The dates are checked
 * by the API once the change is laid over the stored wave
 * (`admissionWaveDateIssues`), because a new end must be checked against the
 * start already saved.
 */
export const updateAdmissionWaveSchema = z
  .object(admissionWaveFields)
  .partial();

export type CreateAdmissionWaveInput = z.infer<
  typeof createAdmissionWaveSchema
>;
export type UpdateAdmissionWaveInput = z.infer<
  typeof updateAdmissionWaveSchema
>;

/** An admission period as the portal reads it (GET /admissions/periods/:id). */
export interface AdmissionPeriodDTO {
  id: string;
  unitId: string;
  academicYearId: string;
  name: string;
  /** ISO date-times: the first day's start and the last day's end, in WIB. */
  startDate: string;
  endDate: string;
  quota: number;
  registrationFee: string | number;
  isActive: boolean;
  requirements: string[];
  minAgeMonths: number | null;
  /** ISO date-time at midnight UTC of the day. */
  ageReferenceDate: string | null;
  contactName: string | null;
  contactPhone: string | null;
  unit?: { id: string; name: string; type?: string };
  academicYear?: { id: string; name: string };
  waves?: AdmissionWaveDTO[];
  feeItems?: AdmissionFeeItemDTO[];
  _count?: { registrants: number };
}

export interface AdmissionWaveDTO {
  id: string;
  periodId: string;
  waveNumber: number;
  name: string;
  startDate: string;
  endDate: string;
  quota: number;
  registeredCount: number;
  acceptedCount: number;
  status: WaveStatusCode;
  registrationFee: string | number | null;
  testStartDate: string | null;
  testEndDate: string | null;
  resultsStartDate: string | null;
  resultsEndDate: string | null;
  reRegistrationStartDate: string | null;
  reRegistrationEndDate: string | null;
  fullPaymentDiscount: string | number | null;
  notes: string | null;
}

// ───────────────────────── An intake's fees ─────────────────────────
//
// The brochure's "Rincian Biaya" table, per unit: lines with an amount for
// ikhwan and one for akhwat, for boarding (mukim), non-boarding or both. A
// monthly fee (SPP) is a line too; its first month is paid on entry, which is
// why the brochure's totals say "Termasuk Infaq Juli".

export const FEE_RESIDENCIES = ["ALL", "BOARDING", "NON_BOARDING"] as const;
export type FeeResidencyCode = (typeof FEE_RESIDENCIES)[number];

export const FEE_RESIDENCY_LABELS: Record<FeeResidencyCode, string> = {
  ALL: "Mukim dan tidak mukim",
  BOARDING: "Mukim",
  NON_BOARDING: "Tidak mukim",
};

const rupiah = z
  .number()
  .int("Rupiah tanpa sen")
  .min(0, "Biaya tidak boleh negatif")
  .max(1_000_000_000, "Biaya tidak masuk akal");

export const admissionFeeItemSchema = z.object({
  label: z
    .string()
    .trim()
    .min(1, "Uraian wajib diisi")
    .max(120, "Uraian maksimal 120 karakter"),
  maleAmount: rupiah,
  femaleAmount: rupiah,
  residency: z.enum(FEE_RESIDENCIES),
  isMonthly: z.boolean(),
});

/** PUT /admissions/periods/:id/fees — the whole table, in the order shown. */
export const replaceAdmissionFeesSchema = z.object({
  items: z.array(admissionFeeItemSchema).max(40, "Maksimal 40 baris"),
});

export type AdmissionFeeItemInput = z.infer<typeof admissionFeeItemSchema>;
export type ReplaceAdmissionFeesInput = z.infer<
  typeof replaceAdmissionFeesSchema
>;

export interface AdmissionFeeItemDTO {
  id: string;
  periodId: string;
  sortOrder: number;
  label: string;
  /** Decimal as the API sends it: "1500000.00". */
  maleAmount: string | number;
  femaleAmount: string | number;
  residency: FeeResidencyCode;
  isMonthly: boolean;
}

export interface AdmissionFeeTotal {
  /** ALL when the table has no line for one residency only. */
  residency: FeeResidencyCode;
  /** Paid on entry, the first month of monthly fees included. */
  male: number;
  female: number;
  /** The monthly fees that follow. */
  monthlyMale: number;
  monthlyFemale: number;
}

type FeeLine = Pick<
  AdmissionFeeItemDTO,
  "maleAmount" | "femaleAmount" | "residency" | "isMonthly"
>;

/**
 * The brochure's "Jumlah" rows: for each residency the table offers, what
 * ikhwan and akhwat pay on entry. A line for both counts in each. A table
 * with no line for one residency only has a single total, "ALL".
 */
export function admissionFeeTotals(items: FeeLine[]): AdmissionFeeTotal[] {
  const offered = (["BOARDING", "NON_BOARDING"] as const).filter((r) =>
    items.some((i) => i.residency === r),
  );
  const options: FeeResidencyCode[] = offered.length ? [...offered] : ["ALL"];
  return options.map((residency) => {
    const lines = items.filter(
      (i) => i.residency === "ALL" || i.residency === residency,
    );
    const sum = (rows: FeeLine[], key: "maleAmount" | "femaleAmount") =>
      rows.reduce((total, row) => total + Number(row[key]), 0);
    const monthly = lines.filter((i) => i.isMonthly);
    return {
      residency,
      male: sum(lines, "maleAmount"),
      female: sum(lines, "femaleAmount"),
      monthlyMale: sum(monthly, "maleAmount"),
      monthlyFemale: sum(monthly, "femaleAmount"),
    };
  });
}

// ───────────────────────── The public view ─────────────────────────

/** Where a period or a wave stands today, from its dates. */
export type IntakeWindow = "upcoming" | "open" | "closed";
/** A wave can also be closed early because its quota is full. */
export type PublicWaveWindow = IntakeWindow | "full";

export interface PublicIntakeWaveDTO {
  waveNumber: number;
  name: string;
  /** ISO moments: the first day's start and the last day's end, in WIB. */
  startDate: string;
  endDate: string;
  /** ISO calendar days (midnight UTC). */
  testStartDate: string | null;
  testEndDate: string | null;
  resultsStartDate: string | null;
  resultsEndDate: string | null;
  reRegistrationStartDate: string | null;
  reRegistrationEndDate: string | null;
  fullPaymentDiscount: string | number | null;
  window: PublicWaveWindow;
}

/**
 * One unit's intake as the public SPMB page and the chatbot announce it
 * (GET /admissions/public/intakes). No quota, no registrant counts.
 */
export interface PublicIntakeDTO {
  unit: { id: string; name: string; officialName: string | null; type: string };
  period: {
    id: string;
    name: string;
    academicYear: string | null;
    startDate: string;
    endDate: string;
    /**
     * Whether one can register today. By the period's dates, and for a period
     * with waves also by them: between two waves, or with every wave full,
     * registration is shut although the period runs on (the API refuses it).
     */
    window: IntakeWindow;
    /** When registration next opens, while `window` is "upcoming". */
    opensAt: string | null;
    /** When the registration open now closes: the open wave's end, else the period's. */
    closesAt: string | null;
    registrationFee: string | number;
    requirements: string[];
    minAgeMonths: number | null;
    ageReferenceDate: string | null;
    contactName: string | null;
    contactPhone: string | null;
  };
  waves: PublicIntakeWaveDTO[];
  fees: Array<
    Pick<
      AdmissionFeeItemDTO,
      "label" | "maleAmount" | "femaleAmount" | "residency" | "isMonthly"
    >
  >;
}

/** Which unit's intake the announcement speaks for, and how it stands. */
export interface SpmbAnnouncementIntake {
  /** "open" — registration is on today; "upcoming" — it opens on `opensAt`. */
  window: Exclude<IntakeWindow, "closed">;
  /**
   * The units it speaks for: **every** unit taking registrations when the
   * window is open, in the API's unit order; the one that opens soonest when it
   * is upcoming (its date is that unit's own).
   */
  units: { name: string }[];
  /** `id` is what a dismissal is remembered against, so next year's intake returns. */
  period: { id: string; academicYear: string | null; opensAt: string | null };
}

/**
 * What the public site's announcement speaks about, or null when there is
 * nothing to announce.
 *
 * One rule, derived so the banner and the dialog cannot state different
 * things. The chatbot reads the same intakes, but it explains each unit
 * separately, so it does not follow this rule:
 *
 * - units whose registration is **open** today win, and all of them are
 *   named — it is the more useful message, and naming only the first (TK
 *   Qur'an, in the API's order) told an SMA Qur'an family nothing while all
 *   four schools were open; an announcement that says "opens on 1 January"
 *   while a sibling school is taking registrations reads as "not open yet";
 * - otherwise a unit that **opens soonest** is announced, with the day it
 *   opens;
 * - otherwise nothing is announced (every intake is closed).
 *
 * `academicYear` rides along so the caller can name the year it is announcing
 * rather than writing one into the markup — the bug the old hardcoded badge
 * had. Kept pure (no clock, no I/O) so both apps and the tests can call it.
 */
export function spmbAnnouncementOf(
  intakes: readonly PublicIntakeDTO[],
): SpmbAnnouncementIntake | null {
  const openNow = intakes.filter((i) => i.period.window === "open");
  const open = openNow[0];
  if (open) {
    return {
      window: "open",
      units: openNow.map((i) => ({ name: i.unit.name })),
      period: {
        id: open.period.id,
        academicYear: open.period.academicYear,
        opensAt: null,
      },
    };
  }
  const soonest = intakes
    .filter((i) => i.period.window === "upcoming" && i.period.opensAt)
    .sort((a, b) => a.period.opensAt!.localeCompare(b.period.opensAt!))[0];
  if (!soonest) return null;
  return {
    window: "upcoming",
    units: [{ name: soonest.unit.name }],
    period: {
      id: soonest.period.id,
      academicYear: soonest.period.academicYear,
      opensAt: soonest.period.opensAt,
    },
  };
}
