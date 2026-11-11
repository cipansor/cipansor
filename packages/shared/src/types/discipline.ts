/**
 * The summaries behind the Pelanggaran and Penghargaan pages, and behind a
 * santri's behaviour tab. One contract for the API that builds them and the
 * web that reads them (AGENTS.md rule 8).
 */

/** `GET /violations/summary` and `GET /rewards/summary`: an optional WIB date range. */
export interface DisciplineSummaryRange {
  /** First WIB day, YYYY-MM-DD. */
  startDate?: string;
  /** Last WIB day, YYYY-MM-DD, included. */
  endDate?: string;
}

/** One recorded category (free text such as "akhlak") with its rows and points. */
export interface DisciplineCategoryCount {
  category: string;
  count: number;
  points: number;
}

/** A santri on the podium: most points first, ties broken by student id. */
export interface DisciplineTopStudent {
  studentId: string;
  name: string;
  count: number;
  points: number;
}

/** Violation severity as stored (`ViolationType` in the database). */
export type ViolationSeverity = "MINOR" | "MODERATE" | "MAJOR";

/** `GET /violations/summary`, counted over the santri the caller may see. */
export interface ViolationsSummary {
  totalViolations: number;
  totalPoints: number;
  bySeverity: Array<{ type: ViolationSeverity; count: number }>;
  byCategory: DisciplineCategoryCount[];
  topStudents: DisciplineTopStudent[];
}

/** `GET /rewards/summary`, counted over the santri the caller may see. */
export interface RewardsSummary {
  totalRewards: number;
  totalPoints: number;
  byCategory: DisciplineCategoryCount[];
  topStudents: DisciplineTopStudent[];
}

/** A violation row as the per-santri summary sends it (dates as ISO strings). */
export interface StudentViolationRow {
  id: string;
  type: ViolationSeverity;
  category: string;
  description: string;
  occurredAt: string;
  points: number;
  action?: string | null;
}

/** A reward row as the per-santri summary sends it. */
export interface StudentRewardRow {
  id: string;
  category: string;
  description: string;
  givenAt: string;
  points: number;
}

/**
 * `GET /violations/student/:studentId/summary`. The groups are Prisma's
 * `groupBy` with `_count: true`, so `_count` is a number.
 */
export interface StudentViolationSummary {
  totalPoints: number;
  recentViolations: StudentViolationRow[];
  byType: Array<{ type: ViolationSeverity; _count: number }>;
  byCategory: Array<{ category: string; _count: number }>;
}

/** `GET /rewards/student/:studentId/summary`. */
export interface StudentRewardSummary {
  totalPoints: number;
  recentRewards: StudentRewardRow[];
  byCategory: Array<{
    category: string;
    _count: number;
    _sum: { points: number | null };
  }>;
}
