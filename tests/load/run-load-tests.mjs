#!/usr/bin/env node
/**
 * Load-test runner.
 *
 * Wraps k6 so the same invocation records a baseline, runs against a target,
 * compares the result with the last recorded baseline, and reports regressions
 * with numbers. It is a plain Node ESM script with no dependencies, so it runs
 * on a runner with nothing but Node and the k6 binary.
 *
 *   node tests/load/run-load-tests.mjs --url https://staging.cipansor.or.id --scenario public-smoke
 *   node tests/load/run-load-tests.mjs --url http://localhost:3001 --scenario public-smoke --update-baseline
 *
 * Flags:
 *   --url <url>              target base URL (default $BASE_URL or http://localhost:3001)
 *   --scenario <name>        file in scenarios/ without .js (default public-smoke)
 *   --profile <smoke|load>   load profile (default smoke)
 *   --update-baseline        write the run as the new baseline
 *   --baseline <path>        compare against this baseline instead of the default
 *   --report <path>          also write the machine-readable report to this file
 *   --allow-shared-target    permit a heavy profile against a known shared host
 *   --json                   print the machine-readable report only
 *
 * Environment:
 *   K6_BIN                   path to k6 (else PATH, then /tmp/k6)
 *   LOAD_TEST_EMAIL / LOAD_TEST_PASSWORD   credentials for the authenticated scenario
 *
 * Exit codes (see README.md):
 *   0 no regression   1 regression found   2 could not run
 *   3 no baseline recorded   4 baseline does not match this run
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

import { REGRESSION, PROFILES, latencyLimit } from './config.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE_DIR = join(HERE, 'baselines');

/**
 * The runner's exit codes, named so the workflow can map each one to a message
 * instead of a bare number. Every code except OK and REGRESSION means the run
 * proved nothing, so both the runner and the job treat them as failures.
 */
export const EXIT_CODES = Object.freeze({
  OK: 0,
  REGRESSION: 1,
  COULD_NOT_RUN: 2,
  NO_BASELINE: 3,
  BASELINE_MISMATCH: 4,
});

// A known shared host. Pointing the heavy `load` profile at it consumes the
// staging request budget and disrupts everyone else on it, so the runner
// refuses unless the caller passes --allow-shared-target. The smoke run is
// unaffected.
const SHARED_TARGET_HOSTS = ['staging.cipansor.or.id'];

function parseArgs(argv) {
  const args = {
    profile: 'smoke',
    scenario: 'public-smoke',
    updateBaseline: false,
    json: false,
    allowSharedTarget: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url') args.url = argv[++i];
    else if (a === '--scenario') args.scenario = argv[++i];
    else if (a === '--profile') args.profile = argv[++i];
    else if (a === '--baseline') args.baseline = argv[++i];
    else if (a === '--report') args.report = argv[++i];
    else if (a === '--update-baseline') args.updateBaseline = true;
    else if (a === '--allow-shared-target') args.allowSharedTarget = true;
    else if (a === '--json') args.json = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function findK6() {
  if (process.env.K6_BIN && existsSync(process.env.K6_BIN)) return process.env.K6_BIN;
  const onPath = spawnSync('sh', ['-c', 'command -v k6'], { encoding: 'utf8' });
  if (onPath.status === 0 && onPath.stdout.trim()) return onPath.stdout.trim();
  for (const candidate of ['/tmp/k6', '/usr/local/bin/k6', '/usr/bin/k6']) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function normalizeUrl(url) {
  return String(url || '').replace(/\/+$/, '');
}

/**
 * Canonical form of a target URL, so two spellings of the same origin compare
 * equal. `slugFor` already lowercases the host (the baseline filename), so
 * matching the raw string rejected an equivalent URL it had just located —
 * `https://STAGING.CIPANSOR.OR.ID` found the baseline for
 * `https://staging.cipansor.or.id` and then exited 4. `new URL()` lowercases the
 * host and normalizes the path; scheme, a non-default port and a base path stay
 * significant. A string that is not a URL falls back to a trimmed comparison.
 */
function canonicalUrl(url) {
  const raw = normalizeUrl(url);
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return raw;
  }
}

function slugFor(url) {
  try {
    const host = new URL(url).host;
    return host.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  } catch {
    return 'unknown-target';
  }
}

// A baseline is a fact about ONE target at ONE load profile. The profile is part
// of the key so a `load` run can never reuse (or overwrite) a `smoke` reference.
function baselinePath(url, scenario, profile = 'smoke') {
  return join(BASELINE_DIR, `${slugFor(url)}__${scenario}__${profile}.json`);
}

/**
 * Read a baseline and say exactly what was wrong with it. A missing file and a
 * malformed file are different problems — passing straight to `compare` would
 * turn either into "no regressions" and a false green.
 */
function readBaseline(path) {
  if (!existsSync(path)) return { exists: false, baseline: null, error: null };
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    return { exists: true, baseline: null, error: `could not read: ${err.message}` };
  }
  let baseline;
  try {
    baseline = JSON.parse(raw);
  } catch (err) {
    return { exists: true, baseline: null, error: `malformed JSON: ${err.message}` };
  }
  const problem = validateBaseline(baseline);
  if (problem) return { exists: true, baseline: null, error: problem };
  return { exists: true, baseline, error: null };
}

/** The fields a comparison needs. A baseline missing them is not a baseline. */
function validateBaseline(baseline) {
  if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline)) return 'not a JSON object';
  for (const field of ['url', 'scenario', 'profile']) {
    if (typeof baseline[field] !== 'string' || !baseline[field]) return `missing "${field}"`;
  }
  if (typeof baseline.p95 !== 'number' || Number.isNaN(baseline.p95)) return 'missing numeric "p95"';
  return null;
}

