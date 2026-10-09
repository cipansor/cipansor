import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { readFileSync, readdirSync } from 'fs';
import { basename, join, relative, resolve } from 'path';

/**
 * `.github/scripts/change-scope.sh` decides whether CI, E2E and the staging
 * deploy run at all. If it calls something "not code" that a job actually
 * reads, that job is skipped and reports success, and nobody finds out until
 * the next code change fails for an unrelated-looking reason.
 */
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const SCRIPT = join(REPO_ROOT, '.github', 'scripts', 'change-scope.sh');

function codeAmong(paths: string[]): string[] {
  const out = execFileSync('sh', [SCRIPT, 'classify'], {
    input: paths.join('\n') + '\n',
    encoding: 'utf8',
  });
  return out.split('\n').filter(Boolean);
}

function walk(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'dist', 'coverage', '.pnpm-store'].includes(entry.name)) continue;
    if (entry.name.startsWith('.next')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, found);
    else found.push(full);
  }
  return found;
}

describe('change-scope.sh', () => {
  it('skips only what nothing builds, lints, tests or ships', () => {
    const notCode = [
      'AGENTS.md',
      'apps/web/AGENTS.md',
      'docs/ARCHITECTURE.md',
      'docs/img/galeri.png',
      '.claude/hooks/main-ci-watch.sh',
      '.claude/settings.json',
      '.github/PULL_REQUEST_TEMPLATE.md',
      'LICENSE',
    ];
    const code = [
      'apps/api/src/app.ts',
      'apps/web/middleware.ts',
      'apps/api/prisma/schema.prisma',
      'pnpm-lock.yaml',
      'package.json',
      '.github/workflows/ci.yml',
      '.github/scripts/change-scope.sh',
      'deploy/azure/nginx/nginx.conf',
      'docs/DEPLOYMENT.md', // a test reads it
      '.claude/hooks/guard.sh', // agent-guard.guard.test.ts runs it
    ];
    expect(codeAmong(notCode)).toEqual([]);
    expect(codeAmong(code)).toEqual(code);
  });

  it('calls every markdown file a test reads code', () => {
    const repoFiles = walk(REPO_ROOT).map((f) => relative(REPO_ROOT, f));
    const self = relative(REPO_ROOT, __filename);
    const tests = repoFiles.filter((f) => /\.(test|spec)\.tsx?$/.test(f) && f !== self);
    const read = new Set<string>();
    for (const test of tests) {
      const source = readFileSync(join(REPO_ROOT, test), 'utf8');
      for (const [, name] of source.matchAll(/['"`]([\w./-]+\.md)['"`]/g)) {
        for (const file of repoFiles) if (basename(file) === basename(name)) read.add(file);
      }
    }
    // Sanity: the one known reader must be found, or this scan is blind.
    expect([...read]).toContain('docs/DEPLOYMENT.md');

    const misclassified = [...read].filter((f) => !codeAmong([f]).includes(f));
    expect(
      misclassified,
      'a test reads these files but change-scope.sh would skip CI for a change to them — add each to the first branch of is_code()'
    ).toEqual([]);
  });
});
