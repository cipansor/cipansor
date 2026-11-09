import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

/**
 * Behaviour `docs-drift.sh` hides, driven against a stub `gh` and a stub
 * `python3`:
 *
 *  - it edits the body of the ONE parent drift issue (default #782) between its
 *    markers, and never opens a second issue — the owner's decision of
 *    2026-10-11 after sixteen overlapping doc issues (#782 rule 3);
 *  - the block between the markers is rewritten whole, so a finding that no
 *    longer holds disappears on its own (#782 rules 1-2);
 *  - when nothing drifts the body still says so, in place, and the issue stays
 *    open (#782 rule 5);
 *  - `DOCS_DRIFT_DRY_RUN` proves the whole path without touching a live issue.
 *
 * The skill scripts are stubbed so the test is hermetic; the real ones are
 * stdlib-only and are exercised by the workflow itself.
 */
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const SCRIPT = join(REPO_ROOT, '.github', 'scripts', 'docs-drift.sh');

const GH_STUB = `#!/bin/sh
log() { [ -n "\${GH_STUB_LOG:-}" ] && echo "$*" >> "$GH_STUB_LOG"; }
case "$1" in
  issue)
    case "$2" in
      view) printf '%s\\n' "\${GH_STUB_BODY:-}" ;;
      edit) log "EDIT $3"; printf '%s\\n' "$*" > "\${GH_STUB_NEWBODY:-/dev/null}" ;;
    esac ;;
esac
exit 0
`;

// collect_facts: silent. check_docs: emit an ERROR only when asked.
const PY_STUB = `#!/bin/sh
case "$*" in
  *collect_facts*) exit 0 ;;
  *check_docs*) [ -n "\${PY_STUB_ERROR:-}" ] && printf 'ERROR    L1  [angka-salah]  %s\\n' "\${PY_STUB_ERROR}"; exit 0 ;;
esac
exit 0
`;

let dir: string;
let log: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'docs-drift-'));
  writeFileSync(join(dir, 'gh'), GH_STUB, { mode: 0o755 });
  writeFileSync(join(dir, 'python3'), PY_STUB, { mode: 0o755 });
  log = join(dir, 'calls.log');
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function run(env: Record<string, string>) {
  writeFileSync(log, '');
  const newBodyFile = join(dir, 'new-body.md');
  const r = spawnSync('sh', [SCRIPT], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      REPO: 'o/r',
      GH_TOKEN: 'x',
      GH_STUB_LOG: log,
      GH_STUB_NEWBODY: newBodyFile,
      ...env,
    },
  });
  return {
    status: r.status ?? -1,
    out: `${r.stdout}${r.stderr}`,
    calls: existsSync(log) ? readFileSync(log, 'utf8') : '',
    newBody: existsSync(newBodyFile) ? readFileSync(newBodyFile, 'utf8') : '',
  };
}

