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
 * nginx numbers its branches so that the even minor is stable and the odd one
 * is mainline. The table below is the single source of truth: a branch must be
 * listed with its EOL date, and the pinned branch must be one whose date is
 * null. Adding a branch, or letting one reach EOL, is therefore a conscious
 * edit here rather than a tag that drifts past support unseen. Dates from
 * https://endoflife.date/nginx (checked 2026-11-17).
 */

const ROOT = resolve(__dirname, '..', '..', '..', '..');
const DOCKERFILE = resolve(ROOT, 'deploy/azure/nginx/Dockerfile');

/** branch → end-of-life date, or null while the branch is still supported. */
const BRANCHES: Record<string, string | null> = {
  '1.28': '2026-04-14',
  '1.29': '2026-05-13',
  '1.30': null,
  '1.31': null,
};

function pinnedBranch(): string {
  const text = readFileSync(DOCKERFILE, 'utf8');
  const match = /^FROM\s+nginx:(\d+\.\d+)-alpine\b/m.exec(text);
  expect(match, 'no "FROM nginx:<major>.<minor>-alpine" in the nginx Dockerfile').not.toBeNull();
  return match?.[1] as string;
}

describe('nginx base image branch', () => {
  it('pins an explicit stable branch on the alpine variant', () => {
    // The regex only matches `<major>.<minor>-alpine`, so a floating tag
    // (`nginx:alpine`) or a non-alpine variant fails the parse above.
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
    const eol = BRANCHES[branch];
    expect(
      eol ?? null,
      `nginx ${branch} reached end of life on ${eol}; pin a supported branch instead (#1128)`
    ).toBeNull();
  });
});
