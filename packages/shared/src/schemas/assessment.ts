import { z } from "zod";
import { SECURITY_EVENT_TYPES } from "../types/assessment";

/**
 * Request contract for recording a CBT exam-integrity event. Shared between the
 * API (edge validation) and the web client so both sides agree on the request
 * shape for `POST /cbt/attempts/:id/security-log`.
 *
 * The event name was previously `z.nativeEnum(SecurityEventType).or(z.string())`,
 * and that `.or(z.string())` defeated the whole check: every string passed, so an
 * unknown name travelled to the database and could only fail there. It is now a
 * closed list, drawn from the same `SECURITY_EVENT_TYPES` the table's CHECK
 * constraint is generated against.
 *
 * `details` is an object, not a sentence: it lands in a JSONB column, so what is
 * written there can be queried and aggregated afterwards. Something a person will
 * read goes in `{ note }`.
 */
export const recordSecurityLogSchema = z.object({
  eventType: z.enum(SECURITY_EVENT_TYPES),
  details: z.record(z.string(), z.unknown()).nullable().optional(),
});

export type RecordSecurityLogInput = z.infer<typeof recordSecurityLogSchema>;

/**
 * Response contract for `GET /cbt/exams/:id/difficulty-insights`.
 *
 * The distractor count belongs to the canonical option id. When several option
 * texts share that id, `option` is null and `options` lists every text that
 * shares it; the student form submits only the id, so the count cannot be
 * attributed to one of those texts.
 */
export const examDistractorAnalysisRowSchema = z.object({
  optionId: z.string().nullable(),
  option: z.unknown(),
  options: z.array(z.unknown()),
  ambiguous: z.boolean(),
  count: z.number(),
  percentage: z.number(),
});

export const examQuestionInsightSchema = z.object({
  questionId: z.string(),
  content: z.string(),
  successRate: z.number(),
  difficultyIndex: z.number().nullable(),
  discriminationIndex: z.number().nullable(),
  distractorAnalysis: z.array(examDistractorAnalysisRowSchema).optional(),
  totalGraded: z.number(),
  isKiller: z.boolean(),
  needsReview: z.boolean(),
});

export const examDifficultyInsightsSchema = z.object({
  examId: z.string(),
  title: z.string(),
  questionInsights: z.array(examQuestionInsightSchema),
  averageSuccessRate: z.number(),
  totalParticipants: z.number(),
  discriminationGroupSize: z.number().nullable(),
});

export type ExamDistractorAnalysisRow = z.infer<
  typeof examDistractorAnalysisRowSchema
>;
export type ExamQuestionInsight = z.infer<typeof examQuestionInsightSchema>;
export type ExamDifficultyInsights = z.infer<
  typeof examDifficultyInsightsSchema
>;
