import { IncomeRange } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { Errors } from '@/middleware/error';
import { actorSeesUnit } from '@/utils/resolve-unit-id';
import { studentScope, type ScopeActor } from '@/utils/student-scope';
import { householdIncome, needScore, type HouseholdIncome } from '@/utils/household-income';
import {
  parseScholarshipTarget,
  type CreateScholarshipCriterionInput,
  type ScholarshipAssessmentResult,
  type ScholarshipCriterion,
  type ScholarshipCriterionScore,
} from '@cipansor/shared';

/** A criterion the scorer can read a value for, in the order the screen shows them. */
export interface ScorableCriterion {
  id: string;
  name: string;
  weight: number;
  targetValue: string | null;
}

/** What the scorer reads about a santri — nothing else is loaded. */
export interface ScoringFacts {
  /** `juz` of the latest tahfidz record, or `null` when the santri has none. */
  tahfidzJuz: number | null;
  /** Mean of the ten most recent grades, or `null` when the santri has none. */
  averageGrade: number | null;
  /** Income across father, mother and wali. */
  income: HouseholdIncome;
}

/**
 * Criteria whose value the machine cannot read are kept out of the total and
 * marked with the reason, so the screen can say why instead of showing a 0 that
 * looks like a judgement.
 */
export const MANUAL_REQUIRED = 'MANUAL_REQUIRED';
export const UNKNOWN = 'UNKNOWN';
export const NO_DATA = 'NO_DATA';

/** Values that mark an excluded assessment when it is read back from the store. */
export const EXCLUDED_VALUES: readonly string[] = [MANUAL_REQUIRED, UNKNOWN, NO_DATA];

export function isExcludedValue(value: string): boolean {
  return EXCLUDED_VALUES.includes(value);
}

const HAFALAN_KEYWORDS = ['hafalan', 'tahfidz'];
const ACADEMIC_KEYWORDS = ['akademik', 'nilai'];
const INCOME_KEYWORDS = ['penghasilan'];

/** The criterion family, decided by its name alone (case-insensitive). */
export type CriterionKind = 'HAFALAN' | 'AKADEMIK' | 'PENGHASILAN' | 'MANUAL';

export function criterionKind(name: string): CriterionKind {
  const lower = name.toLowerCase();
  if (HAFALAN_KEYWORDS.some((k) => lower.includes(k))) return 'HAFALAN';
  if (ACADEMIC_KEYWORDS.some((k) => lower.includes(k))) return 'AKADEMIK';
  if (INCOME_KEYWORDS.some((k) => lower.includes(k))) return 'PENGHASILAN';
  return 'MANUAL';
}

const clamp = (value: number) => Math.min(100, Math.max(0, value));

/**
 * The number of a target such as `10 juz`, `85%` or `85,5%`. The unit is a note
 * for the reader, not part of the value; a target that carries no readable
 * number falls back to the criterion's default.
 */
function targetNumber(value: string | null, fallback: number): number {
  return parseScholarshipTarget(value)?.value ?? fallback;
}

/**
 * Score one criterion against the santri's facts.
 *
 * Pure: the same criteria and facts always give the same answer, which is what
 * makes the score reproducible for the person deciding (R11.8, Property 20).
 */
function scoreOne(criterion: ScorableCriterion, facts: ScoringFacts): ScholarshipCriterionScore {
  const base = {
    criterionId: criterion.id,
    name: criterion.name,
    weight: criterion.weight,
  };

  switch (criterionKind(criterion.name)) {
    case 'HAFALAN': {
      if (facts.tahfidzJuz === null) {
        return { ...base, value: NO_DATA, score: null, excluded: true };
      }
      const target = parseScholarshipTarget(criterion.targetValue);
      // A percentage target on a juz criterion would score every santri
      // against 85 juz; say the target is unusable instead of scoring it.
      if (target?.percent) {
        return { ...base, value: MANUAL_REQUIRED, score: null, excluded: true };
      }
      const juzTarget = target?.value ?? 30;
      return {
        ...base,
        value: String(facts.tahfidzJuz),
        score: clamp((facts.tahfidzJuz / juzTarget) * 100),
        excluded: false,
      };
    }
    case 'AKADEMIK': {
      if (facts.averageGrade === null) {
        return { ...base, value: NO_DATA, score: null, excluded: true };
      }
      const target = targetNumber(criterion.targetValue, 100);
      return {
        ...base,
        value: String(facts.averageGrade),
        score: clamp((facts.averageGrade / target) * 100),
        excluded: false,
      };
    }
    case 'PENGHASILAN': {
      if (!facts.income.known) {
        return { ...base, value: UNKNOWN, score: null, excluded: true };
      }
      return {
        ...base,
        value: facts.income.bracket,
        score: needScore(facts.income),
        excluded: false,
      };
    }
    default:
      return { ...base, value: MANUAL_REQUIRED, score: null, excluded: true };
  }
}

/**
 * Score a program's criteria against a santri's facts.
 *
 * The total is the weighted mean of the criteria that carry a value; the
 * criteria the machine cannot read are left out rather than counted as zero, and
 * the answer says whether anything was left out. When nothing could be scored
 * the total is `null` — no evidence is not a score of 0.
 */
