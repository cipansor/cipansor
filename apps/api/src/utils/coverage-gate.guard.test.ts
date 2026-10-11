import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

/**
 * The coverage floor gate, driven against the real script:
 *
 *  - `coverage-gate.mjs` compares vitest's json-summary report against
 *    `.github/coverage-baseline.json` and fails when any metric dropped more
 *    than `tolerance_pct` below the committed floor.
 *  - The wiring assertions keep the gate connected: a PR that drops the
 *    `json-summary` reporter or the `Check coverage floor` CI step would leave
 *    the script dead code, which is exactly the failure this locks out.
 */
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const GATE = join(REPO_ROOT, '.github', 'scripts', 'coverage-gate.mjs');
const CI = join(REPO_ROOT, '.github', 'workflows', 'ci.yml');
const VITEST_CONFIG = join(REPO_ROOT, 'apps', 'api', 'vitest.config.ts');

let dir: string;
let n = 0;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'coverage-gate-'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const BASELINE = {
  metrics: { statements: 47.62, branches: 40.41, functions: 43.61, lines: 48.19 },
  tolerance_pct: 0.5,
};

function summary(pcts: Record<string, number>) {
  const metric = (pct: number) => ({ pct });
  return {
    total: {
      statements: metric(pcts.statements),
      branches: metric(pcts.branches),
      functions: metric(pcts.functions),
      lines: metric(pcts.lines),
    },
  };
}

function run(summaryBody: unknown, opts: { baseline?: unknown; gate?: string } = {}) {
  const id = n++;
  const summaryPath = join(dir, `summary-${id}.json`);
  const baselinePath = join(dir, `baseline-${id}.json`);
  writeFileSync(summaryPath, JSON.stringify(summaryBody));
  writeFileSync(baselinePath, JSON.stringify(opts.baseline ?? BASELINE));
  const r = spawnSync('node', [GATE], {
    encoding: 'utf8',
    env: {
      ...process.env,
      SUMMARY: summaryPath,
      BASELINE: baselinePath,
      ...(opts.gate ? { COVERAGE_GATE: opts.gate } : {}),
    },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe('the coverage floor gate', () => {
  it('passes when every metric is at or above the floor', () => {
    const r = run(summary({ statements: 50, branches: 45, functions: 46, lines: 50 }));
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('at or above the floor');
  });

  it('passes within the tolerance band', () => {
    // 47.62 - 0.5 = 47.12; 47.2 is below the floor but inside the tolerance.
    const r = run(summary({ statements: 47.2, branches: 40.41, functions: 43.61, lines: 48.19 }));
    expect(r.status).toBe(0);
  });

  it('fails and names the metric when it drops below the floor minus tolerance', () => {
    const r = run(summary({ statements: 40, branches: 40.41, functions: 43.61, lines: 48.19 }));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('statements');
  });

  it('is skipped entirely when COVERAGE_GATE=off', () => {
    const r = run(summary({ statements: 0, branches: 0, functions: 0, lines: 0 }), {
      gate: 'off',
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('skipped');
  });

  it('fails when the summary file is absent', () => {
    const r = spawnSync('node', [GATE], {
      encoding: 'utf8',
      env: {
        ...process.env,
        SUMMARY: join(dir, 'does-not-exist.json'),
        BASELINE: join(dir, 'baseline-missing.json'),
      },
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('not found');
  });

  it('fails when the summary has no total block (wrong reporter)', () => {
    const r = run({ files: {} });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('json-summary');
  });
});

describe('the coverage gate stays wired to CI', () => {
  it('runs the gate as its own step in the Tests job', () => {
    const ci = readFileSync(CI, 'utf8');
    expect(ci).toContain('Check coverage floor');
    expect(ci).toContain('node .github/scripts/coverage-gate.mjs');
    // The gate reads the report the coverage run writes, so the API suite must
    // be invoked with coverage in the same job.
    expect(ci).toContain('pnpm --filter api test:coverage');
  });

  it('has vitest write the json-summary the gate reads', () => {
    const cfg = readFileSync(VITEST_CONFIG, 'utf8');
    expect(cfg).toContain('json-summary');
    expect(cfg).toContain('reportOnFailure: true');
  });
});
