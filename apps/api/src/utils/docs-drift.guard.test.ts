import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

/**
 * Behaviour `docs-drift.sh` hides, driven against a stub `gh` and a stub
 * `python3`:
 *
 *  - one issue per cause: an existing open `docs:` issue is commented on, not
 *    duplicated, so a doc that stays stale does not open a new issue every run;
 *  - the issue carries `documentation` and `pending-maintainer` (fixing prose is
 *    a judgement call, and `Tiket jadi PR` only starts on `bot-implement`);
 *  - when the checker reports nothing and every code name is documented, the
 *    run writes nothing at all;
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
      list) log "LIST"; printf '%s\\n' "\${GH_STUB_OPEN:-}" ;;
      comment) log "COMMENT $3" ;;
      create) log "CREATE $*" ;;
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
  const r = spawnSync('sh', [SCRIPT], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      REPO: 'o/r',
      GH_TOKEN: 'x',
      GH_STUB_LOG: log,
      ...env,
    },
  });
  return {
    status: r.status ?? -1,
    out: `${r.stdout}${r.stderr}`,
    calls: existsSync(log) ? readFileSync(log, 'utf8') : '',
  };
}

describe('docs-drift.sh', () => {
  it('opens one issue labelled documentation + pending-maintainer when the checker finds drift', () => {
    const { calls } = run({ PY_STUB_ERROR: 'angka salah' });
    expect(calls).toContain('CREATE');
    expect(calls).toContain('--label documentation');
    expect(calls).toContain('--label pending-maintainer');
    expect(calls).not.toContain('COMMENT');
  });

  it('comments on the existing open issue instead of opening a second one', () => {
    const { out, calls } = run({ PY_STUB_ERROR: 'angka salah', GH_STUB_OPEN: '42' });
    expect(calls).toContain('COMMENT 42');
    expect(calls).not.toContain('CREATE');
    expect(out).toContain('#42');
  });

  it('writes nothing when the checker is clean and every code name is documented', () => {
    // Point both scans at temp trees: a module whose name is already in the
    // docs tree, so neither signal fires.
    const root = mkdtempSync(join(tmpdir(), 'docs-drift-clean-'));
    const mods = join(root, 'modules', 'attendance');
    const docs = join(root, 'docs');
    mkdirSync(mods, { recursive: true });
    mkdirSync(docs, { recursive: true });
    writeFileSync(join(mods, 'attendance.routes.ts'), '');
    writeFileSync(join(docs, 'NOTES.md'), 'modul attendance dan rute attendance\n');
    try {
      const { out, calls } = run({ MODULES_DIR: join(root, 'modules'), DOCS_DIR: docs });
      expect(calls).not.toContain('CREATE');
      expect(calls).not.toContain('COMMENT');
      expect(out).toContain('tidak ada yang dilaporkan');
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
      const { calls } = run({ MODULES_DIR: join(root, 'modules'), DOCS_DIR: docs });
      expect(calls).toContain('CREATE');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('writes nothing under DOCS_DRIFT_DRY_RUN', () => {
    const { calls } = run({ PY_STUB_ERROR: 'angka salah', DOCS_DRIFT_DRY_RUN: '1' });
    expect(calls).not.toContain('CREATE');
    expect(calls).not.toContain('COMMENT');
  });
});
