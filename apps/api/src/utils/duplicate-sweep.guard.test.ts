import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

/**
 * The warning `duplicate-sweep.sh` posts is the last text a reporter reads, and
 * it must not promise a path that does not work.
 *
 * Since #981, only a removal of the `duplicate` label by the trusted account
 * (`DUPLICATE_DETECT_TRUSTED_ACTOR`, default `cipansor-bot`) is permanent — a
 * removal by a human, `github-actions[bot]`, or any other automation is
 * re-applied by `duplicate-detect.sh` on the next sweep. The warning used to
 * say "If a maintainer agrees it is distinct, removing the label cancels the
 * close", which reads as if any maintainer's removal worked. It does not (#985).
 *
 * These tests pin the warning to the trusted account and to the detector's own
 * default, so the text and the rule cannot drift apart again. Driven against a
 * stub `gh`: the reads the sweep makes (the `duplicate` issue list, the comment
 * list, the issue body) and the write it logs (the warning comment).
 */
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const SCRIPT = join(REPO_ROOT, '.github', 'scripts', 'duplicate-sweep.sh');
const DETECT = join(REPO_ROOT, '.github', 'scripts', 'duplicate-detect.sh');

const STUB = `#!/bin/sh
log() { [ -n "\${GH_STUB_LOG:-}" ] && echo "$*" >> "$GH_STUB_LOG"; }
if [ "$1" = "issue" ]; then
  case "$2" in
    list) printf '%s\\n' "\${GH_STUB_ITEMS:-}" ;;
    view) printf '%s' "\${GH_STUB_BODY:-}" ;;
    comment) log "COMMENT $*" ;;
    close) log "CLOSE $*" ;;
  esac
  exit 0
fi
if [ "$1" = "api" ]; then
  shift
  [ "$1" = "--paginate" ] && shift
  case "$1" in
    *"/comments?per_page=100") printf '%s' "\${GH_STUB_COMMENTS:-[]}" ;;
    *) printf '' ;;
  esac
  exit 0
fi
exit 0
`;

let dir: string;
let log: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'duplicate-sweep-'));
  writeFileSync(join(dir, 'gh'), STUB, { mode: 0o755 });
  log = join(dir, 'calls.log');
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function run(env: Record<string, string>) {
  writeFileSync(log, '');
  const r = spawnSync('sh', [SCRIPT], {
    encoding: 'utf8',
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

/** The warning comment is the only write, so the log holds its body verbatim. */
const warning = (calls: string) => {
  expect(calls).toContain('COMMENT');
  return calls;
};

describe('duplicate-sweep.sh warning names the trusted account (#985)', () => {
  // No warning yet on #700 -> the sweep posts one.
  const fresh = { GH_STUB_ITEMS: '700', GH_STUB_BODY: 'body', GH_STUB_COMMENTS: '[]' };

  it('names the trusted account, not "a maintainer"', () => {
    const { out, calls } = run(fresh);
    expect(out).toContain('Warned on issue #700');
    const body = warning(calls);
    expect(body).toContain('cipansor-bot');
    expect(body).not.toContain('If a maintainer agrees');
  });

  it('follows DUPLICATE_DETECT_TRUSTED_ACTOR instead of hard-coding the name', () => {
    const { calls } = run({ ...fresh, DUPLICATE_DETECT_TRUSTED_ACTOR: 'other-bot' });
    expect(warning(calls)).toContain('other-bot');
  });

  it('states that another account’s removal is re-applied', () => {
    const { calls } = run(fresh);
    expect(warning(calls)).toContain('re-applies a removal by any other account');
  });

  it('the detector and the sweep default to the same trusted account', () => {
    // Guard against the two scripts drifting: the detector honours
    // DUPLICATE_DETECT_TRUSTED_ACTOR and the sweep now names it, so both must
    // carry the same default.
    const detector = readFileSync(DETECT, 'utf8');
    expect(detector).toContain('DUPLICATE_DETECT_TRUSTED_ACTOR:-cipansor-bot');
    const sweep = readFileSync(SCRIPT, 'utf8');
    expect(sweep).toContain('DUPLICATE_DETECT_TRUSTED_ACTOR:-cipansor-bot');
  });
});
