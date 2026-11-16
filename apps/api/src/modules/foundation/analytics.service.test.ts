import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/prisma', () => ({
  prisma: {
    student: { count: vi.fn() },
    userRoleAssignment: { count: vi.fn() },
    unit: { count: vi.fn() },
    registrant: { count: vi.fn() },
  },
}));

import { getExecutiveSummary } from './analytics.service';
import { prisma } from '../../lib/prisma';

describe('foundation analytics - getExecutiveSummary', () => {
  beforeEach(() => vi.clearAllMocks());

  it('includes the active admissions pipeline count and student growth', async () => {
    // Order of awaits: students(total), teachers, staff, units, registrants, studentsBeforeThisMonth.
    vi.mocked(prisma.student.count)
      .mockResolvedValueOnce(120) // total active students
      .mockResolvedValueOnce(100); // active students at the start of this month
    vi.mocked(prisma.userRoleAssignment.count)
      .mockResolvedValueOnce(40) // teachers
      .mockResolvedValueOnce(15); // staff
    vi.mocked(prisma.unit.count).mockResolvedValue(5);
    vi.mocked(prisma.registrant.count).mockResolvedValue(37);

    const summary = await getExecutiveSummary();

    expect(summary.totalStudents).toBe(120);
    expect(summary.totalTeachers).toBe(40);
    expect(summary.totalStaff).toBe(15);
    expect(summary.totalUnits).toBe(5);
    expect(summary.activeAdmissions).toBe(37);
    expect(summary.growth.students).toBe(20); // (120-100)/100 * 100

    // Active admissions must only count in-pipeline statuses.
    expect(prisma.registrant.count).toHaveBeenCalledWith({
      where: {
        status: {
          in: ['REGISTERED', 'DOCUMENT_CHECK', 'TEST_SCHEDULED', 'TEST_COMPLETED', 'ACCEPTED'],
        },
      },
    });
  });
});
