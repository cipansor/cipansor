import { z } from 'zod';
import { partialUpdateSchema } from '@/lib/partial';
import {
  CERTIFICATE_TYPE_VALUES,
  createCertificateSchema as sharedCreateCertificateSchema,
  queryCertificateSchema as sharedQueryCertificateSchema,
} from '@cipansor/shared';
import { isAllowedSignatureUrl } from '@/utils/signature-url';

/**
 * Certificate request contracts live in `@cipansor/shared` so the web client
 * and the API cannot drift (they did: the web offered a `COURSE_COMPLETION`
 * type the API's own enum rejected). This file keeps the two things only the
 * API decides — the partial-update shape and the signature-host rule — and
 * re-exports the shared names so existing importers are unchanged.
 */
export const CERTIFICATE_TYPES = CERTIFICATE_TYPE_VALUES;

/**
 * `signatureUrl` is rendered as `<img src>` by the detail page; refuse a host
 * that is not one of the yayasan's own (see `utils/signature-url.ts`).
 *
 * A same-site path (`/uploads/…`) is allowed as well as an absolute URL on an
 * application host — `z.url()` alone would reject the path form, leaving the
 * guard's path branch unreachable.
 */
const guardedSignatureUrl = z
  .string()
  .refine(isAllowedSignatureUrl, 'URL tanda tangan harus menunjuk ke domain yayasan')
  .optional();

export const createCertificateSchema = sharedCreateCertificateSchema.extend({
  signatureUrl: guardedSignatureUrl,
});

export const updateCertificateSchema = partialUpdateSchema(createCertificateSchema).omit({
  studentId: true,
});

export const queryCertificateSchema = sharedQueryCertificateSchema;

export type CreateCertificateDto = z.infer<typeof createCertificateSchema>;
export type UpdateCertificateDto = z.infer<typeof updateCertificateSchema>;
export type QueryCertificateDto = z.infer<typeof queryCertificateSchema>;
