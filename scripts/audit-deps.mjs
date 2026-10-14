#!/usr/bin/env node
/**
 * Dependency vulnerability audit against npm's bulk advisory endpoint.
 *
 * `pnpm audit` (all versions up to 11.x) still calls the retired
 * `/-/npm/v1/security/audits` endpoint, which npm now answers with 410.
 * This script does what the npm CLI itself does: read the lockfile, POST
 * {name: [versions]} to `/-/npm/v1/security/advisories/bulk`, and match
 * the installed versions against each advisory's vulnerable range.
 *
 * Exit code 1 when any advisory at or above the threshold severity
 * (default: high) matches an installed version — same contract the old
 * `pnpm audit --prod --audit-level high` CI step had.
 *
 * Usage: node scripts/audit-deps.mjs [--audit-level low|moderate|high|critical]
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAllDocuments } from "yaml";
import semver from "semver";

const REGISTRY = process.env.NPM_REGISTRY_URL || "https://registry.npmjs.org";
const SEVERITY_RANK = { low: 0, moderate: 1, high: 2, critical: 3 };

/**
 * Versions that carry a backported fix an advisory's own range still matches.
 *
 * npm publishes one `vulnerable_versions` range per advisory. When a fix lands
 * on several release lines at once, that range is often written as a bare
 * upper bound on the newest line ("<=5.0.7") — which `semver.satisfies` then
 * also matches against every 1.x, 2.x and 3.x, including the ones that were
 * patched. Without this list such an advisory can never be cleared: no 1.x
 * version exists that fails "<=5.0.7".
 *
 * Each entry pins one exact version against one exact range, so a regression,
 * a new advisory for the same package, or a widened range all still fail.
 * Verify the fix is really present in the tarball before adding an entry.
 *
 * The brace-expansion 1.x line used to need an entry here (1.1.18 against
 * "<=5.0.7"): the fix was backported to 1.1.18 while the newest 5.x line was
 * the only one the advisory's range named. That is no longer needed — the root
 * override now moves 1.x to 1.1.21, which the advisory's own ranges clear — so
 * the list is empty and waits for the next package that genuinely needs it.
 */
const BACKPORTED_FIXES = [];

const isBackported = (name, version, range) =>
  BACKPORTED_FIXES.some(
    (f) => f.name === name && f.version === version && f.range === range,
  );

/**
 * Advisories accepted for a while because nothing can be done yet: no patched
 * release exists, and the package is installed only for development tooling.
 *
 * A pin in the `overrides` map of `pnpm-workspace.yaml` is the fix whenever a
 * fixed version exists. When none does, the alternative is a red Security job
 * on every PR and on `main` — which also stops the staging deploy — until a
 * third party publishes one.
 * An entry here waives exactly one advisory (by its URL) on exactly one
 * version, and only while all three hold:
 *
 * - **the date is on or before `until`.** Then it fails again, and someone
 *   looks: is there a release now, is it still dev-only?
 * - **no production dependency reaches it.** Checked here from the lockfile,
 *   from every workspace's `dependencies` and `optionalDependencies` through
 *   the whole graph, so a new runtime path to the package turns the job red
 *   whatever the date.
 * - **the same advisory URL.** A second advisory on the package still fails.
 *
 * Say in `note` why the risk does not reach a running system.
 */
const ACCEPTED_RISKS = [
  {
    name: "braces",
    version: "3.0.3",
    advisory: "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm",
    until: "2026-11-03",
    note:
      "No patched release (micromatch/braces#70). Installed only through dev " +
      "tooling — tsc-alias (chokidar, globby) and eslint-config-next " +
      "(fast-glob) — which expand the repository's own glob patterns; the " +
      "stack exhaustion needs attacker-supplied nesting.",
  },
];

const levelArgIdx = process.argv.indexOf("--audit-level");
const threshold =
  levelArgIdx !== -1 ? process.argv[levelArgIdx + 1] : "high";