/**
 * A comparison is only meaningful when the baseline was recorded on the same
 * target, scenario and profile as this run. Say so instead of comparing unlike
 * measurements.
 */
function baselineMatches(baseline, { url, scenario, profile }) {
  if (canonicalUrl(baseline.url) !== canonicalUrl(url)) {
    return `baseline was recorded against ${baseline.url}, not ${url}`;
  }
  if (baseline.scenario !== scenario) {
    return `baseline is for scenario "${baseline.scenario}", not "${scenario}"`;
  }
  if (baseline.profile !== profile) {
    return `baseline is for profile "${baseline.profile}", not "${profile}"`;
  }
  return null;
}

function metric(summary, name, value) {
  const m = summary.metrics && summary.metrics[name];
  if (!m) return undefined;
  // k6's summary-export is flat (`{p(95): …}`); older builds nested it under
  // `values`. Accept both so a different k6 build does not silently read n/a.
  const bag = m.values || m;
  return bag[value];
}

function extract(summary) {
  const expected = metric(summary, 'expected_responses', 'count') ?? 0;
  const unexpected = metric(summary, 'unexpected_responses', 'count') ?? 0;
  const rateLimited = metric(summary, 'rate_limited', 'count') ?? 0;
  const total = expected + unexpected;
  // Latency comes from `expected_response_duration`, the same series the k6
  // thresholds read — never the overall `http_req_duration`, whose 401s made
  // the two disagree. See config.js thresholdsFor().
  const duration = 'expected_response_duration';
  return {
    p50: metric(summary, duration, 'p(50)'),
    p95: metric(summary, duration, 'p(95)'),
    p99: metric(summary, duration, 'p(99)'),
    avg: metric(summary, duration, 'avg'),
    errorRate: total > 0 ? unexpected / total : 0,
    requests: total,
    rateLimited,
    checksRate: metric(summary, 'checks', 'value'),
  };
}

/**
 * A summary that ran no iterations (k6 aborted in setup, rejected the script)
 * has no metrics. Refuse to treat it as a measurement: `compare` would return
 * "no regressions" and the job would look green having tested nothing.
 */
function summaryProblem(summary) {
  const metrics = summary && summary.metrics;
  if (!metrics) return 'summary has no "metrics"';
  if (!metrics.expected_responses && !metrics.unexpected_responses) {
    return 'summary has no response counters (the run produced no samples)';
  }
  if (!metrics.expected_response_duration) {
    return 'summary has no "expected_response_duration"';
  }
  return null;
}

