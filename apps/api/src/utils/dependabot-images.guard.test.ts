import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parse } from 'yaml';

/**
 * Dependabot must watch the container images, not only Actions and npm.
 *
 * `.github/dependabot.yml` watched `github-actions` and `npm` and nothing else,
 * so a base-image tag could pass its end of life unnoticed. That is not
 * hypothetical: `nginx:1.28-alpine` (the production edge) went EOL and no PR
 * ever offered the move (#1128). Dependabot supports the `docker` and
 * `docker-compose` ecosystems, so this is a configuration gap, not a tool
 * limit.
 *
 * The guard exists because the gap is invisible in a diff: a Dockerfile that
 * nothing watches still builds today and only bites when its tag ages out. It
 * pins the three things that make the coverage real — an entry per Dockerfile
 * directory, one for the compose file, and the same quiet schedule and grouping
 * the existing entries use so the PRs do not flood the queue.
 *
 * It cannot prove Dependabot *ran*; that is the Dependabot tab on GitHub. It
 * proves the config gives it every surface to run on, and fails the moment a
 * new Dockerfile lands without a matching entry.
 */

const ROOT = resolve(__dirname, '..', '..', '..', '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', '.next', '.pnpm-store']);

interface Update {
  'package-ecosystem': string;
  directory: string;
  schedule?: { interval?: string; day?: string; time?: string };
  groups?: Record<string, { 'update-types'?: string[]; patterns?: string[] }>;
  'open-pull-requests-limit'?: number;
}

function dependabotUpdates(): Update[] {
  const doc = parse(readFileSync(resolve(ROOT, '.github', 'dependabot.yml'), 'utf8')) as {
    version?: number;
    updates?: Update[];
  };
  expect(doc?.version, 'dependabot.yml must declare `version: 2`').toBe(2);
  return doc?.updates ?? [];
}

const IMAGE_ECOSYSTEMS = ['docker', 'docker-compose'];
const WATCHED_ECOSYSTEMS = ['github-actions', 'npm', ...IMAGE_ECOSYSTEMS];

/** `/apps/api` for `apps/api/Dockerfile` — the `directory` Dependabot expects. */
function dockerfileDirs(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === 'Dockerfile') found.push('/' + dirname(full.slice(ROOT.length + 1)));
    }
  };
  walk(ROOT);
  return found;
}

/** Does the Dockerfile reference at least one image Dependabot can bump? */
function hasImageReference(directory: string): boolean {
  const text = readFileSync(resolve(ROOT, directory.replace(/^\//, ''), 'Dockerfile'), 'utf8');
  const stages = new Set<string>();
  for (const line of text.split('\n')) {
    const match = /^FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?/i.exec(line);
    if (!match) continue;
    const [, image, alias] = match;
    // A `FROM` naming an earlier stage is a build step, not an image to bump.
    if (!stages.has(image)) return true;
    if (alias) stages.add(alias);
  }
  return false;
}

describe('Dependabot watches the container images', () => {
  const updates = dependabotUpdates();
  const dockerDirs = updates
    .filter((u) => u['package-ecosystem'] === 'docker')
    .map((u) => u.directory);

  it('the scan reads the surfaces it guards', () => {
    expect(updates.length, 'dependabot.yml has no `updates`').toBeGreaterThan(0);
    expect(
      dockerfileDirs().length,
      'no Dockerfile found — the guard would pass vacuously'
    ).toBeGreaterThan(0);
  });

  it('every ecosystem it declares is one we intend to watch', () => {
    for (const update of updates) {
      expect(
        WATCHED_ECOSYSTEMS,
        `unexpected dependabot ecosystem "${update['package-ecosystem']}"`
      ).toContain(update['package-ecosystem']);
    }
  });

  it('registers a docker entry for every Dockerfile directory', () => {
    for (const dir of dockerfileDirs()) {
      expect(dockerDirs, `no dependabot "docker" entry for ${dir}`).toContain(dir);
    }
  });

  it('each registered docker directory holds an image reference', () => {
    for (const dir of dockerDirs) {
      expect(hasImageReference(dir), `${dir}/Dockerfile has no bumpable FROM`).toBe(true);
    }
  });

  it('registers a docker-compose entry for the repository root', () => {
    const composeDirs = updates
      .filter((u) => u['package-ecosystem'] === 'docker-compose')
      .map((u) => u.directory);
    expect(composeDirs, 'no dependabot "docker-compose" entry for /').toContain('/');
  });

  it('the image entries keep the quiet weekly Monday schedule', () => {
    const images = updates.filter((u) => IMAGE_ECOSYSTEMS.includes(u['package-ecosystem']));
    expect(images.length, 'no image entries to check').toBeGreaterThan(0);
    for (const update of images) {
      const where = `${update['package-ecosystem']} ${update.directory}`;
      expect(update.schedule?.interval, `${where} interval`).toBe('weekly');
      expect(update.schedule?.day, `${where} day`).toBe('monday');
    }
  });

  it('the image entries batch minor and patch updates like the npm entry', () => {
    const images = updates.filter((u) => IMAGE_ECOSYSTEMS.includes(u['package-ecosystem']));
    for (const update of images) {
      const where = `${update['package-ecosystem']} ${update.directory}`;
      const groups = Object.values(update.groups ?? {});
      expect(
        groups.length,
        `${where} has no groups — every bump would open its own PR`
      ).toBeGreaterThan(0);
      const batched = groups.some((group) => {
        const types = group['update-types'] ?? [];
        return types.includes('minor') && types.includes('patch');
      });
      expect(batched, `${where} does not batch minor+patch`).toBe(true);
    }
  });
});