export function scoreCriteria(
  criteria: readonly ScorableCriterion[],
  facts: ScoringFacts
): ScholarshipAssessmentResult {
  const scored = criteria.map((criterion) => scoreOne(criterion, facts));
  const counted = scored.filter((c) => !c.excluded && c.score !== null);

  const totalWeight = counted.reduce((sum, c) => sum + c.weight, 0);
  const weighted = counted.reduce((sum, c) => sum + (c.score as number) * c.weight, 0);
  const mean = weighted / totalWeight;

  return {
    criteria: scored,
    // Deprecated alias: this route used to answer with `assessments`. Keep it
    // until no client reads it, so an older caller is not left without details.
    assessments: scored,
    // Clamped: summing `100 * w` then dividing by `Σw` in floating point can
    // land at 100.00000000000001, and a score above 100 is not a score.
    totalScore: counted.length > 0 && totalWeight > 0 ? Math.min(100, Math.max(0, mean)) : null,
    complete: scored.every((c) => !c.excluded),
  };
}

/** The student columns the scorer reads — and only those (R11.2). */
const SCORING_STUDENT_SELECT = {
  id: true,
  tahfidzRecords: { orderBy: { recordedAt: 'desc' }, take: 1, select: { juz: true } },
  grades: { orderBy: { gradedAt: 'desc' }, take: 10, select: { score: true, maxScore: true } },
  fatherIncome: true,
  fatherOccupation: true,
  motherIncome: true,
  motherOccupation: true,
  guardianIncome: true,
  guardianOccupation: true,
} as const;

const NOT_FOUND = 'Scholarship recipient';

export class ScholarshipScoringService {
  /**
   * Score a recipient against their program's criteria and store the result.
   *
   * The score supports the officer's decision; it never becomes one. Only the
   * per-criterion assessments and `totalScore` are written — `status`,
   * `approvedById`, `approvedAt` and `notes` stay as the officer left them
   * (R11.7).
   */
  async assessRecipient(
    actor: ScopeActor,
    recipientId: string
  ): Promise<ScholarshipAssessmentResult> {
    const recipient = await prisma.scholarshipRecipient.findUnique({
      where: { id: recipientId },
      select: {
        id: true,
        studentId: true,
        scholarship: {
          select: {
            unitId: true,
            criteria: {
              orderBy: { createdAt: 'asc' },
              select: { id: true, name: true, weight: true, targetValue: true },
            },
          },
        },
        student: { select: SCORING_STUDENT_SELECT },
      },
    });

    // Missing, another unit's program, or a santri outside the caller's scope
    // all answer the same 404, so an id never confirms what it names (R11.3).
    if (!recipient) throw Errors.notFound(NOT_FOUND);
    if (!actorSeesUnit(actor, recipient.scholarship.unitId)) throw Errors.notFound(NOT_FOUND);
    const inScope = await prisma.student.findFirst({
      where: { AND: [{ id: recipient.studentId }, studentScope(actor)] },
      select: { id: true },
    });
    if (!inScope) throw Errors.notFound(NOT_FOUND);

    const result = scoreCriteria(recipient.scholarship.criteria, factsOf(recipient.student));

    await prisma.$transaction([
      ...result.criteria.map((c) =>
        prisma.scholarshipAssessment.upsert({
          where: {
            recipientId_criterionId: { recipientId: recipient.id, criterionId: c.criterionId },
          },
          update: { value: c.value, score: c.score ?? 0 },
          create: {
            recipientId: recipient.id,
            criterionId: c.criterionId,
            value: c.value,
            score: c.score ?? 0,
          },
        })
      ),
      prisma.scholarshipRecipient.update({
        where: { id: recipient.id },
        data: { totalScore: result.totalScore },
      }),
    ]);

    return result;
  }

  /** Add a criterion to a program the caller may read. */
  async createCriterion(
    actor: ScopeActor,
    scholarshipId: string,
    input: CreateScholarshipCriterionInput
  ): Promise<ScholarshipCriterion> {
    const scholarship = await prisma.scholarship.findUnique({
      where: { id: scholarshipId },
      select: { unitId: true },
    });
    if (!scholarship || !actorSeesUnit(actor, scholarship.unitId)) {
      throw Errors.notFound('Scholarship');
    }
    return prisma.scholarshipCriterion.create({
      data: { ...input, scholarshipId },
    }) as unknown as Promise<ScholarshipCriterion>;
  }
}

/**
 * A grade on the 0–100 scale the academic target is written on. The gradebook
 * stores the points earned and the points possible separately, so a 20/20 exam
 * is a perfect score, not a 20.
 */
function gradePercentage(grade: { score: unknown; maxScore?: unknown }): number {
  const score = Number(grade.score);
  const maxScore = Number(grade.maxScore);
  if (Number.isFinite(score) && Number.isFinite(maxScore) && maxScore > 0) {
    return (score / maxScore) * 100;
  }
  return score;
}

/** Reduce the loaded student columns to what `scoreCriteria` takes. */
export function factsOf(student: {
  tahfidzRecords: Array<{ juz: number }>;
  grades: Array<{ score: unknown; maxScore?: unknown }>;
  fatherIncome: IncomeRange | null;
  fatherOccupation: Parameters<typeof householdIncome>[0]['fatherOccupation'];
  motherIncome: IncomeRange | null;
  motherOccupation: Parameters<typeof householdIncome>[0]['motherOccupation'];
  guardianIncome: IncomeRange | null;
  guardianOccupation: Parameters<typeof householdIncome>[0]['guardianOccupation'];
}): ScoringFacts {
  const averageGrade =
    student.grades.length > 0
      ? student.grades.reduce((sum, g) => sum + gradePercentage(g), 0) / student.grades.length
      : null;

  return {
    tahfidzJuz: student.tahfidzRecords[0]?.juz ?? null,
    averageGrade,
    income: householdIncome(student),
  };
}

export const scholarshipScoringService = new ScholarshipScoringService();
