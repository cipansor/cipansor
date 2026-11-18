/**
 * How many Playwright workers the suite runs in — and so how many sessions per
 * role the e2e harness keeps.
 *
 * `playwright.config.ts` sizes the worker pool with this, and `global-setup.ts`
 * mints one session per worker with it. The sessions must not be shared: the
 * API rotates a refresh token on first use and deletes the presented row, so a
 * token two workers both hold is revoked the moment either refreshes — the
 * other is then answered 401 and bounced to `/login` mid-test (#1144).
 *
 * Override with `E2E_WORKERS` when a run uses a different `--workers` count.
 */
export const E2E_WORKERS = Number(
  process.env.E2E_WORKERS ?? (process.env.CI ? 2 : 4),
);

/**
 * This worker's index, as Playwright exposes it to the worker process. A spec
 * file's tests all run in one worker, so it is stable for the file; the session
 * cache keys on it so each worker reads only the session minted for it.
 */
export function currentWorkerIndex(): number {
  const raw = process.env.TEST_PARALLEL_INDEX;
  const n = raw === undefined ? 0 : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
