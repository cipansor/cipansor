import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, chmodSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseArgs,
  slugFor,
  extract,
  compare,
  baselinePath,
  readBaseline,
  baselineMatches,
  summaryProblem,
  isSharedTarget,
  EXIT_CODES,
} from './run-load-tests.mjs';
import { REGRESSION, thresholdsFor, latencyLimit, healthPathFor } from './config.js';

test('parseArgs: defaults', () => {
  const args = parseArgs([]);
  assert.equal(args.profile, 'smoke');
  assert.equal(args.scenario, 'public-smoke');
  assert.equal(args.updateBaseline, false);
  assert.equal(args.json, false);
  assert.equal(args.allowSharedTarget, false);
});

test('parseArgs: reads every flag', () => {
  const args = parseArgs([
    '--url',
    'https://staging.cipansor.or.id',
    '--scenario',
    'authenticated-read',
    '--profile',
    'load',
    '--baseline',
    '/tmp/baseline.json',
    '--report',
    '/tmp/report.json',
    '--update-baseline',
    '--allow-shared-target',
    '--json',
  ]);
  assert.equal(args.url, 'https://staging.cipansor.or.id');
  assert.equal(args.scenario, 'authenticated-read');
  assert.equal(args.profile, 'load');
  assert.equal(args.baseline, '/tmp/baseline.json');
  assert.equal(args.report, '/tmp/report.json');
  assert.equal(args.updateBaseline, true);
  assert.equal(args.allowSharedTarget, true);
  assert.equal(args.json, true);
});

test('slugFor: a host becomes a filesystem-safe slug', () => {
  assert.equal(slugFor('https://staging.cipansor.or.id'), 'staging-cipansor-or-id');
  assert.equal(slugFor('http://localhost:3001'), 'localhost-3001');
});

test('slugFor: an unparseable URL does not throw', () => {
  assert.equal(slugFor('not a url'), 'unknown-target');
});

test('baselinePath: one baseline per host, scenario AND profile', () => {
  const p = baselinePath('https://staging.cipansor.or.id', 'public-smoke', 'smoke');
  assert.match(p, /staging-cipansor-or-id__public-smoke__smoke\.json$/);
  assert.notEqual(p, baselinePath('http://localhost:3001', 'public-smoke', 'smoke'));
  assert.notEqual(p, baselinePath('https://staging.cipansor.or.id', 'authenticated-read', 'smoke'));
  // The same host and scenario at a different profile is a different reference.
  assert.notEqual(p, baselinePath('https://staging.cipansor.or.id', 'public-smoke', 'load'));
});

test('isSharedTarget: recognises the shared staging host only', () => {
  assert.equal(isSharedTarget('https://staging.cipansor.or.id'), true);
  assert.equal(isSharedTarget('http://localhost:3001'), false);
  assert.equal(isSharedTarget('not a url'), false);
});

test('isSharedTarget: catches equivalent spellings of the shared host', () => {
  assert.equal(isSharedTarget('https://STAGING.CIPANSOR.OR.ID'), true);
  assert.equal(isSharedTarget('https://staging.cipansor.or.id/'), true);
  assert.equal(isSharedTarget('https://staging.cipansor.or.id.'), true);
  assert.equal(isSharedTarget('https://staging.cipansor.or.id.evil.example'), false);
});

test('readBaseline: a missing file is distinguishable from a malformed one', () => {
  const missing = readBaseline('/tmp/definitely-not-a-baseline-cipansor.json');
  assert.equal(missing.exists, false);
  assert.equal(missing.baseline, null);
  assert.equal(missing.error, null);
});