function compare(current, baseline) {
  const regressions = [];
  if (!baseline) return regressions;
  const round = (n) => Math.round(n * 100) / 100;
  // p99 is only meaningful when BOTH runs have enough samples for it to be a
  // percentile rather than the single slowest request. The k6 threshold uses
  // the same baseline-side test, so the two verdicts cannot disagree.
  const p99Comparable =
    (baseline.requests ?? 0) >= REGRESSION.p99MinSamples && (current.requests ?? 0) >= REGRESSION.p99MinSamples;
  // Compare against the SAME rounded limit k6 thresholds (latencyLimit), so a
  // run can never print "thresholds crossed" and "no regression" at once.
  if (baseline.p95 && current.p95 && current.p95 >= latencyLimit(baseline.p95, REGRESSION.p95)) {
    regressions.push({
      metric: 'p95',
      baseline: round(baseline.p95),
      current: round(current.p95),
      threshold: `${REGRESSION.p95}x`,
    });
  }
  if (p99Comparable && baseline.p99 && current.p99 && current.p99 >= latencyLimit(baseline.p99, REGRESSION.p99)) {
    regressions.push({
      metric: 'p99',
      baseline: round(baseline.p99),
      current: round(current.p99),
      threshold: `${REGRESSION.p99}x`,
    });
  }
  if (current.errorRate > REGRESSION.errorRate) {
    regressions.push({
      metric: 'errorRate',
      baseline: round(baseline.errorRate ?? 0),
      current: round(current.errorRate),
      threshold: `${REGRESSION.errorRate}`,
    });
  }
  // k6's threshold is `rate>0.99`, so exactly 0.99 is a failure there too.
  if (current.checksRate !== undefined && current.checksRate <= REGRESSION.checksRate) {
    regressions.push({
      metric: 'checksRate',
      baseline: round(baseline.checksRate ?? 1),
      current: round(current.checksRate),
      threshold: `<=${REGRESSION.checksRate}`,
    });
  }
  return regressions;
}

function isSharedTarget(url) {
  try {
    // `new URL()` already lowercases the host; a fully-qualified trailing dot
    // names the same host and must not slip past the guard.
    const host = new URL(url).host.replace(/\.$/, '');
    return SHARED_TARGET_HOSTS.includes(host);
  } catch {
    return false;
  }
}

/**
 * A preflight failure (a missing or unusable baseline) never reaches k6, but it
 * still owes the caller a report: both workflow jobs upload `--report` on every
 * run, and a failure that writes none leaves an empty artifact next to a
 * summary that only says "no baseline". Build the same report shape main()
 * would, persist it through finish(), and return the exit code.
 */