if (!(threshold in SEVERITY_RANK)) {
  console.error(`Unknown --audit-level "${threshold}"`);
  process.exit(2);
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// pnpm 12 writes the lockfile as TWO YAML documents: the first pins the
// package manager itself (`packageManagerDependencies`, plus the `@pnpm/exe`
// packages), the second holds the workspace tree. `parse()` rejects that with
// MULTIPLE_DOCS, so read every document and union the top-level maps
// (`importers`, `packages`, `snapshots`) rather than letting a later document
// overwrite an earlier one's packages.
const lockfile = parseAllDocuments(
  readFileSync(resolve(repoRoot, "pnpm-lock.yaml"), "utf8"),
).reduce((merged, doc) => {
  for (const [key, value] of Object.entries(doc.toJSON() ?? {})) {
    merged[key] =
      value && typeof value === "object" && !Array.isArray(value)
        ? { ...(merged[key] ?? {}), ...value }
        : value;
  }
  return merged;
}, {});

// pnpm-lock v9: `packages:` keys look like "qs@6.14.1" or
// "@scope/name@1.2.3(peer@x)(...)" — strip the peer suffix, split on the
// last "@" to separate name from version.
const installed = new Map(); // name -> Set<version>
for (const key of Object.keys(lockfile.packages ?? {})) {
  const bare = key.replace(/\(.*$/, "");
  const at = bare.lastIndexOf("@");
  if (at <= 0) continue; // malformed or "@scope" with no version
  const name = bare.slice(0, at);
  const version = bare.slice(at + 1);
  if (!semver.valid(version)) continue;
  if (!installed.has(name)) installed.set(name, new Set());
  installed.get(name).add(version);
}

if (installed.size === 0) {
  console.error("No packages parsed from pnpm-lock.yaml — lockfile format change?");
  process.exit(2);
}

/**
 * Every "name@version" a production install reaches: each workspace's
 * `dependencies` and `optionalDependencies`, followed through `snapshots`,
 * and through `link:` into the linked workspace's own production deps.
 */
// An aliased dependency ("string-width-cjs": "string-width@4.2.3") names its
// real package in the version.
const snapshotKey = (name, version) =>
  /^\d/.test(version) ? `${name}@${version}` : version;

function productionPackages() {
  const reached = new Set();
  const seenImporters = new Set();
  const queue = [];
  const visitImporter = (path) => {
    if (seenImporters.has(path)) return;
    seenImporters.add(path);
    const importer = lockfile.importers?.[path];
    if (!importer) return;
    for (const group of ["dependencies", "optionalDependencies"]) {
      for (const [name, { version }] of Object.entries(importer[group] ?? {})) {
        if (version.startsWith("link:")) {
          const target = resolve(repoRoot, path, version.slice("link:".length));
          visitImporter(target.slice(repoRoot.length + 1) || ".");
        } else {
          queue.push(snapshotKey(name, version));
        }
      }
    }
  };
  for (const path of Object.keys(lockfile.importers ?? {})) {
    // Start from the workspaces themselves; dev deps are never followed.
    visitImporter(path);
  }
  const seen = new Set();
  while (queue.length > 0) {
    const key = queue.pop();
    if (seen.has(key)) continue;
    seen.add(key);
    reached.add(key.replace(/\(.*$/, ""));
    const snap = lockfile.snapshots?.[key];
    for (const group of ["dependencies", "optionalDependencies"]) {
      for (const [name, version] of Object.entries(snap?.[group] ?? {})) {
        queue.push(snapshotKey(name, version));
      }
    }
  }
  return reached;
}

const inProduction = productionPackages();
const today = new Date().toISOString().slice(0, 10);
const acceptedRisk = (name, version, url) =>
  ACCEPTED_RISKS.find(
    (r) =>
      r.name === name &&
      r.version === version &&
      r.advisory === url &&
      today <= r.until &&
      !inProduction.has(`${name}@${version}`),
  );

const REQUEST_TIMEOUT_MS = Number(process.env.AUDIT_TIMEOUT_MS || 30_000);
const MAX_ATTEMPTS = Number(process.env.AUDIT_MAX_ATTEMPTS || 4);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * POST one chunk to the bulk endpoint, retrying transient failures.
 *
 * This runs in CI as the **Security** job, so its exit code is read as a
 * statement about the dependency tree. Without a timeout and a retry it is
 * really a statement about npm's uptime: the endpoint both returns 503 and
 * **hangs outright**, and a single `fetch` with neither guard turns one
 * hiccup into a red X on every open PR at once. Measured 2026-09-03: the
 * first of three consecutive calls hung past 30s, the next two answered 200
 * in ~4.5s, and two CI runs died at exactly 5m01s.
 *
 * Retried: network errors, timeouts, 429, and 5xx. A 4xx other than 429 is
 * our own bad request and fails immediately — retrying it only wastes CI.
 *
 * Returns `{ ok: true, data }`, or `{ ok: false, reason }` once the attempts
 * are spent. Deciding what an exhausted chunk *means* is the caller's job, not
 * this function's — see the exit-code policy at the bottom of the file.
 */
async function fetchAdvisories(body) {
  let lastError = "unknown";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(`${REGISTRY}/-/npm/v1/security/advisories/bulk`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (res.ok) return { ok: true, data: await res.json() };

      if (res.status !== 429 && res.status < 500) {
        console.error(`Bulk advisory endpoint returned ${res.status}`);
        process.exit(2);
      }
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err?.name === "TimeoutError"
        ? `timeout after ${REQUEST_TIMEOUT_MS}ms`
        : String(err?.message ?? err);
    }

    if (attempt < MAX_ATTEMPTS) {
      const backoff = 2 ** (attempt - 1) * 1000;
      console.error(
        `Bulk advisory endpoint failed (${lastError}) — attempt ${attempt}/${MAX_ATTEMPTS}, retrying in ${backoff}ms`,
      );
      await sleep(backoff);
    }
  }

  return { ok: false, reason: `${lastError} after ${MAX_ATTEMPTS} attempts` };
}

// The bulk endpoint accepts {name: [versions]}; chunk to keep requests sane.
const entries = [...installed.entries()].map(([n, v]) => [n, [...v]]);
const CHUNK = 400;
const findings = [];
const waived = [];
const accepted = [];

/** Chunks the endpoint never answered — packages this run did not actually check. */
const unreachable = [];

for (let i = 0; i < entries.length; i += CHUNK) {
  const slice = entries.slice(i, i + CHUNK);
  const body = Object.fromEntries(slice);
  const result = await fetchAdvisories(body);
  if (!result.ok) {
    unreachable.push({ packages: slice.length, reason: result.reason });
    continue;
  }
  const advisories = result.data;
  for (const [name, advs] of Object.entries(advisories)) {
    for (const adv of advs) {
      const range = adv.vulnerable_versions ?? "*";
      const matched = [...(installed.get(name) ?? [])].filter((v) =>
        semver.satisfies(v, range, { includePrerelease: true }),
      );
      const hit = [];
      for (const v of matched) {
        if (isBackported(name, v, range)) waived.push({ name, version: v, range });
        else if (acceptedRisk(name, v, adv.url))
          accepted.push({ name, version: v, url: adv.url, severity: adv.severity });
        else hit.push(v);
      }
      if (hit.length > 0) {
        findings.push({
          name,
          versions: hit,
          severity: adv.severity ?? "unknown",
          title: adv.title,
          url: adv.url,
          range,
        });
      }
    }
  }
}

findings.sort(
  (a, b) => (SEVERITY_RANK[b.severity] ?? -1) - (SEVERITY_RANK[a.severity] ?? -1),
);

const failing = findings.filter(
  (f) => (SEVERITY_RANK[f.severity] ?? -1) >= SEVERITY_RANK[threshold],
);

console.log(
  `Audited ${installed.size} packages — ${findings.length} advisories matched installed versions.`,
);
for (const f of findings) {
  const marker =
    (SEVERITY_RANK[f.severity] ?? -1) >= SEVERITY_RANK[threshold] ? "✖" : "•";
  console.log(
    `${marker} [${f.severity}] ${f.name}@${f.versions.join(",")} (vulnerable: ${f.range})\n   ${f.title}\n   ${f.url}`,
  );
}

for (const w of waived) {
  const entry = BACKPORTED_FIXES.find(
    (f) => f.name === w.name && f.version === w.version && f.range === w.range,
  );
  console.log(
    `~ [waived] ${w.name}@${w.version} matches "${w.range}" but carries a backported fix\n   ${entry.note}`,
  );
}

for (const a of accepted) {
  const entry = acceptedRisk(a.name, a.version, a.url);
  const line =
    `${a.name}@${a.version} — ${a.url} accepted until ${entry.until}, ` +
    `dev-only (no production dependency reaches it)`;
  // A warning on the run, so the waiver is seen on every PR, not only here.
  console.error(`::warning title=Accepted advisory (${a.severity})::${line}`);
  console.log(`~ [accepted] ${line}\n   ${entry.note}`);
}

/**
 * Exit-code policy: fail CLOSED on findings, fail OPEN on unavailability.
 *
 * These two failures are not the same thing and must not share an exit code:
 *
 * - **A finding is about our code.** It stays red no matter what else went
 *   wrong in the run — including when some chunks never answered. A partial
 *   audit that still turned something up has proven the thing the job exists
 *   to prove, so degradation never downgrades a finding.
 * - **An unreachable endpoint is about npm's uptime.** Measured 2026-09-03/04:
 *   six consecutive 30s timeouts from a clean container, with nothing in the
 *   dependency tree changed. Left red, that blocks every merge in the repo
 *   until a third party recovers, which is not a security control — it is an
 *   outage propagated into our pipeline.
 *
 * So an exhausted chunk with no findings exits 0 and shouts. It must never be
 * *quiet*: `::warning::` puts the line on the PR and in the run summary, so a
 * green check still carries "this audit did not actually run". Set
 * `AUDIT_FAIL_ON_UNREACHABLE=1` to restore the hard failure (useful when a
 * release must not ship on an unverified tree).
 *
 * Exit 2 stays reserved for our own bugs — a malformed request, an unreadable
 * lockfile — which no amount of retrying will fix.
 */
const skippedPackages = unreachable.reduce((n, u) => n + u.packages, 0);

if (unreachable.length > 0) {
  const detail =
    `${unreachable.length} of ${Math.ceil(entries.length / CHUNK)} request chunks ` +
    `(${skippedPackages} of ${entries.length} packages) were NOT audited — ` +
    `${unreachable[0].reason}`;
  console.error(`::warning title=Dependency audit incomplete::${detail}`);
  console.error(`\n! ${detail}`);
  console.error(
    "! This is npm's availability, not a vulnerability. Re-run the job to get full coverage.",
  );
}

if (failing.length > 0) {
  console.error(
    `\n${failing.length} advisories at or above "${threshold}" — failing.`,
  );
  if (unreachable.length > 0) {
    console.error(
      "(Found despite an incomplete audit — the real total may be higher.)",
    );
  }
  process.exit(1);
}

if (unreachable.length > 0) {
  if (process.env.AUDIT_FAIL_ON_UNREACHABLE === "1") {
    console.error(
      '\nAUDIT_FAIL_ON_UNREACHABLE=1 — failing on the incomplete audit.',
    );
    process.exit(2);
  }
  console.log(
    `\nNo advisories at or above "${threshold}" in the ${entries.length - skippedPackages} packages that were checked — passing with a warning.`,
  );
  process.exit(0);
}

console.log(`\nNo advisories at or above "${threshold}".`);