test('validateBaseline: a hand-edited baseline missing fields is unusable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cipansor-load-test-'));
  try {
    const path = join(dir, 'bad.json');
    writeFileSync(path, JSON.stringify({ p95: 100 })); // no url/scenario/profile
    const bad = readBaseline(path);
    assert.equal(bad.exists, true);
    assert.equal(bad.baseline, null);
    assert.match(bad.error, /missing "url"/);

    const malformedPath = join(dir, 'malformed.json');
    writeFileSync(malformedPath, '{ not json');
    const malformed = readBaseline(malformedPath);
    assert.equal(malformed.exists, true);
    assert.match(malformed.error, /malformed JSON/);

    const goodPath = join(dir, 'good.json');
    writeFileSync(goodPath, JSON.stringify({ url: 'http://localhost:3001', scenario: 'public-smoke', profile: 'smoke', p95: 10 }));
    const good = readBaseline(goodPath);
    assert.equal(good.error, null);
    assert.equal(good.baseline.p95, 10);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('baselineMatches: null when target, scenario and profile agree', () => {
  const baseline = { url: 'https://staging.cipansor.or.id', scenario: 'public-smoke', profile: 'smoke' };
  assert.equal(baselineMatches(baseline, { url: 'https://staging.cipansor.or.id/', scenario: 'public-smoke', profile: 'smoke' }), null);
});

test('baselineMatches: an equivalent spelling of the target is accepted', () => {
  const baseline = { url: 'https://staging.cipansor.or.id', scenario: 'public-smoke', profile: 'smoke' };
  // The filename slug already lowercases the host, so matching must too — else
  // the runner finds the baseline and then rejects it.
  assert.equal(
    baselineMatches(baseline, { url: 'https://STAGING.CIPANSOR.OR.ID', scenario: 'public-smoke', profile: 'smoke' }),
    null
  );
  assert.equal(
    baselineMatches(
      { url: 'https://staging.cipansor.or.id/', scenario: 'public-smoke', profile: 'smoke' },
      { url: 'https://staging.cipansor.or.id', scenario: 'public-smoke', profile: 'smoke' }
    ),
    null
  );
});

test('baselineMatches: a different scheme or port is still a different target', () => {
  const baseline = { url: 'https://staging.cipansor.or.id', scenario: 'public-smoke', profile: 'smoke' };
  assert.match(
    baselineMatches(baseline, { url: 'http://staging.cipansor.or.id', scenario: 'public-smoke', profile: 'smoke' }),
    /not http/
  );
  assert.match(
    baselineMatches(baseline, { url: 'https://staging.cipansor.or.id:8443', scenario: 'public-smoke', profile: 'smoke' }),
    /not https/
  );
});

test('baselineMatches: reports a different target, scenario or profile', () => {
  const baseline = { url: 'https://staging.cipansor.or.id', scenario: 'public-smoke', profile: 'smoke' };
  assert.match(
    baselineMatches(baseline, { url: 'http://localhost:3001', scenario: 'public-smoke', profile: 'smoke' }),
    /not http:\/\/localhost:3001/
  );
  assert.match(
    baselineMatches(baseline, { url: 'https://staging.cipansor.or.id', scenario: 'authenticated-read', profile: 'smoke' }),
    /scenario/
  );
  assert.match(
    baselineMatches(baseline, { url: 'https://staging.cipansor.or.id', scenario: 'public-smoke', profile: 'load' }),
    /profile/
  );
});

test('summaryProblem: a summary with no samples is not a measurement', () => {
  assert.match(summaryProblem({ metrics: {} }), /response counters/);
  assert.match(summaryProblem({ metrics: { expected_responses: { count: 0 } } }), /expected_response_duration/);
  assert.equal(summaryProblem({ metrics: { expected_responses: { count: 1 }, expected_response_duration: { 'p(95)': 1 } } }), null);
  assert.match(summaryProblem(undefined), /metrics/);
});


function summaryWith({ p50, p95, p99, avg, expected, unexpected, checksRate }) {
  // k6 v0.54 summary-export shape: metrics are flat, not nested under `values`.
  return {
    metrics: {
      expected_response_duration: { 'p(50)': p50, 'p(95)': p95, 'p(99)': p99, avg },
      expected_responses: { count: expected },
      unexpected_responses: { count: unexpected },
      checks: { value: checksRate },
    },
  };
}

test('extract: pulls percentiles and computes the real error rate', () => {
  const current = extract(summaryWith({ p50: 10, p95: 40, p99: 80, avg: 20, expected: 36, unexpected: 4, checksRate: 0.9 }));
  assert.equal(current.p50, 10);
  assert.equal(current.p95, 40);
  assert.equal(current.p99, 80);
  assert.equal(current.requests, 40);
  assert.equal(current.errorRate, 0.1);
  assert.equal(current.checksRate, 0.9);
});

test('extract: also reads the nested `values` shape some k6 builds emit', () => {
  const current = extract({
    metrics: {
      expected_response_duration: { values: { 'p(95)': 55 } },
      expected_responses: { values: { count: 2 } },
      unexpected_responses: { values: { count: 0 } },
    },
  });
  assert.equal(current.p95, 55);
  assert.equal(current.requests, 2);
  assert.equal(current.errorRate, 0);
});

test('extract: counts 429s separately from app errors', () => {
  const current = extract({
    metrics: {
      expected_response_duration: { 'p(95)': 20 },
      expected_responses: { count: 10 },
      unexpected_responses: { count: 0 },
      rate_limited: { count: 3 },
      checks: { value: 1 },
    },
  });
  // A throttled run has no app errors but is still not comparable.
  assert.equal(current.errorRate, 0);
  assert.equal(current.rateLimited, 3);
});

test('extract: latency comes from the same series the thresholds read', () => {
  // The overall http_req_duration carries the expected 401s; the thresholds do
  // not. If extract() ever reads the overall series again, this fails.
  const current = extract({
    metrics: {
      http_req_duration: { 'p(95)': 9999 },
      expected_response_duration: { 'p(95)': 55 },
      expected_responses: { count: 1 },
      unexpected_responses: { count: 0 },
    },
  });
  assert.equal(current.p95, 55);
  assert.deepEqual(Object.keys(thresholdsFor({ p95: 100, p99: 200 })), ['checks', 'expected_response_duration']);
});

test('extract: an empty summary does not divide by zero', () => {
  const current = extract({ metrics: {} });
  assert.equal(current.errorRate, 0);
  assert.equal(current.requests, 0);
  assert.equal(current.p95, undefined);
});

test('compare: no baseline means no regressions', () => {
  assert.deepEqual(compare({ p95: 9999, p99: 9999, errorRate: 0.9 }, null), []);
});

test('compare: a run inside the tolerances is not a regression', () => {
  const baseline = { p95: 100, p99: 200, errorRate: 0 };
  const current = { p95: 100 * REGRESSION.p95 - 1, p99: 200 * REGRESSION.p99 - 1, errorRate: 0 };
  assert.deepEqual(compare(current, baseline), []);
});

test('compare: a p95 step change is flagged with both numbers', () => {
  const regressions = compare({ p95: 160, p99: 200, errorRate: 0 }, { p95: 100, p99: 200, errorRate: 0 });
  assert.equal(regressions.length, 1);
  assert.equal(regressions[0].metric, 'p95');
  assert.equal(regressions[0].baseline, 100);
  assert.equal(regressions[0].current, 160);
});

test('compare: a p99 step change is flagged', () => {
  const regressions = compare(
    { p95: 100, p99: 400, requests: 200, errorRate: 0 },
    { p95: 100, p99: 200, requests: 200, errorRate: 0 },
  );
  assert.equal(regressions.length, 1);
  assert.equal(regressions[0].metric, 'p99');
});

test('compare: an error rate over the ceiling is flagged', () => {
  const regressions = compare({ p95: 100, p99: 200, errorRate: 0.05 }, { p95: 100, p99: 200, errorRate: 0 });
  assert.equal(regressions.length, 1);
  assert.equal(regressions[0].metric, 'errorRate');
});

test('compare: a checks rate under 0.99 is flagged', () => {
  const regressions = compare({ p95: 100, p99: 200, errorRate: 0, checksRate: 0.5 }, { p95: 100, p99: 200, errorRate: 0 });
  assert.equal(regressions.length, 1);
  assert.equal(regressions[0].metric, 'checksRate');
});

test('compare: a checks rate of exactly 0.99 is a failure, matching k6\'s rate>0.99', () => {
  const regressions = compare({ p95: 100, p99: 200, errorRate: 0, checksRate: 0.99 }, { p95: 100, p99: 200, errorRate: 0 });
  assert.deepEqual(
    regressions.map((r) => r.metric),
    ['checksRate'],
  );
  assert.deepEqual(compare({ p95: 100, p99: 200, errorRate: 0, checksRate: 1 }, { p95: 100, p99: 200, errorRate: 0 }), []);
});

test('thresholdsFor: an empty baseline keeps only the check threshold', () => {
  assert.deepEqual(thresholdsFor(null), { checks: [`rate>${REGRESSION.checksRate}`] });
});

test('thresholdsFor: builds latency thresholds from the baseline', () => {
  const thresholds = thresholdsFor({ p95: 100, p99: 200, requests: 200 });
  const latency = thresholds.expected_response_duration;
  assert.deepEqual(latency, [`p(95)<${latencyLimit(100, REGRESSION.p95)}`, `p(99)<${latencyLimit(200, REGRESSION.p99)}`]);
});

test('compare and the k6 threshold agree at the exact limit', () => {
  // k6 emits `p(95)<limit` and compare flags at the same rounded limit, so a
  // run exactly at it is a regression on both sides — never "thresholds
  // crossed" from k6 with "no regression" from the runner.
  const baseline = { p95: 100, p99: 200, requests: 200, errorRate: 0 };
  const limit = latencyLimit(100, REGRESSION.p95);
  const atLimit = compare({ p95: limit, p99: 100, requests: 200, errorRate: 0 }, baseline);
  assert.deepEqual(
    atLimit.map((r) => r.metric),
    ['p95'],
  );
  const justUnder = compare({ p95: limit - 1, p99: 100, requests: 200, errorRate: 0 }, baseline);
  assert.deepEqual(justUnder, []);
});

test('latencyLimit: rounds up so both sides use the same strict boundary', () => {
  assert.equal(latencyLimit(292.217088, 1.5), 439);
  assert.equal(latencyLimit(100, 1.5), 150);
});

test('thresholdsFor: omits the p99 threshold when the baseline is too small', () => {
  // 48 samples: p99 is the single slowest request, so it is not thresholded.
  const latency = thresholdsFor({ p95: 100, p99: 200, requests: 48 }).expected_response_duration;
  assert.deepEqual(latency, [`p(95)<${latencyLimit(100, REGRESSION.p95)}`]);
});

test('compare: ignores p99 until the run has enough samples', () => {
  const baseline = { p95: 100, p99: 200, requests: 200, errorRate: 0 };
  const small = compare({ p95: 100, p99: 9999, requests: 48, errorRate: 0 }, baseline);
  assert.deepEqual(small, []);
  const big = compare({ p95: 100, p99: 9999, requests: 200, errorRate: 0 }, baseline);
  assert.deepEqual(
    big.map((r) => r.metric),
    ['p99'],
  );
});

test('compare: ignores p99 when the BASELINE is too small, matching the k6 threshold', () => {
  // thresholdsFor omits the p99 threshold for a 48-sample baseline, so compare
  // must not flag p99 from a large run either — otherwise the two disagree.
  const baseline = { p95: 100, p99: 200, requests: 48, errorRate: 0 };
  assert.deepEqual(compare({ p95: 100, p99: 9999, requests: 200, errorRate: 0 }, baseline), []);
});

// End-to-end runs through main() with a fake k6. A run that failed is not a
// pass, even when it managed to write a summary: the empty regressions list
// must never be announced as "no regression".
const RUNNER = join(dirname(fileURLToPath(import.meta.url)), 'run-load-tests.mjs');

function fakeK6(dir, { exit, summary }) {
  const path = join(dir, 'fake-k6.sh');
  const payload = summary === undefined ? '' : JSON.stringify(summary);
  writeFileSync(
    path,
    [
      '#!/bin/sh',
      'for arg in "$@"; do case "$arg" in --summary-export=*) out="${arg#--summary-export=}" ;; esac; done',
      payload ? `printf '%s' '${payload}' > "$out"` : ':',
      `exit ${exit}`,
      '',
    ].join('\n')
  );
  chmodSync(path, 0o755);
  return path;
}

function runRunner({ k6, baselinePath, dir, extraArgs = [], updateBaseline = false }) {
  const args = [
    RUNNER,
    '--url',
    'http://localhost:3001',
    '--scenario',
    'public-smoke',
    '--profile',
    'smoke',
    '--json',
    '--baseline',
    baselinePath,
    ...extraArgs,
  ];
  if (updateBaseline) args.push('--update-baseline');
  return spawnSync(process.execPath, args, {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, K6_BIN: k6 },
  });
}

