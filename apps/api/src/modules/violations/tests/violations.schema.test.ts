import { describe, it, expect } from 'vitest';
import { queryViolationSchema } from '../violations.schema';

/**
 * The staff dashboard's "Pelanggaran Hari Ini" card asks for one day:
 * `GET /violations?date=YYYY-MM-DD&limit=1` and reads `meta.pagination.total`.
 * Zod strips unknown keys, so while `date` was absent from the schema the
 * controller parsed it away and the service saw no date filter at all — the
 * card counted every violation ever recorded. This pins the param to the
 * schema; the day-bounded `where` is pinned in violations.service.test.ts.
 */
describe('queryViolationSchema — date', () => {
  it('keeps the single-day filter instead of stripping it', () => {
    const parsed = queryViolationSchema.parse({ date: '2026-10-05' });
    expect(parsed.date).toBe('2026-10-05');
  });

  it('still applies the page/limit defaults beside it', () => {
    const parsed = queryViolationSchema.parse({ date: '2026-10-05' });
    expect(parsed.page).toBe(1);
    expect(parsed.limit).toBe(20);
  });
});
