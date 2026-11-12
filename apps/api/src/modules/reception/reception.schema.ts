import { z } from 'zod';
import { VisitStatus, PackageStatus } from '@prisma/client';

// Flat schemas: `validate()` parses `req.body` directly, so a top-level
// `z.object({ body: … })` would make Zod look for `req.body.body` and answer
// every write with 400. Field names follow the shared DTO in
// `@cipansor/shared` (`types/reception.ts`) that the web form and the service
// both use (`relationship`, `needs`, `expedition`, `content`); the previous
// names (`relation`, `purpose`, `description`) were rejected or silently
// dropped.
export const createGuestBookSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  institution: z.string().optional(),
  purpose: z.string().min(1, 'Purpose is required'),
  phone: z.string().optional(),
  visitorCount: z.number().int().min(1).default(1),
  vehicleNumber: z.string().optional(),
  notes: z.string().optional(),
});

export const updateGuestBookSchema = z.object({
  checkOut: z.string().datetime().optional(),
  notes: z.string().optional(),
});

export const createStudentVisitSchema = z.object({
  studentId: z.string().uuid(),
  visitorName: z.string().min(1, 'Visitor name is required'),
  relationship: z.string().min(1, 'Relation is required'),
  needs: z.string().min(1, 'Purpose is required'),
  notes: z.string().optional(),
});

export const updateStudentVisitSchema = z.object({
  checkOut: z.string().datetime().optional(),
  status: z.nativeEnum(VisitStatus).optional(),
  notes: z.string().optional(),
});

export const createStudentPackageSchema = z.object({
  studentId: z.string().uuid(),
  senderName: z.string().min(1, 'Sender name is required'),
  expedition: z.string().min(1, 'Expedition is required'),
  content: z.string().min(1, 'Content is required'),
  photoUrl: z.string().optional(),
  storageLocation: z.string().optional(),
  notes: z.string().optional(),
});

export const updateStudentPackageSchema = z.object({
  status: z.nativeEnum(PackageStatus).optional(),
  pickedUpAt: z.string().datetime().optional(),
  deliveredTo: z.string().optional(),
  notes: z.string().optional(),
});

export type CreateGuestBookInput = z.infer<typeof createGuestBookSchema>;
export type UpdateGuestBookInput = z.infer<typeof updateGuestBookSchema>;
export type CreateStudentVisitInput = z.infer<typeof createStudentVisitSchema>;
export type UpdateStudentVisitInput = z.infer<typeof updateStudentVisitSchema>;
export type CreateStudentPackageInput = z.infer<typeof createStudentPackageSchema>;
export type UpdateStudentPackageInput = z.infer<typeof updateStudentPackageSchema>;
