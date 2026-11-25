import { z } from 'zod';
import { AdmissionStatus } from '@prisma/client';
import { checkNik, nikSchema, quranAbilitySchema, registrantConsentFields } from '@cipansor/shared';

// Admission Period schemas
// The intake's own fields (period and waves) are a contract with the portal's
// forms, so they live in @cipansor/shared.
export {
  createAdmissionPeriodSchema,
  updateAdmissionPeriodSchema,
  type CreateAdmissionPeriodInput,
  type UpdateAdmissionPeriodInput,
} from '@cipansor/shared';

export const queryAdmissionPeriodSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  unitId: z.string().uuid().optional(),
  academicYearId: z.string().uuid().optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

// Registrant schemas
export const createRegistrantSchema = z
  .object({
    admissionPeriodId: z.string().uuid(),
    fullName: z.string().min(2).max(100), // Updated from 'name'
    nickname: z.string().optional(),
    gender: z.enum(['MALE', 'FEMALE']),
    birthPlace: z.string().min(2).max(100),
    birthDate: z.string().datetime(),
    address: z.string().min(5),

    // Optional identity fields
    nationalId: nikSchema,
    familyCardNumber: z.string().optional(),

    // Location details
    village: z.string().optional(),
    district: z.string().optional(),
    city: z.string().optional(),
    province: z.string().optional(),
    postalCode: z.string().optional(),

    // Contact
    phone: z.string().max(20).optional(),
    email: z.string().email().optional().or(z.literal('')),

    // Education
    previousSchool: z.string().max(200).optional(),
    previousSchoolAddress: z.string().optional(),
    graduationYear: z.number().int().optional(),

    // Parents
    fatherName: z.string().min(1).max(100),
    fatherOccupation: z.string().optional(),
    fatherPhone: z.string().optional(),
    fatherEmail: z.string().email().optional().or(z.literal('')),

    motherName: z.string().min(1).max(100),
    motherOccupation: z.string().optional(),
    motherPhone: z.string().optional(),

    // Quran
    quranAbility: quranAbilitySchema.optional(),
    memorizedJuz: z.number().int().optional(),

    notes: z.string().optional(),

    // Marketing fields
    source: z.string().optional(),
    campaignId: z.string().uuid().optional(),
  })
  /**
   * NIK memuat tanggal lahir dan jenis kelaminnya sendiri (Dukcapil), jadi
   * salah ketik NIK atau salah isi tanggal lahir/jenis kelamin bisa ditangkap
   * tanpa membaca gambar apa pun. Diperiksa di tepi, di schema yang dipakai
   * jalur publik maupun jalur admin — bukan di service, supaya kedua permukaan
   * menjawab 400 yang sama.
   *
   * NIK kosong tetap diterima: anak yang belum punya NIK tetap boleh
   * mendaftar, dan jalur admin mengumpulkan data secara luring.
   */
  .superRefine((data, ctx) => {
    const check = checkNik({
      nationalId: data.nationalId,
      birthDate: data.birthDate,
      gender: data.gender,
    });

    if (check.status === 'invalid-date') {
      ctx.addIssue({
        code: 'custom',
        path: ['nationalId'],
        message:
          'NIK tidak memuat tanggal lahir yang sah — periksa kembali 16 digitnya. Bila NIK memang tidak sesuai, kosongkan isian NIK — pendaftaran tetap dapat dikirim.',
      });
    } else if (check.status === 'mismatch') {
      if (check.fields.includes('birthDate')) {
        ctx.addIssue({
          code: 'custom',
          path: ['nationalId'],
          message:
            'Tanggal lahir pada NIK tidak sama dengan tanggal lahir yang diisi. Bila NIK memang tidak sesuai, kosongkan isian NIK — pendaftaran tetap dapat dikirim.',
        });
      }
      if (check.fields.includes('gender')) {
        ctx.addIssue({
          code: 'custom',
          path: ['nationalId'],
          message:
            'Jenis kelamin pada NIK tidak sama dengan jenis kelamin yang dipilih. Bila NIK memang tidak sesuai, kosongkan isian NIK — pendaftaran tetap dapat dikirim.',
        });
      }
    }
  });

