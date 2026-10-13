import { z } from 'zod';

// ============================================
// SANAD CERTIFICATE SCHEMAS
// ============================================

// Grades for Sanad
export const SANAD_GRADES = ['MUMTAZ', 'JAYYID_JIDDAN', 'JAYYID', 'MAQBUL'] as const;
export type SanadGrade = (typeof SANAD_GRADES)[number];

export const GRADE_LABELS: Record<SanadGrade, string> = {
  MUMTAZ: 'Mumtaz (Istimewa)',
  JAYYID_JIDDAN: 'Jayyid Jiddan (Sangat Baik)',
  JAYYID: 'Jayyid (Baik)',
  MAQBUL: 'Maqbul (Cukup)',
};

// List query schema
export const listSanadQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  studentId: z.string().uuid().optional(),
  teacherId: z.string().uuid().optional(),
  halaqohId: z.string().uuid().optional(),
  juz: z.coerce.number().int().min(1).max(30).optional(),
  grade: z.enum(SANAD_GRADES).optional(),
  hasCertificate: z.coerce.boolean().optional(),
  search: z.string().optional(),
});

export type ListSanadQuery = z.infer<typeof listSanadQuerySchema>;

// Create sanad record schema
export const createSanadSchema = z.object({
  enrollmentId: z.string().uuid(),
  teacherId: z.string().uuid(),
  juz: z.number().int().min(1).max(30),
  surahStart: z.number().int().min(1).max(114).optional(),
  surahEnd: z.number().int().min(1).max(114).optional(),
  grade: z.enum(SANAD_GRADES),
  certifiedAt: z.string().datetime().optional(),
  notes: z.string().max(1000).optional(),
});

export type CreateSanadInput = z.infer<typeof createSanadSchema>;

// Update sanad record schema
export const updateSanadSchema = z.object({
  teacherId: z.string().uuid().optional(),
  surahStart: z.number().int().min(1).max(114).optional().nullable(),
  surahEnd: z.number().int().min(1).max(114).optional().nullable(),
  grade: z.enum(SANAD_GRADES).optional(),
  notes: z.string().max(1000).optional().nullable(),
});

export type UpdateSanadInput = z.infer<typeof updateSanadSchema>;

// Generate certificate schema
export const generateCertificateSchema = z.object({
  sanadId: z.string().uuid(),
  templateType: z.enum(['STANDARD', 'FORMAL', 'DECORATIVE']).default('STANDARD'),
  includeQRCode: z.boolean().default(true),
  signedBy: z.string().optional(), // Principal name
  signedByTitle: z.string().optional(), // e.g., "Kepala Madrasah"
  // Whether the minted certificate may be read on the public verification page.
  // It defaults to `true` because this flow exists to print a QR that points at
  // `/public/verify-sanad`; a row left private (the column default) made the
  // page answer "Sertifikat tidak ditemukan" for a certificate the pesantren
  // had just issued. An issuer that needs an internal-only record passes
  // `false`.
  isPublic: z.boolean().default(true),
});

export type GenerateCertificateInput = z.infer<typeof generateCertificateSchema>;

// Verify certificate schema
export const verifyCertificateSchema = z.object({
  certificateNumber: z.string().min(5).max(50),
  verificationCode: z.string().min(6).max(20).optional(),
});

export type VerifyCertificateInput = z.infer<typeof verifyCertificateSchema>;

// Bulk create sanad schema
//
// The canonical size bounds for a bulk request. The endpoint schema enforces
// them at the edge and the service re-checks them as defence in depth (the
// service is also callable from internal code paths that skip Zod). Both must
// use these same constants — a service cap of 1000 against an endpoint cap of
// 50 means the larger number can never be reached through the API, which is a
// limit that looks enforced but is not. The minimum matters for the same
// reason: without a service-side floor, an empty `records: []` would skip the
// loop and be reported as `{ success: 0, failed: 0 }` — a success response for
// a request that created nothing.
export const MIN_BULK_CREATE_RECORDS = 1;
export const MAX_BULK_CREATE_RECORDS = 50;

export const bulkCreateSanadSchema = z.object({
  records: z.array(createSanadSchema).min(MIN_BULK_CREATE_RECORDS).max(MAX_BULK_CREATE_RECORDS),
});

export type BulkCreateSanadInput = z.infer<typeof bulkCreateSanadSchema>;
