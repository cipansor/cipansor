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
      '.claude/skills/dokumen-aplikasi-cipansor/scripts/check_docs.py', // test_tooling.py reads it
      '.claude/skills/dokumen-aplikasi-cipansor/scripts/test_tooling.py', // the Tests job runs it
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

  // A guard that reads `docs/` by listing the directory names no file the scan
  // above can see: it matches literals, and `readdirSync(docs)` is not one. Such
  // a guard runs only in `Tests`, which a documentation-only change skips — so
  // the prose it should protect is exactly what slips past it. The docs-path
  // checker therefore belongs to the always-on job, and this pins it there.
  it('runs the docs-path checker in a job that every change reaches', () => {
    const ci = readFileSync(join(REPO_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
    // Split on job headers (two-space indent) — `security` is the last one, so a
    // lookahead for the next header would need an end-of-input case.
    const job = ci.split(/\n(?=  [a-z][\w-]*:\n)/).find((j) => j.startsWith('  security:\n')) ?? '';
    expect(job, 'ci.yml has no `security` job').not.toBe('');
    // The job's own header (before its first step) must not be scope-gated. Its
    // later steps may be — the heavy install and audit are — but the step that
    // runs the checker must not be, or a docs-only change skips it again.
    const header = job.split(/\n(?=      - )/)[0];
    expect(header, '`security` must not be gated on scope').not.toContain('if:');

    const step =
      job
        .split(/\n(?=      - )/)
        // Anchor on the line that EXECUTES it: the preceding step's trailing
        // comment also mentions the name, and matching that would check the
        // wrong step and pass while the real one is gated.
        .find((s) =>
          s
            .split('\n')
            .some((l) => l.trim().startsWith('python3 .github/scripts/check-doc-paths.py'))
        ) ?? '';
    expect(step, 'no step in `security` runs check-doc-paths.py').not.toBe('');
    expect(step, 'the docs-path step must run unconditionally').not.toContain('if:');
  });
});
