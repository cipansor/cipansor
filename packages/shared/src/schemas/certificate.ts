import { z } from "zod";

/**
 * Digital certificate contract — the request/response shapes for
 * `/api/certificates`, shared by the API and the web client.
 *
 * The two sides used to declare this separately: the web hook carried its own
 * `CertificateType` union and `DigitalCertificate` interface, and the API its
 * own Zod schemas. They drifted — the web listed `COURSE_COMPLETION` and
 * `APPRECIATION`, the API's enum did not — so a type the picker offered was
 * rejected at the edge. One declaration removes the class.
 */

/** `CERTIFICATE_TYPES` in the API schema; the certificate type codes. */
export const CERTIFICATE_TYPE_VALUES = [
  "IJAZAH",
  "STTB",
  "TAHFIDZ",
  "SANAD",
  "ACHIEVEMENT",
  "GRADUATION",
  "PARTICIPATION",
  "COURSE_COMPLETION",
  "APPRECIATION",
  "OTHER",
] as const;
export type CertificateType = (typeof CERTIFICATE_TYPE_VALUES)[number];

/**
 * The create payload. `signatureUrl` is a plain URL here; the API additionally
 * refuses a host outside the yayasan's own sites (see
 * `assertAllowedSignatureUrl`), because a certificate detail page renders it
 * remotely.
 */
export const createCertificateSchema = z.object({
  studentId: z.uuid("Santri wajib dipilih"),
  certificateType: z.enum(
    CERTIFICATE_TYPE_VALUES,
    "Jenis sertifikat wajib dipilih",
  ),
  title: z.string().trim().min(3, "Judul minimal 3 karakter").max(200),
  description: z.string().trim().max(2000).optional(),
  grade: z.string().trim().max(50).optional(),
  rank: z.number().int().positive().optional(),
  issueDate: z.string().datetime("Tanggal terbit tidak valid"),
  signatoryName: z
    .string()
    .trim()
    .min(2, "Nama penandatangan minimal 2 karakter")
    .max(120),
  signatoryTitle: z
    .string()
    .trim()
    .min(2, "Jabatan penandatangan minimal 2 karakter")
    .max(120),
  signatureUrl: z.url("URL tanda tangan tidak valid").optional(),
  isPublic: z.boolean().default(false),
});
export type CreateCertificateInput = z.input<typeof createCertificateSchema>;

export const queryCertificateSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  studentId: z.uuid().optional(),
  certificateType: z.enum(CERTIFICATE_TYPE_VALUES).optional(),
  search: z.string().trim().max(200).optional(),
});
export type QueryCertificateInput = z.input<typeof queryCertificateSchema>;

/** A certificate as the API sends it. */
export interface DigitalCertificate {
  id: string;
  studentId: string;
  student?: {
    id: string;
    name: string;
    nis: string;
    photoUrl?: string;
    user?: { id: string; name: string };
    class?: { id: string; name: string };
    unit?: { id: string; name: string; type?: string };
  };
  certificateType: CertificateType;
  title: string;
  description?: string | null;
  certificateNumber: string;
  qrCode: string;
  verificationUrl: string;
  grade?: string | null;
  rank?: number | null;
  issueDate: string;
  signatoryName: string;
  signatoryTitle: string;
  signatureUrl?: string | null;
  pdfUrl?: string | null;
  thumbnailUrl?: string | null;
  isPublic: boolean;
  downloadCount: number;
  createdById: string;
  createdBy?: { id: string; name: string };
  createdAt: string;
  updatedAt: string;
}

/**
 * What the session-free verification shows of a certificate: what it says and
 * who signed it, and the holder only as far as the certificate prints them —
 * no ids, no NIS, no photo.
 */
export interface PublicCertificate {
  certificateNumber: string;
  certificateType: CertificateType;
  title: string;
  description?: string | null;
  grade?: string | null;
  rank?: number | null;
  issueDate: string;
  signatoryName: string;
  signatoryTitle: string;
  isPublic: boolean;
  student: {
    name: string;
    unit?: { name: string } | null;
    class?: { name: string } | null;
  };
}

/** The public verification answer for `GET /api/certificates/verify/:code`. */
export interface CertificateVerification {
  valid: boolean;
  certificate?: PublicCertificate | null;
  message?: string;
}
