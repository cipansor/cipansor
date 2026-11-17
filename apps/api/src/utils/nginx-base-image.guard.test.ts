import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The nginx container is the production edge — the deployment guide states it
 * is the only container Azure App Service sends traffic to, routing `/api` and
 * `/uploads` to `api` and the rest to `web`. A branch that has reached its end
 * of life stops receiving security fixes, so the tag is a security decision,
 * not a cosmetic one: the image sat on `1.28`, EOL `2026-04-14`, and shipped
 * five nginx advisories fixed only in `1.30.6+` / `1.31.7+` (#1128).
 *
 * The table below is the single source of truth: the pinned branch must be
 * listed and must not have reached its EOL. The owner first chose a stable
 * (even-minor) branch on #1128, then accepted the mainline `1.31` line
 * (2026-11-17) — so the release line is no longer a gate, only the EOL date is.
 * Because nothing in the repo queries endoflife.date, a static table would
 * otherwise rot silently: the freshness tripwire below fails once the table is
 * older than MAX_AGE_DAYS, forcing a re-check rather than passing an EOL image.
 * Dates from https://endoflife.date/nginx.
 */

const ROOT = resolve(__dirname, '..', '..', '..', '..');
const DOCKERFILE = resolve(ROOT, 'deploy/azure/nginx/Dockerfile');

/** The day every date in the table was last checked against endoflife.date. */
const LAST_VERIFIED = '2026-11-17';
/** Re-check the table before it can be this stale. */
const MAX_AGE_DAYS = 120;

/** branch → its end-of-life date (null while supported). */
const BRANCHES: Record<string, { eol: string | null }> = {
  '1.28': { eol: '2026-04-14' },
  '1.29': { eol: '2026-05-13' },
  '1.30': { eol: null },
  '1.31': { eol: null },
};

function pinnedBranch(): string {
  const text = readFileSync(DOCKERFILE, 'utf8');
  const match = /^FROM\s+nginx:(\d+\.\d+)-alpine\b/m.exec(text);
  expect(match, 'no "FROM nginx:<major>.<minor>-alpine" in the nginx Dockerfile').not.toBeNull();
  return match?.[1] as string;
}

describe('nginx base image branch', () => {
  it('pins an explicit branch on the alpine variant', () => {
    // The regex only matches `<major>.<minor>-alpine`, so a floating tag
    // (`nginx:alpine`) or a non-alpine variant fails the parse.
    expect(pinnedBranch()).toMatch(/^\d+\.\d+$/);
  });

  it('pins a branch the table knows about', () => {
    const branch = pinnedBranch();
    expect(
      Object.keys(BRANCHES),
      `nginx ${branch} is not in the branch table — add it with its EOL date (https://endoflife.date/nginx)`
    ).toContain(branch);
  });

  it('does not pin a branch that has reached end of life', () => {
    const branch = pinnedBranch();
    const eol = BRANCHES[branch]?.eol;
    expect(
      eol ?? null,
      `nginx ${branch} reached end of life on ${eol}; pin a supported branch instead (#1128)`
    ).toBeNull();
  });

  it('re-checks the table before it can go stale', () => {
    const ageDays = (Date.now() - Date.parse(LAST_VERIFIED)) / 86_400_000;
    expect(
      ageDays,
      `the nginx branch table was last verified on ${LAST_VERIFIED} (${Math.floor(ageDays)} days ago) — re-check https://endoflife.date/nginx, update BRANCHES and LAST_VERIFIED (#1128)`
    ).toBeLessThan(MAX_AGE_DAYS);
  });
});
