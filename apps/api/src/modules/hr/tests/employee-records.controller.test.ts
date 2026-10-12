import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

vi.mock('../../../lib/prisma', () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));
vi.mock('../employee-documents.service', () => ({
  employeeDocumentService: { findAll: vi.fn().mockResolvedValue([]) },
}));
vi.mock('../employment-history.service', () => ({
  employmentHistoryService: { findAll: vi.fn().mockResolvedValue([]) },
}));
vi.mock('../leave-balances.service', () => ({
  leaveBalanceService: { getAllBalances: vi.fn().mockResolvedValue([]) },
}));
vi.mock('../contracts.service', () => ({
  contractService: { findByUser: vi.fn().mockResolvedValue([]) },
}));

import { prisma } from '../../../lib/prisma';
import { employeeDocumentController } from '../employee-documents.controller';
import { employmentHistoryController } from '../employment-history.controller';
import { leaveBalanceController } from '../leave-balances.controller';
import { contractController } from '../contracts.controller';
import { employeeDocumentService } from '../employee-documents.service';
import { employmentHistoryService } from '../employment-history.service';
import { leaveBalanceService } from '../leave-balances.service';
import { contractService } from '../contracts.service';

const findUnique = prisma.user.findUnique as unknown as ReturnType<typeof vi.fn>;

/**
 * The four reads of one employee's HR record beyond the directory, each with
 * the service call that would hand the record out. Every route is open to the
 * TEACHER and STAFF buckets, so the controller is where a colleague is turned
 * away (decisions/akses-data-pegawai.md).
 */
const reads = [
  {
    name: 'documents',
    handler: employeeDocumentController.findAll,
    service: () => employeeDocumentService.findAll,
  },
  {
    name: 'employment history',
    handler: employmentHistoryController.findAll,
    service: () => employmentHistoryService.findAll,
  },
  {
    name: 'leave balances',
    handler: leaveBalanceController.getBalances,
    service: () => leaveBalanceService.getAllBalances,
  },
  {
    name: 'contracts',
    handler: contractController.findByUser,
    service: () => contractService.findByUser,
  },
] as const;

function call(
  handler: (req: Request, res: Response, next: NextFunction) => unknown,
  user: { sub: string; roleCode: string; unitId: string | null },
  userId: string
) {
  const req = {
    params: { userId },
    query: { academicYearId: 'ay-1' },
    user: { ...user, id: user.sub },
  } as unknown as Request;
  const res = {
    json: vi.fn(),
    status: vi.fn().mockReturnThis(),
  } as unknown as Response;
  const next = vi.fn();
  return Promise.resolve(handler(req, res, next)).then(() => ({ res, next }));
}

const colleague = { sub: 'teacher-2', roleCode: 'SMPIT_GURU', unitId: 'unit-1' };
const unitAdmin = { sub: 'admin-1', roleCode: 'SMPIT_ADMIN', unitId: 'unit-1' };

describe('an employee’s HR record is read by the employee and its keepers only', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findUnique.mockResolvedValue({ unitId: 'unit-1' });
  });

  for (const read of reads) {
    it(`turns a colleague away from another employee’s ${read.name} with 404`, async () => {
      const { next } = await call(read.handler, colleague, 'teacher-7');

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
      expect(read.service()).not.toHaveBeenCalled();
    });

    it(`gives the employee their own ${read.name}`, async () => {
      const { next } = await call(read.handler, colleague, 'teacher-2');

      expect(next).not.toHaveBeenCalled();
      expect(read.service()).toHaveBeenCalled();
    });

    it(`gives the unit admin the ${read.name} of an employee in the unit`, async () => {
      const { next } = await call(read.handler, unitAdmin, 'teacher-7');

      expect(next).not.toHaveBeenCalled();
      expect(read.service()).toHaveBeenCalled();
    });
  }
});