describe('docs-drift.sh', () => {
  it('rewrites the block between the markers of the parent issue, whole', () => {
    // Rule 1: rewritten whole, never appended as a comment. Rule 2: a finding
    // that no longer holds disappears because the block is replaced, not added.
    const oldBody = [
      'بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ',
      '',
      '## Aturan untuk pemeta',
      '',
      '<!-- docs-drift:start -->',
      '- [ ] temuan lama yang sudah tidak berlaku',
      '<!-- docs-drift:end -->',
      '',
      '## Catatan lain',
    ].join('\n');
    const { calls, newBody } = run({
      PY_STUB_ERROR: 'angka salah',
      GH_STUB_BODY: oldBody,
    });
    expect(calls).toContain('EDIT 782');
    expect(calls).not.toContain('CREATE');
    expect(newBody).not.toContain('temuan lama yang sudah tidak berlaku');
    expect(newBody).toContain('angka salah');
    // The surrounding body is untouched, and the markers appear once.
    expect(newBody).toContain('## Aturan untuk pemeta');
    expect(newBody).toContain('## Catatan lain');
    expect(newBody.match(/<!-- docs-drift:start -->/g)).toHaveLength(1);
    expect(newBody.match(/<!-- docs-drift:end -->/g)).toHaveLength(1);
  });

  it('creates the section at the end when the parent body has no markers yet', () => {
    const { calls, newBody } = run({
      PY_STUB_ERROR: 'angka salah',
      GH_STUB_BODY: 'بِسْمِ اللَّهِ\n\nisi lama',
    });
    expect(calls).toContain('EDIT 782');
    expect(newBody).toContain('isi lama');
    expect(newBody).toContain('<!-- docs-drift:start -->');
    expect(newBody).toContain('angka salah');
  });

  it('says so in place, and keeps the issue, when nothing drifts', () => {
    // Rule 5: an empty list is written, the issue stays open — no create.
    const root = mkdtempSync(join(tmpdir(), 'docs-drift-clean-'));
    const mods = join(root, 'modules', 'attendance');
    const docs = join(root, 'docs');
    mkdirSync(mods, { recursive: true });
    mkdirSync(docs, { recursive: true });
    writeFileSync(join(mods, 'attendance.routes.ts'), '');
    writeFileSync(join(docs, 'NOTES.md'), 'modul attendance dan rute attendance\n');
    try {
      const { calls, newBody } = run({
        MODULES_DIR: join(root, 'modules'),
        JOBS_DIR: join(root, 'no-jobs'),
        DOCS_DIR: docs,
        GH_STUB_BODY: '<!-- docs-drift:start -->\n<!-- docs-drift:end -->',
      });
      expect(calls).not.toContain('CREATE');
      expect(calls).toContain('EDIT 782');
      expect(newBody).toContain('Tidak ada temuan terbuka');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports a code name that no doc mentions', () => {
    const root = mkdtempSync(join(tmpdir(), 'docs-drift-orphan-'));
    const mods = join(root, 'modules', 'attendance');
    const docs = join(root, 'docs');
    mkdirSync(mods, { recursive: true });
    mkdirSync(docs, { recursive: true });
    writeFileSync(join(mods, 'attendance.routes.ts'), '');
    writeFileSync(join(docs, 'NOTES.md'), 'tidak menyebut apa pun\n');
    try {
      const { newBody } = run({
        MODULES_DIR: join(root, 'modules'),
        JOBS_DIR: join(root, 'no-jobs'),
        DOCS_DIR: docs,
        GH_STUB_BODY: '<!-- docs-drift:start -->\n<!-- docs-drift:end -->',
      });
      expect(newBody).toContain('attendance');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports a scheduled job whose name no doc mentions', () => {
    // The orphan signal covered modules and routes but not `*.job.ts` files, so a
    // new scheduled job could ship with no doc naming it — the exact drift this
    // signal exists to catch.
    const root = mkdtempSync(join(tmpdir(), 'docs-drift-job-'));
    const mods = join(root, 'modules');
    const jobs = join(root, 'jobs');
    const docs = join(root, 'docs');
    mkdirSync(mods, { recursive: true });
    mkdirSync(jobs, { recursive: true });
    mkdirSync(docs, { recursive: true });
    writeFileSync(join(jobs, 'spp-reminder.job.ts'), '');
    writeFileSync(join(docs, 'NOTES.md'), 'tidak menyebut pekerjaan apa pun\n');
    try {
      const { newBody } = run({
        MODULES_DIR: mods,
        JOBS_DIR: jobs,
        DOCS_DIR: docs,
        GH_STUB_BODY: '<!-- docs-drift:start -->\n<!-- docs-drift:end -->',
      });
      expect(newBody).toContain('spp-reminder');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not report a job whose name a doc already carries', () => {
    const root = mkdtempSync(join(tmpdir(), 'docs-drift-job-ok-'));
    const mods = join(root, 'modules');
    const jobs = join(root, 'jobs');
    const docs = join(root, 'docs');
    mkdirSync(mods, { recursive: true });
    mkdirSync(jobs, { recursive: true });
    mkdirSync(docs, { recursive: true });
    writeFileSync(join(jobs, 'spp-reminder.job.ts'), '');
    writeFileSync(join(docs, 'NOTES.md'), 'pekerjaan `spp-reminder` berjalan tiap hari\n');
    try {
      const { newBody } = run({
        MODULES_DIR: mods,
        JOBS_DIR: jobs,
        DOCS_DIR: docs,
        GH_STUB_BODY: '<!-- docs-drift:start -->\n<!-- docs-drift:end -->',
      });
      expect(newBody).toContain('Tidak ada temuan terbuka');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('never opens a second drift issue', () => {
    // Rule 3: #782 is the only parent. The script has no create path at all.
    const source = readFileSync(SCRIPT, 'utf8');
    expect(source).not.toContain('gh issue create');
    const { calls } = run({ PY_STUB_ERROR: 'angka salah', GH_STUB_BODY: 'x' });
    expect(calls).not.toContain('CREATE');
  });

  it('writes nothing under DOCS_DRIFT_DRY_RUN', () => {
    const { calls } = run({ PY_STUB_ERROR: 'angka salah', DOCS_DRIFT_DRY_RUN: '1' });
    expect(calls).not.toContain('EDIT');
    expect(calls).not.toContain('CREATE');
  });
});
