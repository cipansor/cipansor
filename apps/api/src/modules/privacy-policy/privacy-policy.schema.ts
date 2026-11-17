import { z } from 'zod';

/**
 * Skema modul Kebijakan Privasi. Kontrak yang dibagi ke web hidup di
 * `@cipansor/shared` (`schemas/privacy-policy.ts`); berkas ini hanya menambah
 * yang khusus peladen — nomor versi di jalur URL.
 */

export {
  createPrivacyPolicyVersionSchema,
  listPrivacyPolicyVersionsQuerySchema,
  type CreatePrivacyPolicyVersionInput,
  type ListPrivacyPolicyVersionsQuery,
} from '@cipansor/shared';

/** `:version` di jalur — bilangan bulat positif, bukan string bebas. */
export const versionParamSchema = z.object({
  version: z.coerce.number().int().positive('Versi kebijakan privasi tidak valid'),
});
