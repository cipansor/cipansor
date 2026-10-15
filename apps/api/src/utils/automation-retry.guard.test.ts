import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

/**
 * `automation-retry.sh` — the fleet's missing retry.
 *
 * Every failure in the run history is infrastructure (timeout, sandbox
 * unavailable, a 502, the LLM proxy's 503), and `POST /{id}/dispatch` is
 * fire-and-forget, so a run that dies after the 201 is lost. The script
 * re-dispatches a **cron** automation whose latest run failed for an
 * infrastructure reason, bounded by a per-run attempt ledger in the KV store,
 * and reports the ones that ran out of chances in one health issue.
 *
 * The stub `curl` serves the automation list, each automation's runs, the KV
 * ledger and the dispatch, and runs every `--jq` expression through `jq` so the
 * real filters (the cron selector, the newest-run fields, the retryable kinds)
 * are exercised too, not just the shell around them. The stub `gh` serves the
 * issue list and records the comments/creates/patches.
 */
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const SCRIPT = join(REPO_ROOT, '.github', 'scripts', 'automation-retry.sh');
const WORKFLOW = join(REPO_ROOT, '.github', 'workflows', 'automation-retry.yml');

const CURL = `#!/bin/sh
log() { [ -n "\${CURL_STUB_LOG:-}" ] && echo "$*" >> "$CURL_STUB_LOG"; }
out=""; url=""; method=GET; data=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -w) shift 2 ;;
    -X) method="$2"; shift 2 ;;
    -d) data="$2"; shift 2 ;;
    -H) shift 2 ;;
    -*) shift ;;
    *) [ -z "$url" ] && url="$1"; shift ;;
  esac
done
case "$url" in
  *"/kv/"*)
    if [ "$method" = PUT ]; then
      log "KV_PUT $url $data"
      [ -n "$out" ] && printf '%s' '{}' > "$out"
      printf '%s' "\${CURL_STUB_KV_PUT_CODE:-201}"
    else
      [ "\${CURL_STUB_KV_FAIL:-}" = 1 ] && exit 1
      # A key that does not exist is 404, not an empty 200: the script tells
      # "no attempt yet" from "KV unreadable" by the status code alone.
      [ -n "$out" ] && printf '%s' "\${CURL_STUB_KV_JSON:-}" > "$out"
      printf '%s' "\${CURL_STUB_KV_CODE:-200}"
    fi ;;
  */dispatch)
    log "DISPATCH $url $data"
    [ -n "$out" ] && printf '%s' "\${CURL_STUB_DISPATCH_CODE:-201}" || printf '{}' ;;
  *"/runs?limit=5")
    [ "\${CURL_STUB_RUNS_FAIL:-}" = 1 ] && exit 1
    aid=$(printf '%s' "$url" | sed -n 's|.*/v1/\\([0-9a-f-]*\\)/runs.*|\\1|p')
    eval "v=\\\${CURL_STUB_RUNS_$(printf '%s' "$aid" | tr -d -):-}"
    # The default is held in a variable: a literal \`}\` inside \${v:-...} would
    # close the expansion early and append a stray brace to the JSON.
    empty='{"runs":[]}'
    [ -n "$out" ] && printf '200' || printf '%s' "\${v:-$empty}" ;;
  *)
    [ "\${CURL_STUB_AUTOS_FAIL:-}" = 1 ] && exit 1
    [ -n "$out" ] && printf '200' || printf '%s' "\${CURL_STUB_AUTOS:-}" ;;
esac
`;

const GH = `#!/bin/sh
log() { [ -n "\${GH_STUB_LOG:-}" ] && echo "$*" >> "$GH_STUB_LOG"; }
JQ=""; prev=""
for a in "$@"; do [ "$prev" = "--jq" ] && JQ="$a"; prev="$a"; done
emit() { if [ -n "$JQ" ]; then printf '%s' "$1" | jq -r "$JQ"; else printf '%s\\n' "$1"; fi; }
bodyof() { prev=""; for a in "$@"; do
  [ "$prev" = "--body-file" ] && cat "$a"
  [ "$prev" = "-F" ] && case "$a" in body=@*) cat "\${a#body=@}" ;; esac
  prev="$a"; done; }
case "$1" in
  issue)
    case "$2" in
      create) log "CREATE"; bodyof "$@" > "$GH_STUB_DIR/created"; echo "https://github.com/o/r/issues/900" ;;
      comment) log "ICOMMENT $3"; bodyof "$@" > "$GH_STUB_DIR/icomment" ;;
    esac ;;
  api)
    case "$*" in
      *"issues?state=open"*)
        [ "\${GH_STUB_ISSUES_FAIL:-}" = 1 ] && exit 1
        emit "\${GH_STUB_OPEN_ISSUES:-[]}" ;;
      *"-X PATCH"*) log "PATCH $*"; bodyof "$@" > "$GH_STUB_DIR/patched" ;;
      *"/issues/"*) emit "\${GH_STUB_ISSUE_JSON:-{}}" ;;
    esac ;;
esac
exit 0
`;

