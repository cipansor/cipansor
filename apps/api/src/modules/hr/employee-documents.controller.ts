import { Request, Response, NextFunction } from 'express';
import { employeeDocumentService } from './employee-documents.service';
import { requireUser } from '../../middleware/auth';
import { assertMayReadEmployeeRecord } from './hr.service';
import { z } from 'zod';
import { EmployeeDocumentType } from '@prisma/client';

const createDocumentSchema = z.object({
  userId: z.string().uuid(),
  name: z.string().min(1),
  type: z.nativeEnum(EmployeeDocumentType),
  fileUrl: z.string().url(),
  expiryDate: z.coerce.date().optional(),
  notes: z.string().optional(),
});

export const employeeDocumentController = {
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data = createDocumentSchema.parse(req.body);
      const result = await employeeDocumentService.create(data);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },

  async findAll(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId } = req.params;
      await assertMayReadEmployeeRecord(requireUser(req), userId);
      const result = await employeeDocumentService.findAll(userId);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      await employeeDocumentService.delete(req.params.id);
      res.json({ success: true, message: 'Document deleted' });
    } catch (error) {
      next(error);
    }
  },
};