export const updateRegistrantSchema = z.object({
  fullName: z.string().min(2).max(100).optional(),
  phone: z.string().max(20).optional(),
  // Accept empty string to clear the field, mirroring `createRegistrantSchema`.
  // Without `.or(z.literal(''))` a registrant created with an empty email
  // cannot round-trip the same value back through PUT /registrants/:id.
  email: z.string().email().optional().or(z.literal('')),
  address: z.string().min(5).optional(),
  previousSchool: z.string().max(200).optional(),
  // Parents
  fatherName: z.string().min(1).max(100).optional(),
  fatherPhone: z.string().max(20).optional(),
  motherName: z.string().min(1).max(100).optional(),
  motherPhone: z.string().max(20).optional(),

  notes: z.string().optional(),
});

export const updateRegistrantScoreSchema = z.object({
  testScore: z.number().min(0).max(100).optional(),
  interviewScore: z.number().min(0).max(100).optional(),
  tahfidzScore: z.number().min(0).max(100).optional(),
  notes: z.string().optional(),
});

export const updateRegistrantStatusSchema = z.object({
  status: z.nativeEnum(AdmissionStatus),
  notes: z.string().optional(),
});

/**
 * Record that a registrant settled their daftar ulang fee.
 *
 * `paidAt` defaults to now rather than being required, because the common case
 * is a clerk confirming a payment in front of them. It stays settable so a
 * transfer that cleared yesterday can be recorded with the date it cleared.
 */
export const recordRegistrationFeeSchema = z.object({
  paidAt: z.coerce.date().optional(),
  amount: z.number().min(0).optional(),
  note: z.string().max(1000).optional(),
});

export const queryRegistrantSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  admissionPeriodId: z.string().uuid().optional(),
  status: z.nativeEnum(AdmissionStatus).optional(),
  gender: z.enum(['MALE', 'FEMALE']).optional(),
  search: z.string().optional(),
});

// Registrant Document schemas
export const createRegistrantDocumentSchema = z.object({
  registrantId: z.string().uuid(),
  name: z.string().min(2).max(200),
  type: z.enum(['akta', 'ijazah', 'kk', 'foto', 'rapor', 'lainnya']),
  fileUrl: z.string().url().optional(),
  notes: z.string().optional(),
});

export const verifyDocumentSchema = z.object({
  isVerified: z.boolean(),
  notes: z.string().optional(),
});

// Public PPDB tracking: the registrant's birth date acts as a second factor
// so a leaked/guessed registration number alone cannot expose the record.
export const trackRegistrantQuerySchema = z.object({
  registrationNo: z.string().min(3).max(50),
  birthDate: z.coerce.date(),
});

/**
 * POST /admissions/public/registrants — the public SPMB form.
 *
 * The base fields plus the parent/guardian's consent (UU PDP 27/2022 Pasal 20,
 * 25): this endpoint collects a child's NIK, KK, birth certificate and photo,
 * so it may not accept a submission without one. The unit's admin POSTing the
 * same registrant through the authenticated route (`createRegistrantSchema`) is
 * a different case — they collect the data offline, where the paper form, not
 * this endpoint, carries the consent — which is why the requirement lives here
 * and not on the base schema.
 */
export const createPublicRegistrantSchema = createRegistrantSchema.extend(registrantConsentFields);

export type CreatePublicRegistrantInput = z.infer<typeof createPublicRegistrantSchema>;

export type CreateRegistrantInput = z.infer<typeof createRegistrantSchema>;
export type UpdateRegistrantInput = z.infer<typeof updateRegistrantSchema>;
export type UpdateRegistrantScoreInput = z.infer<typeof updateRegistrantScoreSchema>;
export type UpdateRegistrantStatusInput = z.infer<typeof updateRegistrantStatusSchema>;
export type RecordRegistrationFeeInput = z.infer<typeof recordRegistrationFeeSchema>;
export type CreateRegistrantDocumentInput = z.infer<typeof createRegistrantDocumentSchema>;