let dir: string;
let log: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'automation-retry-'));
  writeFileSync(join(dir, 'curl'), CURL, { mode: 0o755 });
  writeFileSync(join(dir, 'gh'), GH, { mode: 0o755 });
  log = join(dir, 'calls.log');
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const NOW = 1_760_150_000;
const CRON = 'aaaaaaaa-1111-2222-3333-444444444444';
const EVENT = 'bbbbbbbb-1111-2222-3333-444444444444';
const RUN = '11111111-2222-3333-4444-555555555555';
const ago = (minutes: number) => new Date((NOW - minutes * 60) * 1000).toISOString();

// The automation list: one cron, one event, so the cron-only rule is exercised.
const AUTOS = JSON.stringify({
  automations: [
    { id: CRON, name: 'SDLC 19 · Pemburu bug', trigger: { type: 'cron' } },
    { id: EVENT, name: 'SDLC 18 · Gerbang tinjau PR', trigger: { type: 'event' } },
  ],
});

// A run record with just the fields the script reads.
const runJson = (status: string, phase: string, kind: string, createdAt: string) =>
  JSON.stringify({
    runs: [
      {
        id: RUN,
        status,
        created_at: createdAt,
        status_detail: status === 'FAILED' ? { phase, kind } : null,
      },
    ],
  });

const CRON_KEY = `CURL_STUB_RUNS_${CRON.replace(/-/g, '')}`;

function run(env: Record<string, string> = {}) {
  writeFileSync(log, '');
  for (const f of ['created', 'patched', 'icomment']) rmSync(join(dir, f), { force: true });
  const r = spawnSync('sh', [SCRIPT], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      REPO: 'o/r',
      GH_TOKEN: 'x',
      NOW: String(NOW),
      CURL_STUB_LOG: log,
      GH_STUB_LOG: log,
      GH_STUB_DIR: dir,
      CURL_STUB_AUTOS: AUTOS,
      OPENHANDS_API_KEY: 'k',
      ...env,
    },
  });
  const read = (f: string) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8') : '');
  return {
    status: r.status ?? -1,
    out: `${r.stdout}${r.stderr}`,
    calls: existsSync(log) ? readFileSync(log, 'utf8') : '',
    created: read('created'),
    patched: read('patched'),
  };
}