function preflightFailure({ scenario, profile, url, baselinePath, error }, args, code) {
  finish(
    {
      scenario,
      profile,
      url,
      baselinePath: baselinePath || null,
      k6ExitCode: null,
      summaryReading: 'not-run',
      throttled: false,
      current: null,
      baseline: null,
      regressions: [],
      compared: false,
      error,
    },
    args
  );
  return code;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(0, 32).join('\n'));
    return EXIT_CODES.OK;
  }

  const url = normalizeUrl(args.url || process.env.BASE_URL || 'http://localhost:3001');
  const { scenario, profile } = args;

  if (!PROFILES[profile]) {
    console.error(`No such profile: ${profile} (known: ${Object.keys(PROFILES).join(', ')})`);
    return EXIT_CODES.COULD_NOT_RUN;
  }
  // Guard before spending the target's request budget: the heavy profile
  // measures the limiter (or worse, starves real users) on a shared host.
  if (profile !== 'smoke' && isSharedTarget(url) && !args.allowSharedTarget) {
    console.error(
      `Refusing \`${profile}\` profile against the shared target ${url}. It consumes the target's ` +
        'request budget and disrupts other users. Pass --allow-shared-target if that is intended.'
    );
    return EXIT_CODES.COULD_NOT_RUN;
  }

  const script = join(HERE, 'scenarios', `${scenario}.js`);
  if (!existsSync(script)) {
    console.error(`No such scenario: ${script}`);
    return EXIT_CODES.COULD_NOT_RUN;
  }
  const k6 = findK6();
  if (!k6) {
    console.error('k6 not found. Set K6_BIN, put k6 on PATH, or install it to /tmp/k6.');
    return EXIT_CODES.COULD_NOT_RUN;
  }

  const bPath = args.baseline || baselinePath(url, scenario, profile);
  const read = readBaseline(bPath);
  const baseline = read.baseline;

  // A comparison run needs a valid baseline BEFORE k6 starts. Without this a
  // missing (or malformed, or mismatched) baseline turned into "no regressions"
  // and a green job that measured nothing.
  if (!args.updateBaseline) {
    if (!read.exists) {
      const reason =
        `No baseline at ${bPath}. Record one first:\n` +
        `  node tests/load/run-load-tests.mjs --url ${url} --scenario ${scenario} --profile ${profile} --update-baseline`;
      console.error(reason);
      return preflightFailure({ scenario, profile, url, baselinePath: bPath, error: reason }, args, EXIT_CODES.NO_BASELINE);
    }
    if (read.error) {
      const reason = `Baseline ${bPath} is unusable: ${read.error}`;
      console.error(reason);
      return preflightFailure({ scenario, profile, url, baselinePath: bPath, error: reason }, args, EXIT_CODES.BASELINE_MISMATCH);
    }
    const mismatch = baselineMatches(baseline, { url, scenario, profile });
    if (mismatch) {
      const reason = `Baseline ${bPath} does not match this run: ${mismatch}`;
      console.error(reason);
      return preflightFailure({ scenario, profile, url, baselinePath: bPath, error: reason }, args, EXIT_CODES.BASELINE_MISMATCH);
    }
  }

  const summaryFile = join(tmpdir(), `k6-summary-${Date.now()}.json`);
  const env = { ...process.env, BASE_URL: url, PROFILE: profile };
  if (baseline) env.BASELINE_JSON = JSON.stringify(baseline);

  const run = spawnSync(k6, ['run', `--summary-export=${summaryFile}`, script], {
    stdio: ['ignore', 'inherit', 'inherit'],
    env,
  });

  // k6 can fail before writing --summary-export at all. Reading it without a
  // guard threw ENOENT out of main(), which Node reported as exit 1 — a
  // "regression" for a run that never happened.
  let summary = null;
  let summaryReadError = null;
  try {
    summary = JSON.parse(readFileSync(summaryFile, 'utf8'));
  } catch (err) {
    summaryReadError = err.code === 'ENOENT' ? 'k6 wrote no summary (it failed before the run)' : err.message;
  } finally {
    if (existsSync(summaryFile)) rmSync(summaryFile);
  }

  const report = {
    scenario,
    profile,
    url,
    baselinePath: baseline ? bPath : null,
    k6ExitCode: run.status,
    summaryReading: summaryReadError ? 'error' : 'ok',
    throttled: false,
    current: null,
    baseline: baseline || null,
    regressions: [],
  };

  if (summaryReadError) {
    report.error = summaryReadError;
    finish(report, args);
    return EXIT_CODES.COULD_NOT_RUN;
  }

  const current = extract(summary);
  report.current = current;

  const problem = summaryProblem(summary);
  const throttled = current.rateLimited > 0;
  // k6's exit 99 is a completed run whose thresholds were crossed; 0 is a clean
  // run. Anything else is an error (a rejected script, a network fault), and
  // the summary it wrote — if any — is partial and must not be compared or
  // recorded as if the run had finished.
  const completed = run.status === 0 || run.status === 99;
  report.throttled = throttled;
  if (problem) report.error = problem;
  if (!completed) {
    report.error = report.error || `k6 exited ${run.status} before the run completed; its summary is not comparable`;
  }

  // A run is only comparably measured when it completed, was not throttled and
  // produced a usable summary. Anything else proves nothing: an empty
  // `regressions` list must never be read as "no regression".
  const comparable = completed && !throttled && !problem;
  const regressions = comparable ? compare(current, baseline) : [];
  report.regressions = regressions;
  report.compared = comparable && !args.updateBaseline && baseline !== null;

  // Write the baseline only after a run that actually completed. An explicit
  // --update-baseline is the only path that may write a file.
  if (args.updateBaseline) {
    if (throttled) {
      report.baselineWriteSkipped = 'rate-limited run';
    } else if (problem) {
      report.baselineWriteSkipped = problem;
    } else if (!completed) {
      report.baselineWriteSkipped = `k6 exited ${run.status} before completing`;
    } else {
      mkdirSync(BASELINE_DIR, { recursive: true });
      writeFileSync(
        bPath,
        `${JSON.stringify({ ...current, url, scenario, profile, recordedAt: new Date().toISOString() }, null, 2)}\n`
      );
      report.baselineWritten = bPath;
    }
  }

  finish(report, args);

  // Order matters: a run that did not complete returns 2 even if comparing its
  // partial summary happened to look like a regression, so the job never
  // announces a regression for a run that never finished.
  if (!completed) return EXIT_CODES.COULD_NOT_RUN;
  if (args.updateBaseline && !report.baselineWritten) return EXIT_CODES.COULD_NOT_RUN;
  if (throttled || problem) return EXIT_CODES.COULD_NOT_RUN;
  if (regressions.length > 0) return EXIT_CODES.REGRESSION;
  return EXIT_CODES.OK;
}

