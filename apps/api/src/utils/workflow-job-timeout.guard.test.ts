import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';

/**
 * Every job in every workflow must set `timeout-minutes`.
 *
 * GitHub's default is 360 minutes. A job that hangs — a stuck deploy, a load
 * test that never returns, a step waiting on a lock — therefore holds its
 * concurrency group and occupies a runner for up to six hours. The repository
 * already caps every other job; the deploy and load-test jobs are the ones that
 * can block a release or a production environment, so they are exactly where an
 * explicit, tighter ceiling matters most (#867).
 *
 * A missing `timeout-minutes` is invisible in a diff a reviewer skims, and a
 * new job added later would inherit the 360-minute default silently. This guard
 * makes the ceiling a rule rather than a habit.
 */

const ROOT = resolve(__dirname, '..', '..', '..', '..');
const WORKFLOWS = resolve(ROOT, '.github', 'workflows');

/** The platform default this guard exists to keep jobs away from. */
const PLATFORM_DEFAULT = 360;

/** Jobs that must be present, so a broken walker cannot pass by finding none. */
const MUST_FIND = [
  'deploy-production.yml:deploy',
  'deploy-staging.yml:build',
  'load-tests.yml:smoke',
];

interface Job {
  file: string;
  name: string;
  timeout: unknown;
}

function workflowFiles(): string[] {
  return readdirSync(WORKFLOWS)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .map((name) => resolve(WORKFLOWS, name));
}

function jobsOf(file: string): Job[] {
  const doc = parse(readFileSync(file, 'utf8')) as { jobs?: Record<string, unknown> } | null;
  const jobs = doc?.jobs ?? {};
  return Object.entries(jobs).map(([name, body]) => ({
    file,
    name,
    timeout:
      body && typeof body === 'object'
        ? (body as Record<string, unknown>)['timeout-minutes']
        : undefined,
  }));
}

function allJobs(): Job[] {
  return workflowFiles().flatMap(jobsOf);
}

describe('every workflow job sets a timeout-minutes ceiling', () => {
  it('the scan reads the workflows it guards', () => {
    const files = workflowFiles();
    expect(
      files.length,
      'no workflow files found — the guard would pass vacuously'
    ).toBeGreaterThan(0);

    const jobs = allJobs();
    expect(jobs.length, 'no jobs found at all').toBeGreaterThan(0);

    const seen = new Set(jobs.map((job) => `${job.file.split('/').pop()}:${job.name}`));
    for (const wanted of MUST_FIND) {
      expect(seen.has(wanted), `expected to find job ${wanted}; the scan is blind`).toBe(true);
    }
  });

  it('every job sets timeout-minutes', () => {
    const offenders = allJobs()
      .filter((job) => job.timeout === undefined)
      .map((job) => `${job.file}:${job.name}`);
    expect(
      offenders,
      `these jobs have no timeout-minutes and fall back to the ${PLATFORM_DEFAULT}-minute default:\n${offenders.join('\n')}`
    ).toEqual([]);
  });

  it('every timeout-minutes is a positive integer well below the platform default', () => {
    const offenders: string[] = [];
    for (const job of allJobs()) {
      if (job.timeout === undefined) continue; // covered by the test above
      const value = job.timeout;
      if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
        offenders.push(`${job.file}:${job.name} timeout-minutes=${JSON.stringify(value)}`);
      } else if (value >= PLATFORM_DEFAULT) {
        offenders.push(
          `${job.file}:${job.name} timeout-minutes=${value} is no tighter than the ${PLATFORM_DEFAULT}-minute default`
        );
      }
    }
    expect(
      offenders,
      `these timeout-minutes values are not a meaningful ceiling:\n${offenders.join('\n')}`
    ).toEqual([]);
  });

  it('the check fires on the shape it exists to catch', () => {
    // A guard that cannot fail on the defect is not a guard: the parse must see
    // a missing key as `undefined` (the defect) and a present one as a number.
    const withTimeout = parse(
      'jobs:\n  a:\n    runs-on: ubuntu-latest\n    timeout-minutes: 5\n'
    ) as { jobs: Record<string, Record<string, unknown>> };
    expect(withTimeout.jobs.a['timeout-minutes']).toBe(5);

    const without = parse('jobs:\n  a:\n    runs-on: ubuntu-latest\n') as {
      jobs: Record<string, Record<string, unknown>>;
    };
    expect(without.jobs.a['timeout-minutes']).toBeUndefined();
  });
});