describe('automation-retry.sh — retry an infrastructure failure', () => {
  it('re-dispatches a cron automation whose latest run timed out, once, with the run id', () => {
    const { status, calls, out } = run({
      [CRON_KEY]: runJson('FAILED', 'execution', 'timeout', ago(30)),
      CURL_STUB_KV_CODE: '404',
    });
    expect(status).toBe(0);
    expect(out).toContain('retried');
    const dispatches = calls.match(/^DISPATCH /gm) ?? [];
    expect(dispatches).toHaveLength(1);
    expect(calls).toContain(`/v1/${CRON}/dispatch`);
    expect(calls).toContain(`"source":"retry-sweeper"`);
    expect(calls).toContain(`"retry_of":"${RUN}"`);
  });

  it('reads a missing ledger as no attempt yet, not as an unreadable KV', () => {
    // The real API answers 404 `key_not_found` for a key it has never seen. A
    // `curl -f` read would treat that as a failure and never retry anything.
    const { calls, out } = run({
      [CRON_KEY]: runJson('FAILED', 'execution', 'timeout', ago(30)),
      CURL_STUB_KV_CODE: '404',
    });
    expect(out).not.toContain('KV unreadable');
    expect(calls).toContain('/dispatch');
    expect(calls).toMatch(/KV_PUT .*nx=true/);
  });

  it('claims the attempt before dispatching, so a lost race cannot double-dispatch', () => {
    const { calls } = run({
      [CRON_KEY]: runJson('FAILED', 'verification', 'environment_unavailable', ago(30)),
      CURL_STUB_KV_JSON: JSON.stringify({ value: {}, version: 0 }),
    });
    expect(calls).toMatch(/KV_PUT .*nx=true/);
    expect(calls.indexOf('KV_PUT')).toBeLessThan(calls.indexOf('DISPATCH'));
  });

  it('uses optimistic concurrency once the ledger exists', () => {
    const { calls } = run({
      [CRON_KEY]: runJson('FAILED', 'dispatch', 'unknown', ago(30)),
      CURL_STUB_KV_JSON: JSON.stringify({
        value: { attempts: 1, last_at: NOW - 3600 },
        version: 4,
      }),
    });
    expect(calls).toContain('if_version=4');
  });

  it.each([
    ['verification', 'environment_unavailable'],
    ['dispatch', 'unknown'],
    ['dispatch', 'server_error'],
    ['execution', 'execution_error'],
    ['callback', 'execution_error'],
  ])('retries %s/%s', (phase, kind) => {
    const { calls } = run({
      [CRON_KEY]: runJson('FAILED', phase, kind, ago(30)),
      CURL_STUB_KV_JSON: JSON.stringify({ value: {}, version: 0 }),
    });
    expect(calls).toContain('/dispatch');
  });

  it.each([
    ['execution', 'auth'],
    ['execution', 'quota'],
    ['dispatch', 'config'],
  ])('never retries %s/%s: that is a person’s decision', (phase, kind) => {
    const { calls, out } = run({
      [CRON_KEY]: runJson('FAILED', phase, kind, ago(30)),
      CURL_STUB_KV_JSON: JSON.stringify({ value: {}, version: 0 }),
    });
    expect(calls).not.toContain('/dispatch');
    expect(out).toContain('not an infrastructure failure');
  });

  it('does nothing when the latest run succeeded', () => {
    const { calls } = run({
      [CRON_KEY]: runJson('COMPLETED', '', '', ago(30)),
      CURL_STUB_KV_JSON: JSON.stringify({ value: {}, version: 0 }),
    });
    expect(calls).not.toContain('/dispatch');
  });

  it('does not retry a run older than the window', () => {
    const { calls, out } = run({
      [CRON_KEY]: runJson('FAILED', 'execution', 'timeout', ago(2000)),
      CURL_STUB_KV_JSON: JSON.stringify({ value: {}, version: 0 }),
    });
    expect(calls).not.toContain('/dispatch');
    expect(out).toContain('outside the');
  });

  it('backs off before retrying the same run again', () => {
    const { calls, out } = run({
      [CRON_KEY]: runJson('FAILED', 'execution', 'timeout', ago(30)),
      CURL_STUB_KV_JSON: JSON.stringify({ value: { attempts: 1, last_at: NOW - 300 }, version: 2 }),
    });
    expect(calls).not.toContain('/dispatch');
    expect(out).toContain('backing off');
  });

  it('stops at RETRY_MAX and reports the automation as out of chances', () => {
    const { calls, created } = run({
      [CRON_KEY]: runJson('FAILED', 'execution', 'timeout', ago(30)),
      CURL_STUB_KV_JSON: JSON.stringify({
        value: { attempts: 2, last_at: NOW - 3600 },
        version: 3,
      }),
      RETRY_MAX: '2',
    });
    expect(calls).not.toContain('/dispatch');
    expect(calls).toContain('CREATE');
    expect(created).toContain('<!-- automation-retry:health -->');
    expect(created).toContain('SDLC 19 · Pemburu bug');
    expect(created).toContain('`execution/timeout`');
  });

  it('never retries an event automation: its payload is not recoverable', () => {
    const { calls } = run({
      [`CURL_STUB_RUNS_${EVENT.replace(/-/g, '')}`]: runJson(
        'FAILED',
        'execution',
        'timeout',
        ago(30)
      ),
      CURL_STUB_KV_JSON: JSON.stringify({ value: {}, version: 0 }),
    });
    expect(calls).not.toContain('/dispatch');
    expect(calls).not.toContain('/v1/' + EVENT);
  });

  it('does not retry blind when the ledger cannot be read', () => {
    const { calls, out } = run({
      [CRON_KEY]: runJson('FAILED', 'execution', 'timeout', ago(30)),
      CURL_STUB_KV_FAIL: '1',
    });
    expect(calls).not.toContain('/dispatch');
    expect(out).toContain('KV unreadable');
  });

  it('rolls the attempt back when the dispatch is refused', () => {
    const { calls, out } = run({
      [CRON_KEY]: runJson('FAILED', 'execution', 'timeout', ago(30)),
      CURL_STUB_KV_JSON: JSON.stringify({ value: {}, version: 0 }),
      CURL_STUB_DISPATCH_CODE: '401',
    });
    expect(out).toContain('attempt rolled back');
    // The rollback write is a second KV PUT after the claim.
    expect((calls.match(/KV_PUT/g) ?? []).length).toBe(2);
  });

  it('skips, with a warning, an automation whose runs cannot be read', () => {
    const { calls, out } = run({
      CURL_STUB_RUNS_FAIL: '1',
      CURL_STUB_KV_JSON: JSON.stringify({ value: {}, version: 0 }),
    });
    expect(calls).not.toContain('/dispatch');
    expect(out).toContain('runs unreadable');
  });

  it('fails when the automation list cannot be read, instead of closing the report', () => {
    const { status, calls } = run({
      CURL_STUB_AUTOS_FAIL: '1',
      GH_STUB_OPEN_ISSUES: JSON.stringify([
        { number: 41, body: '<!-- automation-retry:health -->' },
      ]),
    });
    expect(status).not.toBe(0);
    expect(calls).not.toContain('ICOMMENT 41');
  });
});