/** Print the report and, if asked, persist it — always before the exit code. */
function finish(report, args) {
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHuman(report);
  }
  if (args.report) {
    mkdirSync(dirname(args.report), { recursive: true });
    writeFileSync(args.report, `${JSON.stringify(report, null, 2)}\n`);
  }
}

function fmt(v) {
  return v === undefined || v === null ? 'n/a' : Math.round(v * 100) / 100;
}

function printHuman(report) {
  const c = report.current;
  console.log('');
  console.log(`Load test: ${report.scenario} (${report.profile}) against ${report.url}`);
  if (!c) {
    console.log('  no summary was produced — nothing was measured.');
    if (report.error) console.log(`  ${report.error}`);
    return;
  }
  console.log(`  requests ${c.requests}   error rate ${(c.errorRate * 100).toFixed(2)}%   checks ${fmt(c.checksRate)}`);
  if (c.rateLimited > 0) {
    console.log(`  RATE LIMITED: ${c.rateLimited} responses were 429 — the numbers below measured the limiter, not the app.`);
    console.log('  No baseline was recorded or compared. Wait out the rate-limit window and run again.');
  }
  if (report.error) console.log(`  UNUSABLE SUMMARY: ${report.error}`);
  console.log(`  p50 ${fmt(c.p50)}ms   p95 ${fmt(c.p95)}ms   p99 ${fmt(c.p99)}ms   avg ${fmt(c.avg)}ms`);
  if (report.baseline) {
    const b = report.baseline;
    console.log(`  baseline (${report.baselinePath}):`);
    console.log(`    p50 ${fmt(b.p50)}ms   p95 ${fmt(b.p95)}ms   p99 ${fmt(b.p99)}ms   error ${(b.errorRate * 100).toFixed(2)}%`);
  } else {
    console.log('  no baseline recorded yet — run with --update-baseline to record one');
  }
  if (report.baselineWritten) {
    console.log(`  baseline written to ${report.baselineWritten}`);
  }
  if (report.baselineWriteSkipped) {
    console.log(`  baseline NOT written: ${report.baselineWriteSkipped}`);
  }
  if (report.regressions.length > 0) {
    console.log('  REGRESSION(S):');
    for (const r of report.regressions) {
      console.log(`    ${r.metric}: baseline ${r.baseline} -> current ${r.current} (allowed ${r.threshold})`);
    }
  } else if (report.baselineWritten) {
    console.log('  recording run — no comparison made');
  } else if (report.compared) {
    console.log('  no regression against the baseline');
  } else {
    // An empty regressions list only means "no regression" when a comparison
    // actually happened. A run that did not complete, was throttled, or had no
    // usable baseline proved nothing — say so instead of a false green.
    console.log('  not compared — this run is not a pass');
  }
}

// Only run when invoked directly; importing this file (the unit test does)
// must not start a load test.
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) process.exit(main());

export { parseArgs, slugFor, extract, compare, findK6, baselinePath, readBaseline, baselineMatches, summaryProblem, isSharedTarget };
