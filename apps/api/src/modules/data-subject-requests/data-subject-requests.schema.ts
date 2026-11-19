import { z } from 'zod';

/**
 * Skema modul permintaan hak subjek data.
 *
 * Kontrak yang dibagi ke web hidup di `@cipansor/shared`
 * (`schemas/data-subject-request.ts`); berkas ini hanya menambah yang khusus
 * peladen — bentuk jalur URL dan kueri yang tidak pernah dipakai web.
 */

export {
  createGuardianDataSubjectRequestSchema,
  createPublicDataSubjectRequestSchema,
  verifyPublicDataSubjectRequestSchema,
  updateDataSubjectRequestStatusSchema,
  listDataSubjectRequestsQuerySchema,
  DATA_SUBJECT_REQUEST_TYPES,
  DATA_SUBJECT_REQUEST_STATUSES,
  DATA_SUBJECT_CATEGORIES,
  DATA_SUBJECT_REQUEST_TYPE_LABELS,
  DATA_SUBJECT_REQUEST_STATUS_LABELS,
  DATA_SUBJECT_REQUEST_DUE_HOURS,
  DATA_SUBJECT_VERIFICATION_CODE_LENGTH,
  DATA_SUBJECT_VERIFICATION_MAX_ATTEMPTS,
  DATA_SUBJECT_VERIFICATION_TTL_MINUTES,
  type CreateGuardianDataSubjectRequestInput,
  type CreatePublicDataSubjectRequestInput,
  type VerifyPublicDataSubjectRequestInput,
  type UpdateDataSubjectRequestStatusInput,
  type ListDataSubjectRequestsQuery,
  type DataSubjectRequestDTO,
  type DataSubjectRequestSummaryDTO,
  type DataSubjectRequestAction,
  type PublicDataSubjectRequestCreatedDTO,
  type PublicDataSubjectRequestVerifiedDTO,
} from '@cipansor/shared';

/** `:id` di jalur — UUID, bukan string bebas. */
export const dataSubjectRequestIdParamSchema = z.object({
  id: z.string().uuid('Permintaan tidak valid'),
});