describe('automation-retry.sh — the health issue', () => {
  it('updates the open health issue in place when the list changes', () => {
    const { calls, patched } = run({
      [CRON_KEY]: runJson('FAILED', 'execution', 'timeout', ago(30)),
      CURL_STUB_KV_JSON: JSON.stringify({
        value: { attempts: 2, last_at: NOW - 3600 },
        version: 3,
      }),
      RETRY_MAX: '2',
      GH_STUB_OPEN_ISSUES: JSON.stringify([
        { number: 41, body: '<!-- automation-retry:health -->' },
      ]),
      GH_STUB_ISSUE_JSON: JSON.stringify({ body: 'lama' }),
    });
    expect(calls).not.toContain('CREATE');
    expect(calls).toContain('PATCH repos/o/r/issues/41');
    expect(patched).toContain('SDLC 19 · Pemburu bug');
  });

  it('closes the health issue once nothing is out of chances', () => {
    const { calls } = run({
      [CRON_KEY]: runJson('COMPLETED', '', '', ago(30)),
      GH_STUB_OPEN_ISSUES: JSON.stringify([
        { number: 41, body: '<!-- automation-retry:health -->' },
      ]),
    });
    expect(calls).toContain('ICOMMENT 41');
    expect(calls).toMatch(/PATCH repos\/o\/r\/issues\/41 .*state=closed/);
    expect(calls).not.toContain('CREATE');
  });

  it('does nothing when nothing failed and no issue is open', () => {
    const { status, calls } = run({
      [CRON_KEY]: runJson('COMPLETED', '', '', ago(30)),
    });
    expect(status).toBe(0);
    expect(calls).not.toContain('CREATE');
    expect(calls).not.toContain('ICOMMENT');
  });
});

describe('automation-retry.yml', () => {
  const yml = () => readFileSync(WORKFLOW, 'utf8');

  it('runs hourly and by hand, with the key the dispatch needs', () => {
    expect(yml()).toMatch(/cron: '47 \* \* \* \*'/);
    expect(yml()).toContain('workflow_dispatch:');
    expect(yml()).toContain('OPENHANDS_API_KEY: ${{ secrets.OPENHANDS_API_KEY }}');
    expect(yml()).toContain('automation-retry.sh');
  });

  it('can write the issue, and nothing else', () => {
    const perms = yml().slice(yml().indexOf('permissions:'), yml().indexOf('concurrency:'));
    expect(perms).toContain('issues: write');
    expect(perms).toContain('contents: read');
    expect(perms).not.toMatch(/contents: write|actions: write|pull-requests: write/);
  });
});
