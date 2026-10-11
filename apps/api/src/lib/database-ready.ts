import { prisma } from '@/lib/prisma';

/**
 * Whether Postgres answers — the readiness half of GET /health (#665).
 *
 * Bounded, because /health is public and not rate limited, and two things
 * poll it: the release workflow (deploy/azure/wait-for-release.sh) and App
 * Service Health check. So:
 *
 * - the probe gives up after `TIMEOUT_MS`: an unreachable database answers
 *   "not ready" at once, not after Prisma's own connect timeout;
 * - the answer is kept for `CACHE_MS`, and callers that arrive while a probe
 *   runs share it: a flood of /health requests costs one `SELECT 1` per
 *   `CACHE_MS`, never one per request.
 *
 * It never rejects.
 */
export const TIMEOUT_MS = 2_000;
export const CACHE_MS = 5_000;

let cached: { ready: boolean; at: number } | null = null;
let inFlight: Promise<boolean> | null = null;

export function databaseReady(): Promise<boolean> {
  if (cached && Date.now() - cached.at < CACHE_MS) return Promise.resolve(cached.ready);
  if (inFlight) return inFlight;

  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), TIMEOUT_MS);
  });
  const probe = prisma.$queryRaw`SELECT 1`.then(
    () => true,
    () => false
  );
  inFlight = Promise.race([probe, timedOut]).then((ready) => {
    clearTimeout(timer);
    cached = { ready, at: Date.now() };
    inFlight = null;
    return ready;
  });
  return inFlight;
}

/** Forget the kept answer — for tests. */
export function resetDatabaseReady(): void {
  cached = null;
  inFlight = null;
}