const validSummary = (overrides = {}) => ({
  metrics: {
    expected_response_duration: { 'p(50)': 10, 'p(95)': 20, 'p(99)': 30, avg: 15 },
    expected_responses: { count: 40 },
    unexpected_responses: { count: 0 },
    checks: { value: 1 },
    ...overrides,
  },
});

function makeBaseline(dir, overrides = {}) {
  const path = join(dir, 'baseline.json');
  writeFileSync(
    path,
    `${JSON.stringify({
      url: 'http://localhost:3001',
      scenario: 'public-smoke',
      profile: 'smoke',
      p50: 10,
      p95: 20,
      p99: 30,
      avg: 15,
      errorRate: 0,
      requests: 40,
      rateLimited: 0,
      checksRate: 1,
      ...overrides,
    })}\n`
  );
  return path;
}

test('main: a k6 run that fails after writing a summary proves nothing (exit 2)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'load-runner-'));
  try {
    const baseline = makeBaseline(dir);
    const k6 = fakeK6(dir, { exit: 1, summary: validSummary() });
    const res = runRunner({ k6, baselinePath: baseline, dir });
    assert.equal(res.status, EXIT_CODES.COULD_NOT_RUN);
    const report = JSON.parse(res.stdout);
    assert.equal(report.compared, false);
    assert.match(report.error, /k6 exited 1/);
    // Latency in the summary is far under the baseline, so a bad runner would
    // have printed "no regression"; the whole point is that it must not.
    assert.ok(!/no regression/.test(res.stdout));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('main: a failed run is never a regression when its partial summary regressed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'load-runner-'));
  try {
    // p95 200ms is 10x the 20ms baseline, so compare() would flag a regression —
    // but the run failed, so it must report "could not run", not "regression".
    const baseline = makeBaseline(dir);
    const k6 = fakeK6(dir, {
      exit: 1,
      summary: validSummary({ expected_response_duration: { 'p(50)': 100, 'p(95)': 200, 'p(99)': 300, avg: 150 } }),
    });
    const res = runRunner({ k6, baselinePath: baseline, dir });
    assert.equal(res.status, EXIT_CODES.COULD_NOT_RUN);
    assert.deepEqual(JSON.parse(res.stdout).regressions, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('main: a threshold-crossing run (k6 exit 99) is compared and flags the regression', () => {
  const dir = mkdtempSync(join(tmpdir(), 'load-runner-'));
  try {
    const baseline = makeBaseline(dir);
    const k6 = fakeK6(dir, {
      exit: 99,
      summary: validSummary({ expected_response_duration: { 'p(50)': 100, 'p(95)': 200, 'p(99)': 300, avg: 150 } }),
    });
    const res = runRunner({ k6, baselinePath: baseline, dir });
    assert.equal(res.status, EXIT_CODES.REGRESSION);
    const report = JSON.parse(res.stdout);
    assert.equal(report.compared, true);
    assert.ok(report.regressions.some((r) => r.metric === 'p95'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('main: --update-baseline does not replace the reference after a failed run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'load-runner-'));
  try {
    const baseline = makeBaseline(dir, { p95: 20 });
    const k6 = fakeK6(dir, {
      exit: 1,
      summary: validSummary({ expected_response_duration: { 'p(50)': 100, 'p(95)': 200, 'p(99)': 300, avg: 150 } }),
    });
    const res = runRunner({ k6, baselinePath: baseline, dir, updateBaseline: true });
    assert.equal(res.status, EXIT_CODES.COULD_NOT_RUN);
    const report = JSON.parse(res.stdout);
    assert.equal(report.baselineWritten, undefined);
    assert.match(report.baselineWriteSkipped, /k6 exited 1/);
    // The reference on disk is untouched.
    assert.equal(JSON.parse(readFileSync(baseline, 'utf8')).p95, 20);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('main: a failed run with no summary still reports could-not-run, not a crash', () => {
  const dir = mkdtempSync(join(tmpdir(), 'load-runner-'));
  try {
    const baseline = makeBaseline(dir);
    const k6 = fakeK6(dir, { exit: 1, summary: undefined });
    const res = runRunner({ k6, baselinePath: baseline, dir });
    assert.equal(res.status, EXIT_CODES.COULD_NOT_RUN);
    assert.match(JSON.parse(res.stdout).error, /no summary/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('main: a missing baseline exits 3 and still writes --report', () => {
  const dir = mkdtempSync(join(tmpdir(), 'load-runner-'));
  try {
    const missing = join(dir, 'no-such-baseline.json');
    const reportPath = join(dir, 'load-report.json');
    const k6 = fakeK6(dir, { exit: 0, summary: validSummary() });
    const res = runRunner({ k6, baselinePath: missing, dir, extraArgs: ['--report', reportPath] });
    assert.equal(res.status, EXIT_CODES.NO_BASELINE);
    // The workflow uploads this file; a preflight failure must not leave it absent.
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    assert.equal(report.compared, false);
    assert.equal(report.baselinePath, missing);
    assert.match(report.error, /No baseline at/);
    // k6 must not have run at all.
    assert.equal(report.k6ExitCode, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('main: a baseline that fails matching exits 4 and still writes --report', () => {
  const dir = mkdtempSync(join(tmpdir(), 'load-runner-'));
  try {
    const baseline = makeBaseline(dir, { profile: 'load' });
    const reportPath = join(dir, 'load-report.json');
    const k6 = fakeK6(dir, { exit: 0, summary: validSummary() });
    const res = runRunner({ k6, baselinePath: baseline, dir, extraArgs: ['--report', reportPath] });
    assert.equal(res.status, EXIT_CODES.BASELINE_MISMATCH);
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    assert.equal(report.compared, false);
    assert.match(report.error, /does not match/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('main: a baseline recorded under a different host spelling still matches', () => {
  const dir = mkdtempSync(join(tmpdir(), 'load-runner-'));
  try {
    const baseline = makeBaseline(dir, { url: 'http://LOCALHOST:3001' });
    const k6 = fakeK6(dir, { exit: 0, summary: validSummary() });
    const res = runRunner({ k6, baselinePath: baseline, dir });
    assert.equal(res.status, EXIT_CODES.OK);
    assert.equal(JSON.parse(res.stdout).compared, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the health route is /healthz on a deployed host and /health on the local API', () => {
  // On staging `/health` is the web app (307 to /login); only `/healthz`
  // reaches the API through nginx.
  assert.equal(healthPathFor('https://staging.cipansor.or.id'), '/healthz');
  assert.equal(healthPathFor('https://staging.cipansor.or.id/'), '/healthz');
  assert.equal(healthPathFor('http://localhost:3001'), '/health');
  assert.equal(healthPathFor('http://127.0.0.1:3001/'), '/health');
  assert.equal(healthPathFor('https://staging.cipansor.or.id', '/custom'), '/custom');
});
