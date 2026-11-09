import { z } from 'zod';
import { boardMemberFields } from '@cipansor/shared';

// Foundation schemas
export const createFoundationSchema = z.object({
  name: z.string().min(3).max(200),
  legalName: z.string().min(3).max(200),
  // A calendar day from the portal's date picker, or a full timestamp.
  foundingDate: z.union([z.iso.date(), z.iso.datetime()]).optional(),
  taxId: z.string().max(30).optional(),
  address: z.string().min(5),
  phone: z.string().max(20).optional(),
  email: z.string().email().optional(),
  website: z.string().url().optional(),
  logoUrl: z.string().url().optional(),
  vision: z.string().optional(),
  mission: z.string().optional(),
});

export const updateFoundationSchema = createFoundationSchema.partial();

export const queryFoundationSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  search: z.string().optional(),
});

// Board Member schemas
// The portal's form sends calendar days and no foundationId — the yayasan has
// one foundation record, which the service fills in. A start date nobody knows
// stays empty (null) rather than being guessed.
export const createBoardMemberSchema = z.object({
  foundationId: z.string().uuid().optional(),
  name: boardMemberFields.name,
  position: boardMemberFields.position,
  phone: boardMemberFields.phone.nullable().optional(),
  email: boardMemberFields.email.nullable().optional(),
  // A portrait on the site (`/images/people/…`) or an uploaded file's URL.
  photoUrl: z
    .string()
    .max(500)
    .regex(/^(\/[^/]|https:\/\/)/, 'A site path or an https URL')
    .nullable()
    .optional(),
  startDate: boardMemberFields.startDate.nullable().optional(),
  endDate: boardMemberFields.endDate.nullable().optional(),
  isActive: z.boolean().optional(),
});

export const updateBoardMemberSchema = createBoardMemberSchema
  .omit({ foundationId: true })
  .partial();

export const queryBoardMemberSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  foundationId: z.string().uuid().optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  search: z.string().optional(),
});

// Foundation Document schemas
export const createDocumentSchema = z.object({
  foundationId: z.string().uuid(),
  name: z.string().min(2).max(200),
  type: z.enum(['akta', 'sk', 'sertifikat', 'perizinan', 'lainnya']),
  documentNo: z.string().max(100).optional(),
  issueDate: z.string().datetime(),
  expiryDate: z.string().datetime().optional(),
  fileUrl: z.string().url().optional(),
  notes: z.string().optional(),
});

export const updateDocumentSchema = createDocumentSchema.partial().omit({ foundationId: true });

export const queryDocumentSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  foundationId: z.string().uuid().optional(),
  type: z.enum(['akta', 'sk', 'sertifikat', 'perizinan', 'lainnya']).optional(),
  search: z.string().optional(),
});

export type CreateFoundationInput = z.infer<typeof createFoundationSchema>;
export type UpdateFoundationInput = z.infer<typeof updateFoundationSchema>;
export type CreateBoardMemberInput = z.infer<typeof createBoardMemberSchema>;
export type UpdateBoardMemberInput = z.infer<typeof updateBoardMemberSchema>;
export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;
export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>;
