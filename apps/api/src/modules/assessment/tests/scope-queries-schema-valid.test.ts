import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    teacher: { findFirst: vi.fn() },
    teacherSubject: { findMany: vi.fn() },
    student: { findMany: vi.fn() },
    takhosusEnrollment: { findMany: vi.fn() },
    musyrif: { findFirst: vi.fn() },
    musyrifAssignment: { findMany: vi.fn() },
    roomAssignment: { findMany: vi.fn() },
    class: { findMany: vi.fn() },
  },
}));

import { prisma } from '@/lib/prisma';
import { actorExamSubjects } from '../assessment-writer';
import { teachingRelations } from '@/utils/teaching-relation';

const mocked = prisma as any;

/**
 * The write-scope helpers must build queries the Prisma schema actually accepts
 * (#987).
 *
 * A `where` that names a field a model does not have — `Teacher.isActive`, when
 * the model soft-deletes via `deletedAt` — slips past every other guard:
 * `tsc`'s excess-property check is skipped once the object literal also carries
 * a known property (`{ userId, isActive }`), and the unit tests mock `prisma`,
 * so the invalid `where` never reaches a real client. In production Prisma
 * rejects it with a `PrismaClientValidationError` (a 500) before it queries.
 *
 * Like `marketing/tests/roi-query-shape.test.ts`, this runs the real arguments
 * through a real client's validator: Prisma rejects an invalid `where` *before*
 * it opens a connection, so the wrong shape fails here with no database. The
 * delegates return canned rows so every query on the path is exercised.
 */
const validatingClient = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: 'postgresql://unused:unused@127.0.0.1:5999/unused',
  }),
});

/** Pass the real args to the real validator, then hand the caller a canned row. */
function validating<T extends (...args: never[]) => unknown>(fn: T, result: unknown) {
  return async (args: unknown) => {
    try {
      await fn(args as never);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientValidationError) throw error;
    }
    return result;
  };
}

beforeAll(() => {
  mocked.teacher.findFirst.mockImplementation(
    validating(validatingClient.teacher.findFirst.bind(validatingClient), {
      id: 'teacher-1',
      unitId: 'unit-1',
    })
  );
  mocked.teacherSubject.findMany.mockImplementation(
    validating(validatingClient.teacherSubject.findMany.bind(validatingClient), [
      { classId: 'class-1' },
    ])
  );
  mocked.student.findMany.mockImplementation(
    validating(validatingClient.student.findMany.bind(validatingClient), [
      { id: 'student-1', unitId: 'unit-1', enrollments: [{ classId: 'class-1' }] },
    ])
  );
  mocked.takhosusEnrollment.findMany.mockImplementation(
    validating(validatingClient.takhosusEnrollment.findMany.bind(validatingClient), [])
  );
  mocked.musyrif.findFirst.mockImplementation(
    validating(validatingClient.musyrif.findFirst.bind(validatingClient), {
      id: 'musyrif-1',
    })
  );
  mocked.musyrifAssignment.findMany.mockImplementation(
    validating(validatingClient.musyrifAssignment.findMany.bind(validatingClient), [
      { dormitoryId: 'dorm-1', roomId: null },
    ])
  );
  mocked.roomAssignment.findMany.mockImplementation(
    validating(validatingClient.roomAssignment.findMany.bind(validatingClient), [
      { studentId: 'student-1', room: { id: 'room-1', dormitoryId: 'dorm-1' } },
    ])
  );
  mocked.class.findMany.mockImplementation(
    validating(validatingClient.class.findMany.bind(validatingClient), [{ id: 'class-1' }])
  );
});

afterAll(async () => {
  await validatingClient.$disconnect();
});

describe('assessment scope queries are schema-valid', () => {
  const actor = { sub: 'user-1', roleCode: 'SMPIT_GURU', unitId: 'unit-1' };

  it('actorExamSubjects resolves against a schema-valid Teacher query', async () => {
    const facts = await actorExamSubjects(actor);
    expect(facts).toHaveLength(1);
    expect(facts[0].classId).toBe('class-1');
  });

  it('teachingRelations resolves against schema-valid queries', async () => {
    const relations = await teachingRelations(actor.sub, ['student-1']);
    expect(relations.get('student-1')).toEqual(new Set(['SUBJECT', 'MUSYRIF', 'HOMEROOM']));
  });
});
