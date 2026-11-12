import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

/**
 * The fleet's new deterministic consequences, driven against a stub `gh`:
 *
 *  - `label-guard.sh` removes a protected label applied by anyone but
 *    `cipansor-bot`, leaves the bot's and a GitHub App's labels, leaves the
 *    human-decision labels, and tells the actor once;
 *  - `reaction.sh` adds exactly one acknowledgement reaction, replacing any the
 *    same account left before;
 *  - `basmalah.sh` puts the basmalah at the top of a description and is
 *    idempotent;
 *  - `issue-triage-bridge.sh` dispatches the triage owner when a bot applies a
 *    type or priority label (collapsing the labeler's burst to one dispatch per
 *    state) or when a not-`ready` issue has activity newer than its last triage,
 *    so an edited description is re-triaged without a trigger on `issues.edited`.
 *
 * Plus the contracts the prompts and workflows share: the PR template carries
 * the basmalah into the body while an issue form only shows it (its `markdown`
 * block is preview only, so the `Basmalah` workflow supplies it for issues), the
 * triage owner comments first and edits the issue body only at `ready`, the
 * priority rubric is evidence-backed, and the scripts are wired into the
 * workflows that run them.
 */
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const LABEL_GUARD = join(REPO_ROOT, '.github', 'scripts', 'label-guard.sh');
const REACTION = join(REPO_ROOT, '.github', 'scripts', 'reaction.sh');
const BASMALAH = join(REPO_ROOT, '.github', 'scripts', 'basmalah.sh');
const ACKNOWLEDGE = join(REPO_ROOT, '.github', 'scripts', 'acknowledge.sh');
const DEPLOY = join(REPO_ROOT, 'scripts', 'deploy-sdlc-agents.py');
const WORKFLOWS = join(REPO_ROOT, '.github', 'workflows');
const BRIDGE = join(REPO_ROOT, '.github', 'scripts', 'issue-triage-bridge.sh');

const AI_FOOTER = 'This comment was created by an AI agent';

const STUB = `#!/bin/sh
log() { [ -n "\${GH_STUB_LOG:-}" ] && echo "$*" >> "$GH_STUB_LOG"; }
case "$1" in
  label)
    case "$2" in
      list) printf '%s\\n' "\${GH_STUB_LABELS:-}" ;;
    esac ;;
  api)
    case "$*" in
      # The real endpoint answers an object with two fields, and the script
      # selects both with --jq. Honouring --jq here is what makes the
      # role_name branch testable: permission read + role_name triage
      # (a triage collaborator) must not read as an outsider.
      *"/collaborators/"*"/permission"*)
        perm="\${GH_STUB_PERM:-none}"; role="\${GH_STUB_ROLE:-$perm}"
        json=$(printf '{"permission":"%s","role_name":"%s"}' "$perm" "$role")
        jqexpr=""; prev=""
        for a in "$@"; do [ "$prev" = "--jq" ] && jqexpr="$a"; prev="$a"; done
        if [ -n "$jqexpr" ]; then printf '%s\\n' "$json" | jq -r "$jqexpr"
        else printf '%s\\n' "$json"; fi ;;
      *"/comments?per_page"*) [ -n "\${GH_STUB_COMMENTS:-}" ] && printf '%s\\n' "\${GH_STUB_COMMENTS}" ;;
      *"/reactions?per_page"*) [ -n "\${GH_STUB_REACTIONS:-}" ] && printf '%s\\n' "\${GH_STUB_REACTIONS}" ;;
      *"/issues/"*"/labels"*"--jq"*) [ -n "\${GH_STUB_CURRENT:-}" ] && printf '%s\\n' "\${GH_STUB_CURRENT}" ;;
      *"/issues/comments/"*"/reactions"*"-f content"*) log "REACT_COMMENT $*" ;;
      *"/issues/"*"/reactions"*"-f content"*) log "REACT_ISSUE $*" ;;
      *"/issues/"*"/comments"*"-f body"*) log "COMMENT $*" ;;
      *"-X DELETE"*"/labels/"*) log "UNLABEL $*" ;;
      *"-X DELETE"*"/reactions/"*) log "UNREACT $*" ;;
      *"--jq .body"*)
        n=$(cat "\${GH_STUB_LOG}.n" 2>/dev/null || echo 0)
        echo $((n + 1)) > "\${GH_STUB_LOG}.n"
        if [ "$n" -eq 0 ]; then printf '%s' "\${GH_STUB_BODY:-}"; else printf '%s' "\${GH_STUB_BODY2:-\${GH_STUB_BODY:-}}"; fi ;;
      *"-X PATCH"*"--input"*)
        for a in "$@"; do last="$a"; done
        log "PATCH $*"
        log "PATCH_BODY $(cat "$last" 2>/dev/null)" ;;
      *"-X PATCH"*) log "PATCH $*" ;;
      *"/user"*) printf '%s\\n' "\${GH_STUB_LOGIN:-cipansor-bot}" ;;
    esac ;;
esac
exit 0
`;

const CURL_STUB = `#!/bin/sh
log() { [ -n "\${CURL_STUB_LOG:-}" ] && echo "$*" >> "$CURL_STUB_LOG"; }
code="\${CURL_STUB_CODE:-200}"; exitcode=0
out=""; method=""; bodyarg=""; wantcode=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -w) wantcode=1; shift 2 ;;
    -X) method="$2"; shift 2 ;;
    -d) bodyarg="$2"; log "BODY $2"; shift 2 ;;
    -H) shift 2 ;;
    -*) shift ;;
    *) [ -z "$url" ] && url="$1"; shift ;;
  esac
done
# The automation KV store, backed by files under CURL_STUB_KV_DIR (one file per
# key, the key as the filename). The bridge keeps its checkpoints here instead of
# in issue comments; the stub answers the same shapes the real store does - a 404
# key_not_found for a missing key, 201/200 on PUT, a keys/total listing for a
# prefix, and DELETE. A GET without -o prints the body; with -w the HTTP code is
# appended, so the script's command substitution reads it.
case "$url" in
  *"/kv"*)
    kvdir="\${CURL_STUB_KV_DIR:-/tmp/kv-stub}"
    mkdir -p "$kvdir" 2>/dev/null || true
    case "$url" in
      *"/kv?"*|*"/kv")
        pre=""
        case "$url" in *prefix=*) pre="\${url#*prefix=}"; pre="\${pre%%&*}" ;; esac
        keys=$(ls -1 "$kvdir" 2>/dev/null | grep -F "$pre" || true)
        keys=$(printf '%s\n' "$keys" | grep . || true)
        cnt=$(printf '%s\n' "$keys" | grep -c . || true)
        json=$(printf '%s\n' "$keys" | grep . | jq -R . | jq -sc .)
        log "KV_LIST $url"
        body=$(jq -nc --argjson k "$json" --argjson c "$cnt" '{keys:$k,count:$c,total:$c,limit:100,offset:0}') ;;
      *)
        k=$(printf '%s' "$url" | sed -n 's#.*/kv/\\([^?]*\\).*#\\1#p')
        case "$method" in
          DELETE)
            log "KV_DELETE $k"
            if [ -f "$kvdir/$k" ]; then rm -f "$kvdir/$k"; body=$(jq -nc --arg k "$k" '{key:$k,deleted:true}')
            else body=$(jq -nc --arg k "$k" '{key:$k,deleted:false}'); fi
            code=200 ;;
          PUT)
            log "KV_PUT $k $bodyarg"
            if [ -n "\${CURL_STUB_KV_PUT_FAIL:-}" ]; then
              body='{"detail":"store unavailable"}'; code=503; exitcode=22
            else
              if [ -f "$kvdir/$k" ]; then code=200; else code=201; fi
              printf '%s' "$bodyarg" > "$kvdir/$k"
              body=$(jq -nc --arg k "$k" '{key:$k,created:false}')
            fi ;;
          *)
            log "KV_GET $k"
            if [ -f "$kvdir/$k" ]; then
              v=$(cat "$kvdir/$k")
              body=$(jq -nc --arg k "$k" --argjson v "$v" '{key:$k,value:$v,version:1}')
              code=200
            else
              body='{"detail":"key_not_found"}'; code=404
            fi ;;
        esac ;;
    esac
    if [ -n "$out" ]; then printf '%s' "$body" > "$out"; else printf '%s' "$body"; fi
    [ -n "$wantcode" ] && printf '%s' "$code"
    exit "$exitcode" ;;
esac
# A read of the triage owner's runs. The real API returns a *page of runs*, and
# IGNORES a run_id= query (it always returns the newest page) — so the stub must
# too, or a test would pass on a run_id= read the API never answers. The listing
# is fed by CURL_STUB_RUNS (JSON object {runs:[...]}, newest first) and the
# script filters it by .id, paging with limit/offset; the stub slices the array
# by those params to emulate the real paging. CURL_STUB_RUNS_RAW, when set, is
# returned verbatim (to model an unreadable page). Distinct log line so a test
# that asserts on DISPATCH is not confused by a read.
case "$url" in
  */runs*)
    log "RUNS $url"
    if [ -n "\${CURL_STUB_RUNS_RAW:-}" ]; then printf '%s' "$CURL_STUB_RUNS_RAW"; exit 0; fi
    runs_json="\${CURL_STUB_RUNS:-}"
    if [ -z "$runs_json" ]; then runs_json='{"runs":[]}'; fi
    off=0; lim=100
    case "$url" in *offset=*) off="\${url#*offset=}"; off="\${off%%&*}" ;; esac
    case "$url" in *limit=*) lim="\${url#*limit=}"; lim="\${lim%%&*}" ;; esac
    printf '%s' "$runs_json" | jq -c --argjson o "$off" --argjson l "$lim" '{runs: (.runs[$o:($o+$l)])}'
    exit 0 ;;
esac
log "DISPATCH $url"
[ -n "$out" ] && printf '{"status":"accepted","id":"%s"}' "\${CURL_STUB_RUN_ID-run-1}" > "$out"
printf '%s' "$code"
`;

const BRIDGE_STUB = `#!/bin/sh
log() { [ -n "\${GH_STUB_LOG:-}" ] && echo "$*" >> "\${GH_STUB_LOG}"; }
post() { for a in "$@"; do last="$a"; done; log "POST_MARKER $(cat "$last" 2>/dev/null)"; }
log "GH $*"
# A synthesized comment page built from the legacy markers a test sets, so the
# bridge's own jq filters run against a realistic listing. A marker comment is
# authored by github-actions[bot], so the activity signal ignores it.
stub_legacy_page() {
  jq -nc \\
    --arg lb "\${GH_STUB_LEGACY_BODY:-}" \\
    --arg ls "\${GH_STUB_LEGACY_STATE:-}" \\
    --arg kd "\${GH_STUB_LEGACY_KIND:-sweep}" \\
    --arg lat "\${GH_STUB_LEGACY_STATE_AT:-2026-11-11T05:00:00Z}" \\
    --arg url "https://api.github.com/repos/o/r/issues/818" \\
    '[(if ($lb != "" and $kd != "state") then {id: 1, body: $lb, issue_url: $url, user: {login: "github-actions[bot]"}, updated_at: "2026-11-11T05:00:00Z"} else empty end),
      (if $ls != "" then {id: 2, body: ("<!-- triage-bridge:818:" + $ls + " -->"), issue_url: $url, user: {login: "github-actions[bot]"}, updated_at: $lat} else empty end)]'
}
case "$*" in
  *"search/issues"*) printf '%s\\n' "\${GH_STUB_SEARCH:-}" ;;
  # The open ready-issue list legacy_ready_issues enumerates (#1031 review).
  # It checks each number for a legacy marker, so the marker is found however
  # far back it sits in the comment history. GH_STUB_READY_PAGE2, when set, is a
  # second page (page 1 then returns a full 100 numbers, so the loop pages on).
  *"issues?state=open&labels=ready"*)
    pg=$(printf '%s' "$*" | sed -n 's#.*page=\\([0-9][0-9]*\\).*#\\1#p')
    if [ "$pg" = "2" ] && [ -n "\${GH_STUB_READY_PAGE2:-}" ]; then
      printf '%s\\n' "\${GH_STUB_READY_PAGE2}"
    elif [ -n "\${GH_STUB_READY_PAGE2:-}" ]; then
      i=1; while [ "$i" -le 100 ]; do printf '%s\\n' "$i"; i=$((i+1)); done
    else
      printf '%s\\n' "\${GH_STUB_READY_ISSUES:-818}"
    fi ;;
  *"[.state, (.labels[].name)]"*)
    [ "\${GH_STUB_READ_FAIL:-}" = state ] && exit 1
    printf '%s\\n' "\${GH_STUB_STATE_LABELS:-open bug priority:medium}" ;;
  *"select(("*) printf '%s\\n' "\${GH_STUB_NONFLEET:-}" ;;
  # The legacy-marker readers: gh api --paginate ... --jq FILTER. gh runs the
  # filter on every page and concatenates the results, so page 1 (which may hold
  # no marker) must emit nothing and the marker on page 2 must still come through
  # (#1031 review). GH_STUB_LEGACY_PAGE2, when set, is that second page.
  *"comments?per_page=100"*"--jq"*)
    f="\${*#*--jq }"
    if [ -n "\${GH_STUB_COMMENTS_JSON:-}" ]; then
      p1="\${GH_STUB_COMMENTS_JSON}"
    elif [ -n "\${GH_STUB_LEGACY_PAGE2:-}" ]; then
      p1='[]'
    else
      p1=$(stub_legacy_page)
    fi
    printf '%s' "$p1" | jq -r "$f" 2>/dev/null || true
    if [ -n "\${GH_STUB_LEGACY_PAGE2:-}" ]; then
      printf '%s' "\${GH_STUB_LEGACY_PAGE2}" | jq -r "$f" 2>/dev/null || true
    fi ;;
  # The raw comment listing, read a page at a time by --purge-markers and
  # legacy_ready_issues; the bridge filters it itself.
  *"comments?per_page=100&page="*)
    pg=$(printf '%s' "$*" | sed -n 's#.*page=\\([0-9][0-9]*\\).*#\\1#p')
    if [ "$pg" = "2" ] && [ -n "\${GH_STUB_LEGACY_PAGE2:-}" ]; then
      printf '%s\\n' "\${GH_STUB_LEGACY_PAGE2}"
    elif [ -n "\${GH_STUB_RAW_COMMENTS:-}" ]; then
      printf '%s\\n' "\${GH_STUB_RAW_COMMENTS}"
    elif [ -n "\${GH_STUB_COMMENTS_JSON:-}" ]; then
      printf '%s\\n' "\${GH_STUB_COMMENTS_JSON}"
    else
      stub_legacy_page
    fi ;;
  # issue_state (the type+priority read) matches here; GH_STUB_ISSUE_LABELS_FAIL
  # makes it fail, so a test can drive the "label read failed" path.
  *"/issues/"*"--jq .state"*)
    # The relabel mode's open/closed read (#838). Defaults to open.
    [ "\${GH_STUB_STATE_FAIL:-}" = 1 ] && exit 1
    printf '%s\\n' "\${GH_STUB_ISSUE_STATE:-open}" ;;
  *"/issues/"*"/labels"*"--jq"*)
    # remaining_labels reads the issue's label array (#838). The value is read
    # with a bare default (not a colon default) so an explicitly empty string
    # means "no labels left" — the case the fix acts on.
    printf '%s\\n' "\${GH_STUB_LABELS_LIST-bug+priority:medium}" ;;
  *"join(\\"+\\")"*)
    [ "\${GH_STUB_ISSUE_LABELS_FAIL:-}" = 1 ] && exit 1
    printf '%s\\n' "\${GH_STUB_ISSUE_LABELS:-bug+priority:medium}" ;;
  *"/comments"*".[].body"*) printf '%s\\n' "\${GH_STUB_COMMENTS:-}" ;;
  *"/issues/comments/"*"-X PATCH"*) post "$@" ;;
  *"/issues/comments/"*"-X DELETE"*) log "DELETE_MARKER" ;;
  *"/comments"*"-X POST"*) post "$@" ;;
  *"/comments"*)
    [ "\${GH_STUB_READ_FAIL:-}" = comments ] && exit 1
    if [ -n "\${GH_STUB_NONFLEET:-}" ]; then
      printf '[{"user":{"login":"%s"},"updated_at":"%s","body":%s}]\\n' \\
        "\${GH_STUB_NONFLEET_LOGIN:-reporter}" "\${GH_STUB_NONFLEET_AT:-2026-01-01T00:00:00Z}" \\
        "$(printf '%s' "$GH_STUB_NONFLEET" | jq -c -Rs .)"
    else
      printf '[]\\n'
    fi ;;
  *"/issues/"*)
    [ "\${GH_STUB_READ_FAIL:-}" = issue ] && exit 1
    # GH_STUB_BODY2, when set, is served once a dispatch has been logged — it
    # simulates an edit landing between the signal snapshot and the marker write.
    body="\${GH_STUB_BODY:-}"
    if [ -n "\${GH_STUB_BODY2:-}" ] && grep -q DISPATCH "\${CURL_STUB_LOG:-/dev/null}" 2>/dev/null; then
      body="\${GH_STUB_BODY2}"
    fi
    printf '{"body":%s}\\n' "$(printf '%s' "$body" | jq -c -Rs .)" ;;
esac
exit 0
`;

let dir: string;
let bridgeDir: string;
let log: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'fleet-guards-'));
  bridgeDir = mkdtempSync(join(tmpdir(), 'fleet-bridge-'));
  writeFileSync(join(dir, 'gh'), STUB, { mode: 0o755 });
  // The bridge talks to more endpoints than the other guards, so it gets its own
  // `gh` (as `gh`), alongside the `curl` stub it dispatches through.
  writeFileSync(join(bridgeDir, 'gh'), BRIDGE_STUB, { mode: 0o755 });
  writeFileSync(join(bridgeDir, 'curl'), CURL_STUB, { mode: 0o755 });
  log = join(dir, 'calls.log');
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(bridgeDir, { recursive: true, force: true });
});

function run(
  script: string,
  env: Record<string, unknown>,
  args: string[] = [],
  stdin?: string,
  binDir = dir
) {
  writeFileSync(log, '');
  rmSync(`${log}.n`, { force: true });
  // A fresh KV store per run, seeded from `KV_SEED` (a JSON object of
  // key -> value). The bridge keeps its checkpoints there now; a shared
  // directory would leak a checkpoint from one test into the next.
  const kvDir = mkdtempSync(join(tmpdir(), 'fleet-kv-'));
  const seed = (env as Record<string, unknown>).KV_SEED as Record<string, unknown> | undefined;
  if (seed) {
    for (const [k, v] of Object.entries(seed)) {
      writeFileSync(join(kvDir, k), typeof v === 'string' ? v : JSON.stringify(v));
    }
  }
  const r = spawnSync('sh', [script, ...args], {
    encoding: 'utf8',
    input: stdin,
    env: {
      ...process.env,
      PATH: `${binDir}:${dir}:${process.env.PATH}`,
      REPO: 'o/r',
      GH_TOKEN: 'x',
      GH_STUB_LOG: log,
      CURL_STUB_LOG: log,
      CURL_STUB_KV_DIR: kvDir,
      OPENHANDS_API_KEY: 'test-key',
      ...env,
    },
  });
  // What the store holds after the run, so a test can assert on the checkpoint
  // itself (key -> parsed value) instead of on a comment body.
  const kv: Record<string, unknown> = {};
  for (const f of readdirSync(kvDir)) {
    try {
      kv[f] = JSON.parse(readFileSync(join(kvDir, f), 'utf8'));
    } catch {
      kv[f] = readFileSync(join(kvDir, f), 'utf8');
    }
  }
  rmSync(kvDir, { recursive: true, force: true });
  return {
    status: r.status ?? -1,
    out: `${r.stdout}${r.stderr}`,
    calls: existsSync(log) ? readFileSync(log, 'utf8') : '',
    kv,
  };
}

const runBridge = (env: Record<string, unknown>, args: string[], stdin?: string) =>
  run(BRIDGE, env, args, stdin, bridgeDir);

// The repository labels the guard tests reason about, mirroring `gh label list`
// for every one a test names — `blocked` included, because it is a real label
// and the human path reads `protected_labels()`. A fixture that omits a label
// the guard consults makes that label read as "not protected", and a test built
// on it then proves the opposite of what happens in the repository.
const LABELS =
  'bug\nenhancement\ndocumentation\nrefactor\nchore\nsecurity\nready\nquestion\nblocked\npriority:high\npriority:medium\nstale\nsource:template';

const labeledEvent = (login: string, label: string, opts: { pr?: boolean } = {}) =>
  JSON.stringify({
    action: 'labeled',
    sender: { login },
    label: { name: label },
    ...(opts.pr ? { pull_request: { number: 7 } } : { issue: { number: 7, pull_request: null } }),
  });

describe('deploy-sdlc-agents.py fleet triggers', () => {
  const read = (p: string) => readFileSync(p, 'utf8');
  const hasPy = spawnSync('python3', ['--version']).status === 0;
  const script = () => read(DEPLOY);
  const block = (name: string) => {
    const s = script();
    const start = s.indexOf(`${name} = {`);
    expect(start, `${name} block`).toBeGreaterThan(-1);
    return s.slice(start, s.indexOf('\n}\n', start));
  };
  const py = (code: string) =>
    spawnSync(
      'python3',
      [
        '-c',
        [
          'import importlib.util, json, sys',
          'spec = importlib.util.spec_from_file_location("d", sys.argv[1])',
          'm = importlib.util.module_from_spec(spec)',
          'spec.loader.exec_module(m)',
          code,
        ].join('\n'),
        DEPLOY,
      ],
      { encoding: 'utf8' }
    );

  it('splits the two `question` reply owners so one comment starts one agent', () => {
    // SDLC 16 (`Penjernih issue`) and SDLC 22 (`Diskusi`) both watch a reply on
    // a `question` issue. Their filters were byte-identical, so every maintainer
    // reply ran both agents for one answer — two sandbox slots, two replies.
    // The split is by author: the reporter's reply re-judges, the maintainer's
    // reply is answered.
    const triggers = block('TRIGGERS');
    const entry = (key: string) => {
      const at = triggers.indexOf(`"${key}": {`);
      expect(at, `${key} entry`).toBeGreaterThan(-1);
      return triggers.slice(at, triggers.indexOf('},', at));
    };
    const sixteen = entry('SDLC 16');
    const twentytwo = entry('SDLC 22');
    expect(sixteen).not.toBe(twentytwo);
    // `Penjernih issue` is the reporter's, so it excludes maintainers.
    expect(sixteen).toContain("comment.author_association != 'OWNER'");
    expect(sixteen).toContain("comment.author_association != 'MEMBER'");
    expect(sixteen).toContain("comment.author_association != 'COLLABORATOR'");
    // `Diskusi` is the maintainer's.
    expect(twentytwo).toContain("comment.author_association == 'OWNER'");
    expect(twentytwo).toContain("comment.author_association == 'MEMBER'");
    expect(twentytwo).toContain("comment.author_association == 'COLLABORATOR'");
    // Both still require a `question` issue and keep the author guard.
    for (const f of [sixteen, twentytwo]) {
      expect(f).toContain("contains(issue.labels[].name, 'question')");
      expect(f).toContain('AUTHOR_GUARD');
    }
    // The split must be total: every maintainer association that SDLC 22
    // accepts, SDLC 16 rejects, so no reply matches both.
    for (const role of ['OWNER', 'MEMBER', 'COLLABORATOR']) {
      expect(sixteen).toContain(`comment.author_association != '${role}'`);
      expect(twentytwo).toContain(`comment.author_association == '${role}'`);
    }
    // A third automation also watches comments: `Bot sebutan` (SDLC 07) fires on
    // a mention, so a plain `question` reply must not reach it. If its mention
    // gate ever dropped, a maintainer reply would start three agents.
    const seven = triggers.slice(
      triggers.indexOf('"SDLC 07": {'),
      triggers.indexOf('},', triggers.indexOf('"SDLC 07": {'))
    );
    expect(seven).toContain('MENTION_FILTER');
    expect(seven).not.toContain("contains(issue.labels[].name, 'question')");
  });

  it('runs `Tiket jadi PR` on the daily cron, and sends a complete trigger', () => {
    // The 2026-11-11 rewrite dropped the `bot-implement` event trigger and left
    // `{"on": ["schedule"]}` behind — not a trigger at all. `schedule` is not a
    // GitHub event type, the discriminator only accepts `cron`/`event`, and no
    // cron slot was ever named, so the one automation that opens pull requests
    // would have gone quiet the moment it was deployed. Assert the real shape.
    const triggers = block('TRIGGERS');
    expect(triggers).toContain(
      '"SDLC 06": {"type": "cron", "schedule": "0 8 * * *", "timezone": "Asia/Jakarta"}'
    );
    // 08:00 WIB: the quota refills at 07:00, and 09:00 belongs to `Pemburu bug`.
    expect(triggers).not.toMatch(/"SDLC 06": \{"on": \["schedule"\]\}/);
    expect(triggers).not.toMatch(/\["schedule"\]/);
    // The dead label filter must not survive on the entry itself.
    const entry = triggers.slice(triggers.indexOf('"SDLC 06"'), triggers.indexOf('"SDLC 18"'));
    expect(entry).not.toContain('bot-implement');
    expect(entry).not.toContain('"filter"');
    // A cron slot must not collide with the other scheduled automations.
    expect(triggers).not.toMatch(/schedule": "0 9 \* \* \*/);
  });

  it.skipIf(!hasPy)('completes a trigger fragment against the live trigger before PATCHing', () => {
    // `PATCH {trigger}` validates the trigger as a whole and replaces it: a bare
    // `{"filter": …}` is `422 union_tag_invalid`, and merging a cron into an
    // event leaves the dead event keys behind. Every `TRIGGERS` entry but SDLC
    // 06 is a fragment, so without completion none of them could deploy.
    const r = py(
      [
        'import json',
        'event = {"on": "issue_comment.created", "type": "event", "filter": "OLD", "source": "github", "wake_agent": True, "destination": "dispatch_run", "turn_text_expr": None, "subject_key_expr": None}',
        'frag = m.target_trigger(event, {"filter": "NEW"})',
        'cron = m.target_trigger(event, {"type": "cron", "schedule": "0 8 * * *", "timezone": "Asia/Jakarta"})',
        'res = {',
        '  "fragment_keeps_kind": frag["type"] == "event" and frag["on"] == "issue_comment.created" and frag["source"] == "github",',
        '  "fragment_overrides_owned": frag["filter"] == "NEW",',
        '  "fragment_keeps_destination": frag["destination"] == "dispatch_run",',
        '  "cron_is_bare": cron == {"type": "cron", "schedule": "0 8 * * *", "timezone": "Asia/Jakarta"},',
        '  "cron_drops_event_keys": not ({"on", "filter", "source", "destination"} & set(cron)),',
        '  "idempotent": m.target_trigger(frag, {"filter": "NEW"}) == frag,',
        '}',
        'print(json.dumps(res))',
      ].join('\n')
    );
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({
      fragment_keeps_kind: true,
      fragment_overrides_owned: true,
      fragment_keeps_destination: true,
      cron_is_bare: true,
      cron_drops_event_keys: true,
      idempotent: true,
    });
  });

  it('records every disabled automation in RETIRED, so a deploy cannot leave it dark', () => {
    // `Audit Kematangan` was switched off by hand on 2026-11-10 and never listed,
    // so its monthly report simply stopped with no document naming it. The
    // deploy treats an unlisted automation as live; the list is the only thing
    // that makes a retirement visible.
    expect(block('RETIRED')).toContain('"Audit Kematangan"');
  });

  it('keeps the deleted `automation-health` label out of the fleet prompts', () => {
    // The label was dropped from the taxonomy on 2026-11-11. A prompt that still
    // tells its agent to label an issue with it produces a label-less issue.
    expect(script()).not.toContain('dan `automation-health`');
    expect(script()).not.toContain('label `automation-health`');
  });

  it('strips every deleted label from the live prompt it rewrites', () => {
    // `POST /issues/<n>/labels` CREATES a missing label, so a tail that still
    // applies `pending-maintainer` re-creates it on the repository on every run.
    // The rewrite must converge the live text, not only the blocks the script
    // authors. This is the guard for the 2026-11-11 defect: the pattern for the
    // label-ownership bullet stopped at "memasangnya." while the live bullet
    // names two more labels, so `bot-implement`/`rilis-disetujui`/
    // `rilis-ditolak` survived in all 19 live prompts.
    const r = py(
      [
        'import json',
        'DELETED = ["needs-info", "pending-maintainer", "bot-implement", "rilis-disetujui", "rilis-ditolak", "bug-hunter"]',
        'live = {',
        '  "SDLC 06 · Tiket jadi PR": "automation lain yang menemukan masalah membuka ISSUE, bukan PR, lalu `bot-implement` menyerahkannya ke `Tiket jadi PR`. Hanya `cipansor-bot` (GITHUB_BOT_TOKEN) yang boleh memasang label. Jangan pasang label apa pun lewat `GITHUB_TOKEN`. `bot-implement`, `rilis-disetujui`, `rilis-ditolak` adalah keputusan maintainer — jangan pernah memasangnya.\\nSebelum memasang `ready`, cabut dulu `question`/`needs-info`/`pending-maintainer`/`blocked` yang bertentangan.\\nPERILAKU SASARAN (level agentic)\\ntail",',
        '  "SDLC 05 · Reproduksi bug": "agar maintainer bisa menerapkan `ready` — JANGAN menerapkan `ready` atau `needs-info` sendiri; gerbang manusia tetap milik manusia.\\nPERILAKU SASARAN (level agentic)\\ntail",',
        '  "SDLC 20 · Pemindai standar": "satu prioritas, dan `pending-maintainer` (artinya: menunggu maintainer memutuskan apakah dilanjutkan — menambahkan `ready` memulai implementasi).\\nPERILAKU SASARAN (level agentic)\\ntail",',
        '}',
        'res = {}',
        'for name, prompt in live.items():',
        '    new = m.new_prompt(name, prompt)',
        '    res[name] = {lab: new.count(lab) for lab in DELETED}',
        'print(json.dumps(res))',
      ].join('\n')
    );
    expect(r.status, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout) as Record<string, Record<string, number>>;
    expect(Object.keys(out).length).toBe(3);
    for (const [name, counts] of Object.entries(out)) {
      for (const [label, n] of Object.entries(counts)) {
        expect(n, `${name} still names \`${label}\``).toBe(0);
      }
    }
    // The rewrite must not leave a dangling connector where the label list was.
    expect(out).not.toHaveProperty('SDLC 05 · Reproduksi bug.__missing__');
  });
});

describe('label-guard.sh', () => {
  it('removes a protected label applied by a person and says so once', () => {
    const { calls, out } = run(
      LABEL_GUARD,
      { GH_STUB_LABELS: LABELS, GH_STUB_PERM: 'triage' },
      ['--stdin'],
      labeledEvent('someone', 'ready')
    );
    expect(calls).toContain('UNLABEL');
    expect(calls).toContain('/issues/7/labels/ready');
    expect(calls).toContain('COMMENT');
    expect(out).toContain('Removed label');
  });

  it('reports `revoked=1` only when it removed a label, so the relabel runs once (#838)', () => {
    // `label-guard.yml` gates the bridge's `--relabel` call on this output: a run
    // that removed nothing must not wake the triage owner, or an ordinary human
    // label on an untriaged issue would dispatch a relabel every time.
    const outFile = join(dir, 'guard-output');
    const revoked = (label: string, actor: string) => {
      writeFileSync(outFile, '');
      run(
        LABEL_GUARD,
        { GH_STUB_LABELS: LABELS, GH_STUB_PERM: 'triage', GITHUB_OUTPUT: outFile },
        ['--stdin'],
        labeledEvent(actor, label)
      );
      return readFileSync(outFile, 'utf8');
    };
    expect(revoked('ready', 'someone')).toContain('revoked=1');
    // The bot's own label is left in place — nothing revoked.
    expect(revoked('ready', 'cipansor-bot')).not.toContain('revoked=1');
  });

  it('points a collaborator at @cipansor-bot and claims no human-decision label', () => {
    // "Sebutkan apa yang Anda inginkan" named no channel, and `bot-implement`
    // was removed on 2026-11-11, so the old tail was both vague and false.
    const { calls } = run(
      LABEL_GUARD,
      { GH_STUB_LABELS: LABELS, GH_STUB_PERM: 'write' },
      ['--stdin'],
      labeledEvent('someone', 'ready')
    );
    expect(calls).toContain('@cipansor-bot');
    expect(calls).not.toContain('keputusan manusia');
  });

  it('keeps a triage collaborator on the mention path', () => {
    // `triage` is the permission a person needs to apply a label at all, and a
    // triage collaborator still satisfies `COLLABORATOR` in `MENTION_FILTER`, so
    // the notice must not divert them to the maintainer. Regression: the first
    // version treated every permission outside admin/maintain/write as an
    // outsider, so a triage collaborator was told the bot would not answer them.
    // `permission: read` with `role_name: triage` is the case that forces the
    // script to read *both* fields: a triage collaborator whose coarse
    // permission reads like an outsider's must still reach the mention path.
    for (const perm of [
      { GH_STUB_PERM: 'triage' },
      { GH_STUB_PERM: 'read', GH_STUB_ROLE: 'triage' },
    ]) {
      const { calls } = run(
        LABEL_GUARD,
        { GH_STUB_LABELS: LABELS, ...perm },
        ['--stdin'],
        labeledEvent('triager', 'ready')
      );
      expect(calls, JSON.stringify(perm)).toContain('COMMENT');
      expect(calls, JSON.stringify(perm)).toContain('@cipansor-bot');
      expect(calls, JSON.stringify(perm)).not.toContain('maintainer');
    }
  });

  it('sends an outside reporter to the maintainer, not to a mention that is filtered out', () => {
    // `Bot sebutan` (SDLC 07) only forwards a mention from an
    // OWNER/MEMBER/COLLABORATOR, so telling a non-collaborator to mention the
    // bot sends them to a door that never opens. An unrelated public account
    // reads as `read`, not `none`.
    for (const perm of ['read', 'none']) {
      const { calls } = run(
        LABEL_GUARD,
        { GH_STUB_LABELS: LABELS, GH_STUB_PERM: perm },
        ['--stdin'],
        labeledEvent('outsider', 'ready')
      );
      expect(calls, perm).toContain('COMMENT');
      expect(calls, perm).toContain('maintainer');
      expect(calls, perm).not.toContain('@cipansor-bot');
    }
  });

  it('leaves a label the bot applied', () => {
    const { calls } = run(
      LABEL_GUARD,
      { GH_STUB_LABELS: LABELS },
      ['--stdin'],
      labeledEvent('cipansor-bot', 'ready')
    );
    expect(calls).not.toContain('UNLABEL');
    expect(calls).not.toContain('COMMENT');
  });

  it('leaves a label a GitHub App applied', () => {
    const { calls } = run(
      LABEL_GUARD,
      { GH_STUB_LABELS: LABELS },
      ['--stdin'],
      labeledEvent('github-actions[bot]', 'ready')
    );
    expect(calls).not.toContain('UNLABEL');
  });

  it('has no human-decision label left: every one of them is revoked', () => {
    // `bot-implement` was the last exception and was removed on 2026-11-11 (the
    // fleet implements from `ready` now). `rilis-disetujui`/`rilis-ditolak` were
    // dropped 2026-11-09. A person applying any label is revoked; only the bot
    // and a GitHub App may label.
    const { calls } = run(
      LABEL_GUARD,
      { GH_STUB_LABELS: LABELS, GH_STUB_PERM: 'admin' },
      ['--stdin'],
      labeledEvent('adminypc', 'ready')
    );
    expect(calls).toContain('UNLABEL');
  });

  it('leaves the issue template’s type label, applied when the issue opens', () => {
    // #842: each issue form sets its own type label the moment an issue is
    // created (one form per type, 2026-11-11), so revoking it fights the
    // template and posts a notice on every new issue. The type label is the
    // reporter's declared intent; the triage owner sets the correct one on top.
    for (const label of ['bug', 'enhancement', 'documentation', 'refactor', 'chore', 'security']) {
      const { calls, out } = run(
        LABEL_GUARD,
        { GH_STUB_LABELS: LABELS },
        ['--stdin'],
        labeledEvent('adminypc', label)
      );
      expect(calls, label).not.toContain('UNLABEL');
      expect(calls, label).not.toContain('COMMENT');
      expect(out, label).toContain('not a protected label');
    }
  });

  it('revokes a template type label applied to a pull request', () => {
    // The template exemption is for issues: a PR has no issue form, and
    // `issue-label-sync.sh` reads a PR's type as a claim to match the linked
    // issue — a manually applied `bug` on an `enhancement` PR fails that check.
    // So on a PR the type label is protected and revoked.
    const { calls, out } = run(
      LABEL_GUARD,
      { GH_STUB_LABELS: LABELS, GH_STUB_PERM: 'admin' },
      ['--stdin'],
      labeledEvent('adminypc', 'bug', { pr: true })
    );
    expect(calls).toContain('/issues/7/labels/bug');
    expect(out).toContain('Removed label');
  });

  it('leaves a label that is not in the repository', () => {
    const { calls } = run(
      LABEL_GUARD,
      { GH_STUB_LABELS: LABELS },
      ['--stdin'],
      labeledEvent('someone', 'made-up-label')
    );
    expect(calls).not.toContain('UNLABEL');
  });

  it('works on a pull request, whose number is its issue number', () => {
    const { calls } = run(
      LABEL_GUARD,
      { GH_STUB_LABELS: LABELS },
      ['--stdin'],
      labeledEvent('someone', 'priority:high', { pr: true })
    );
    expect(calls).toContain('/issues/7/labels/priority:high');
  });

  it('does not stack a second notice', () => {
    const { calls } = run(
      LABEL_GUARD,
      { GH_STUB_LABELS: LABELS, GH_STUB_COMMENTS: `Label dicabut <!-- label-guard:revoked -->` },
      ['--stdin'],
      labeledEvent('someone', 'ready')
    );
    expect(calls).toContain('UNLABEL');
    expect(calls).not.toContain('COMMENT');
  });

  it('does nothing when the label is removed, not added', () => {
    const ev = JSON.stringify({
      action: 'unlabeled',
      sender: { login: 'someone' },
      label: { name: 'ready' },
      issue: { number: 7 },
    });
    const { calls } = run(LABEL_GUARD, { GH_STUB_LABELS: LABELS }, ['--stdin'], ev);
    expect(calls).not.toContain('UNLABEL');
  });

  it('removes a `ready` that contradicts an open question, even from the bot', () => {
    const { calls, out } = run(
      LABEL_GUARD,
      { GH_STUB_LABELS: LABELS, GH_STUB_CURRENT: 'ready\nquestion\nbug' },
      ['--stdin'],
      labeledEvent('cipansor-bot', 'ready')
    );
    expect(calls).toContain('/issues/7/labels/ready');
    expect(calls).toContain('COMMENT');
    expect(out).toContain("contradicts 'question'");
  });

  it('removes a `ready` that contradicts `question`', () => {
    // `needs-info` was removed on 2026-11-11; `question` is the one "still being
    // discussed" label, and it still wins over `ready`.
    const { calls } = run(
      LABEL_GUARD,
      { GH_STUB_LABELS: LABELS, GH_STUB_CURRENT: 'ready\nquestion' },
      ['--stdin'],
      labeledEvent('cipansor-bot', 'ready')
    );
    expect(calls).toContain('/issues/7/labels/ready');
  });

  it('removes a `ready` that contradicts `blocked`, even from the bot', () => {
    const { calls, out } = run(
      LABEL_GUARD,
      { GH_STUB_LABELS: LABELS, GH_STUB_CURRENT: 'ready\nblocked\nbug' },
      ['--stdin'],
      labeledEvent('cipansor-bot', 'ready')
    );
    expect(calls).toContain('/issues/7/labels/ready');
    expect(calls).toContain('COMMENT');
    expect(out).toContain("contradicts 'blocked'");
  });

  it('keeps `blocked` when it wins over a conflicting `ready`', () => {
    const { calls } = run(
      LABEL_GUARD,
      { GH_STUB_LABELS: LABELS, GH_STUB_CURRENT: 'ready\nblocked' },
      ['--stdin'],
      labeledEvent('cipansor-bot', 'blocked')
    );
    expect(calls).toContain('/issues/7/labels/ready');
    expect(calls).not.toContain('/issues/7/labels/blocked');
  });

  it('revokes a person’s `blocked` and leaves the bot’s `ready` — so the fixture must list it', () => {
    // A person applying `blocked` takes the standard path, not the conflict
    // path: `blocked` is a real repository label, so it is protected and revoked
    // like any other, and the bot's `ready` stands. The fixture omission was not
    // cosmetic — with `blocked` missing from `LABELS` the guard reads it as "not
    // protected", leaves it in place, and then withdraws `ready` as the conflict:
    // the opposite of what the repository does.
    const { calls, out } = run(
      LABEL_GUARD,
      {
        GH_STUB_LABELS: LABELS,
        GH_STUB_PERM: 'admin',
        GH_STUB_CURRENT: 'ready\nblocked',
      },
      ['--stdin'],
      labeledEvent('adminypc', 'blocked')
    );
    expect(calls).toContain('/issues/7/labels/blocked');
    expect(calls).not.toContain('/issues/7/labels/ready');
    expect(out).toContain("Removed label 'blocked'");
  });

  it('leaves `ready` alone when nothing contradicts it', () => {
    const { calls } = run(
      LABEL_GUARD,
      { GH_STUB_LABELS: LABELS, GH_STUB_CURRENT: 'ready\nbug\npriority:high' },
      ['--stdin'],
      labeledEvent('cipansor-bot', 'ready')
    );
    expect(calls).not.toContain('UNLABEL');
  });

  it('revokes the human-applied exclusion and keeps the legitimate `ready`', () => {
    const { calls } = run(
      LABEL_GUARD,
      { GH_STUB_LABELS: LABELS, GH_STUB_PERM: 'admin', GH_STUB_CURRENT: 'ready\nquestion' },
      ['--stdin'],
      labeledEvent('adminypc', 'question')
    );
    // `question` (the event label) is revoked; `ready` is left in place.
    expect(calls).toContain('/issues/7/labels/question');
    expect(calls).not.toContain('/issues/7/labels/ready');
  });

  it('removes `ready` and still revokes a human label added during the conflict', () => {
    // The reviewer's scenario: with `ready`+`question` present, a person adds
    // `priority:high`. Removing `ready` must not swallow the standard path's
    // revocation of that protected label.
    const { calls } = run(
      LABEL_GUARD,
      {
        GH_STUB_LABELS: LABELS,
        GH_STUB_PERM: 'triage',
        GH_STUB_CURRENT: 'ready\nquestion',
      },
      ['--stdin'],
      labeledEvent('someone', 'priority:high')
    );
    expect(calls).toContain('/issues/7/labels/ready');
    expect(calls).toContain('/issues/7/labels/priority:high');
  });

  it('removes `ready` when a second exclusion survives the event label', () => {
    // The reviewer's scenario: `ready`+`blocked` present, a human adds
    // `question`. Revoking `question` does not clear `blocked`, so the issue
    // stays contradictory — `ready` must go too.
    const { calls } = run(
      LABEL_GUARD,
      {
        GH_STUB_LABELS: LABELS,
        GH_STUB_PERM: 'admin',
        GH_STUB_CURRENT: 'ready\nquestion\nblocked',
      },
      ['--stdin'],
      labeledEvent('adminypc', 'question')
    );
    expect(calls).toContain('/issues/7/labels/ready');
    expect(calls).toContain('/issues/7/labels/question');
  });

  it('removes `ready` when a conflict exists and the event label is unrelated', () => {
    const { calls } = run(
      LABEL_GUARD,
      { GH_STUB_LABELS: LABELS, GH_STUB_CURRENT: 'ready\nquestion' },
      ['--stdin'],
      labeledEvent('cipansor-bot', 'priority:high')
    );
    expect(calls).toContain('/issues/7/labels/ready');
  });
});

describe('reaction.sh', () => {
  it('reacts eyes on the issue and replaces the earlier reaction', () => {
    const { calls } = run(
      REACTION,
      { GH_STUB_LOGIN: 'cipansor-bot', GH_STUB_REACTIONS: '123 eyes' },
      ['7']
    );
    expect(calls).toContain('UNREACT');
    expect(calls).toContain('/reactions/123');
    expect(calls).toContain('REACT_ISSUE');
  });

  it('reacts on a comment when given its id', () => {
    const { calls } = run(REACTION, { GH_STUB_LOGIN: 'cipansor-bot' }, ['7', '555']);
    expect(calls).toContain('REACT_COMMENT');
    expect(calls).toContain('/issues/comments/555/reactions');
  });
});

describe('acknowledge.sh', () => {
  const event = (opts: {
    association?: string;
    labels?: string[];
    body?: string;
    login?: string;
    type?: string;
  }) =>
    JSON.stringify({
      action: 'created',
      comment: {
        id: 555,
        body: opts.body ?? 'A reply',
        author_association: opts.association ?? 'NONE',
        user: { login: opts.login ?? 'reporter', type: opts.type ?? 'User' },
      },
      issue: { number: 7, labels: (opts.labels ?? []).map((name) => ({ name })) },
    });

  it('acknowledges an @cipansor-bot mention', () => {
    const { calls } = run(
      ACKNOWLEDGE,
      { GH_STUB_LOGIN: 'cipansor-bot' },
      ['--stdin'],
      event({ association: 'OWNER', body: '@cipansor-bot please look' })
    );
    expect(calls).toContain('REACT_COMMENT');
  });

  it('does not acknowledge an outsider’s @cipansor-bot mention', () => {
    // `Bot sebutan` is maintainer-triggered; a stray mention starts nothing.
    const { calls } = run(
      ACKNOWLEDGE,
      { GH_STUB_LOGIN: 'cipansor-bot' },
      ['--stdin'],
      event({ association: 'NONE', body: '@cipansor-bot please look' })
    );
    expect(calls).not.toContain('REACT_COMMENT');
  });

  it('does not acknowledge an @openhands mention', () => {
    // `@openhands` wakes the OpenHands GitHub App, not the fleet; the fleet's
    // summon is `@cipansor-bot`, so an `@openhands` comment is not acknowledged.
    const { calls } = run(
      ACKNOWLEDGE,
      { GH_STUB_LOGIN: 'cipansor-bot' },
      ['--stdin'],
      event({ association: 'OWNER', body: '@openhands please look' })
    );
    expect(calls).not.toContain('REACT_COMMENT');
  });

  it('acknowledges a maintainer answering a `question` issue', () => {
    // Diskusi fires on a maintainer's reply, so it must be acknowledged.
    const { calls } = run(
      ACKNOWLEDGE,
      { GH_STUB_LOGIN: 'cipansor-bot' },
      ['--stdin'],
      event({ association: 'OWNER', labels: ['question'] })
    );
    expect(calls).toContain('REACT_COMMENT');
  });

  it('does not acknowledge an outsider on a `question` issue', () => {
    const { calls } = run(
      ACKNOWLEDGE,
      { GH_STUB_LOGIN: 'cipansor-bot' },
      ['--stdin'],
      event({ association: 'NONE', labels: ['question'] })
    );
    expect(calls).not.toContain('REACT_COMMENT');
  });

  it("never acknowledges the bot's own comment, by author", () => {
    // The guard is the author, not a footer: the bot's comment carries no
    // AI-disclosure footer any more, and it is still not acknowledged.
    const { calls } = run(
      ACKNOWLEDGE,
      { GH_STUB_LOGIN: 'cipansor-bot' },
      ['--stdin'],
      event({
        association: 'COLLABORATOR',
        labels: ['question'],
        login: 'cipansor-bot',
        body: 'Triase selesai.',
      })
    );
    expect(calls).not.toContain('REACT_COMMENT');
  });

  it('does not acknowledge an ordinary comment', () => {
    const { calls } = run(
      ACKNOWLEDGE,
      { GH_STUB_LOGIN: 'cipansor-bot' },
      ['--stdin'],
      event({ association: 'OWNER', labels: ['bug'] })
    );
    expect(calls).not.toContain('REACT_COMMENT');
  });

  it('does not acknowledge a comment authored by a bot account', () => {
    // The cloud filter that wakes the comment-triggered automations rejects a
    // `Bot` author, so reacting here would show 👀 on a comment the fleet never
    // answers — the fleet's own comment-triggered loop (#680) and this guard
    // must agree on the author.
    const { calls, out } = run(
      ACKNOWLEDGE,
      { GH_STUB_LOGIN: 'cipansor-bot' },
      ['--stdin'],
      event({
        association: 'OWNER',
        body: '@cipansor-bot please look',
        login: 'some-app[bot]',
        type: 'Bot',
      })
    );
    expect(calls).not.toContain('REACT_COMMENT');
    expect(out).toContain('bot account');
  });
});

describe('issue-triage-bridge.sh --recover-ready', () => {
  const signal = (body: string, nonfleet = '') => {
    const line1 = JSON.stringify({ body });
    const line2 = nonfleet
      ? JSON.stringify([{ login: 'reporter', updated: '2026-01-01T00:00:00Z', body: nonfleet }])
      : '[]';
    return createHash('sha256').update(`${line1}\n${line2}\n`).digest('hex').slice(0, 16);
  };

  it('recovers a deferred label dispatch on a ready issue, which the sweep skips', () => {
    // R348: `on_label` defers on an issue that is (or becomes) `ready`; the sweep
    // searches `-label:ready`, so a pending checkpoint there is never retried.
    // The recovery pass acts on it.
    const { calls, out, kv } = runBridge(
      {
        KV_SEED: { 'triage-sweep-818': { signal: signal('edited'), run: 'pending' } },
        GH_STUB_STATE_LABELS: 'open bug ready priority:high',
        GH_STUB_BODY: 'edited',
      },
      ['--recover-ready']
    );
    expect(calls).toContain('DISPATCH');
    expect(kv['triage-sweep-818']).toEqual({ signal: signal('edited'), run: 'run-1' });
    expect(out).toContain('recovered on ready issues');
  });

  it('recovers a pending checkpoint even when its issue is outside the search window', () => {
    // R475: the recovery must find a checkpoint by listing the store, not a
    // `ready`-issue search bounded by update time — else an old pending
    // checkpoint is forgotten once newer `ready` issues fill the page window.
    const { calls, out } = runBridge(
      {
        KV_SEED: { 'triage-sweep-99': { signal: signal('old'), run: 'pending' } },
        GH_STUB_STATE_LABELS: 'open bug ready',
        GH_STUB_BODY: 'old',
      },
      ['--recover-ready']
    );
    expect(calls).toContain('DISPATCH');
    expect(out).toContain('recovered on ready issues');
  });

  it('retries a failed recovery run on a ready issue, which the sweep skips', () => {
    // R474: a recovered dispatch turns the checkpoint from `pending` into a run
    // id; if that run fails, only the recovery pass can retry it (the sweep
    // skips `ready`).
    const { calls, kv } = runBridge(
      {
        KV_SEED: { 'triage-sweep-818': { signal: signal('edited'), run: 'r1' } },
        GH_STUB_STATE_LABELS: 'open bug ready',
        GH_STUB_BODY: 'edited',
        CURL_STUB_RUNS: '{"runs":[{"id":"r1","status":"FAILED"}]}',
      },
      ['--recover-ready']
    );
    expect(calls).toContain('RUNS');
    expect(calls).toContain('DISPATCH');
    expect(kv['triage-sweep-818']).toEqual({ signal: signal('edited'), run: 'run-1' });
  });

  it('finalises a completed recovery run on a ready issue without re-dispatching', () => {
    const { calls, kv } = runBridge(
      {
        KV_SEED: { 'triage-sweep-818': { signal: signal('edited'), run: 'r1' } },
        GH_STUB_STATE_LABELS: 'open bug ready',
        GH_STUB_BODY: 'edited',
        CURL_STUB_RUNS: '{"runs":[{"id":"r1","status":"COMPLETED"}]}',
      },
      ['--recover-ready']
    );
    expect(calls).toContain('RUNS');
    expect(calls).not.toContain('DISPATCH');
    expect(kv['triage-sweep-818']).toEqual({ signal: signal('edited'), run: '' });
  });

  it('does not re-triage a ready issue already finalised when a comment changes it', () => {
    // R496: a new comment on a `ready` issue changes the signal; the checkpoint
    // is final, so the recovery must not dispatch again.
    const { calls } = runBridge(
      {
        KV_SEED: { 'triage-sweep-818': { signal: signal('A'), run: '' } },
        GH_STUB_STATE_LABELS: 'open bug ready',
        GH_STUB_BODY: 'B',
      },
      ['--recover-ready']
    );
    expect(calls).not.toContain('DISPATCH');
  });

  it('drops the checkpoint of a closed issue instead of dispatching it', () => {
    // A checkpoint outlives the issue: if the issue closed, the recovery must
    // clear it rather than dispatch a triage run for a closed issue.
    const { calls, kv } = runBridge(
      {
        KV_SEED: { 'triage-sweep-818': { signal: signal('edited'), run: 'pending' } },
        GH_STUB_STATE_LABELS: 'closed bug',
      },
      ['--recover-ready']
    );
    expect(calls).not.toContain('DISPATCH');
    expect(kv['triage-sweep-818']).toBeUndefined();
  });

  it('fails the recovery step when a dispatch is rejected, so it is visible', () => {
    // R481: a rejected dispatch must not leave the workflow green; the exit
    // status (not only the message) proves it.
    const { calls, out, status } = runBridge(
      {
        KV_SEED: { 'triage-sweep-818': { signal: signal('edited'), run: 'pending' } },
        GH_STUB_STATE_LABELS: 'open bug ready',
        GH_STUB_BODY: 'edited',
        CURL_STUB_CODE: '503',
      },
      ['--recover-ready']
    );
    expect(calls).toContain('DISPATCH');
    expect(out).toContain('recovery dispatch(es) failed');
    expect(status).not.toBe(0);
  });

  it('leaves a ready issue with no checkpoint untouched in the recovery pass', () => {
    const { calls } = runBridge({ GH_STUB_STATE_LABELS: 'open bug ready' }, ['--recover-ready']);
    expect(calls).not.toContain('DISPATCH');
  });
});

describe('basmalah.sh', () => {
  const ARABIC = 'بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ';

  it('prepends the basmalah when the description does not open with it', () => {
    const ev = JSON.stringify({ action: 'opened', issue: { number: 7 } });
    const { calls } = run(BASMALAH, { GH_STUB_BODY: 'A plain report' }, ['--stdin'], ev);
    expect(calls).toContain('PATCH');
  });

  it('is idempotent when the description already opens with the basmalah', () => {
    const ev = JSON.stringify({ action: 'opened', issue: { number: 7 } });
    const { calls } = run(
      BASMALAH,
      { GH_STUB_BODY: `${ARABIC}\n\nA plain report` },
      ['--stdin'],
      ev
    );
    expect(calls).not.toContain('PATCH');
  });

  it('does not stack a second basmalah below the PR template’s leading comment', () => {
    // The pull-request template opens with a multi-line `<!-- … -->` note, so the
    // basmalah is the first line *after* it. A check that only looked at the first
    // non-blank line saw the comment, thought there was no basmalah, and prepended
    // a second copy on every templated PR (review gate, PR #817).
    const ev = JSON.stringify({ action: 'opened', pull_request: { number: 7 } });
    const body = `<!-- Biarkan PR ini draft sampai siap ditinjau. -->

${ARABIC}

## Mengapa`;
    const { calls } = run(BASMALAH, { GH_STUB_BODY: body }, ['--stdin'], ev);
    expect(calls).not.toContain('PATCH');
  });

  it('still prepends when a leading comment is present but no basmalah follows', () => {
    const ev = JSON.stringify({ action: 'opened', issue: { number: 7 } });
    const body = `<!-- a note -->\n\n## Ringkasan\nsomething`;
    const { calls } = run(BASMALAH, { GH_STUB_BODY: body }, ['--stdin'], ev);
    expect(calls).toContain('PATCH');
  });

  it('does nothing on a non-open event', () => {
    const ev = JSON.stringify({ action: 'labeled', issue: { number: 7 } });
    const { calls } = run(BASMALAH, { GH_STUB_BODY: 'x' }, ['--stdin'], ev);
    expect(calls).not.toContain('PATCH');
  });

  it('reads the number from a pull_request_target payload too', () => {
    const ev = JSON.stringify({ action: 'opened', pull_request: { number: 7 } });
    const { calls } = run(BASMALAH, { GH_STUB_BODY: 'A plain description' }, ['--stdin'], ev);
    expect(calls).toContain('/issues/7');
    expect(calls).toContain('PATCH');
  });

  it('prepends to the fresh body when a summary landed mid-run', () => {
    // A `<!-- sdlc:… -->` summary written between the first read and the PATCH
    // must survive: the basmalah goes onto the fresh body, not the stale one.
    const ev = JSON.stringify({ action: 'opened', issue: { number: 7 } });
    const { calls } = run(
      BASMALAH,
      {
        GH_STUB_BODY: 'A plain report',
        GH_STUB_BODY2: 'A plain report\n\n<!-- sdlc:triase -->\nsummary',
      },
      ['--stdin'],
      ev
    );
    expect(calls).toContain('PATCH');
    // The PATCH body is the fresh one (its summary is included).
    expect(calls).toContain('sdlc:triase');
  });

  it('does nothing when the fresh read already opens with the basmalah', () => {
    const ev = JSON.stringify({ action: 'opened', issue: { number: 7 } });
    const { calls } = run(
      BASMALAH,
      { GH_STUB_BODY: 'A plain report', GH_STUB_BODY2: `${ARABIC}\n\nA plain report` },
      ['--stdin'],
      ev
    );
    expect(calls).not.toContain('PATCH');
  });
});

describe('fleet contracts', () => {
  const read = (p: string) => readFileSync(p, 'utf8');

  it('gets the basmalah into every main description, by template or workflow', () => {
    const arabic = 'بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ';
    // The PR template carries it into the body: it sits in the preamble, before
    // the first `## ` section (the template opens with an HTML comment, which
    // renders as nothing).
    const pr = read(join(REPO_ROOT, '.github', 'pull_request_template.md'));
    const at = pr.indexOf(arabic);
    expect(at, 'basmalah present in the PR template').toBeGreaterThanOrEqual(0);
    expect(at, 'basmalah in the preamble, before the first section').toBeLessThan(
      pr.indexOf('\n## ')
    );

    // An issue form cannot carry it: a form's `markdown` block is preview only,
    // so the line never lands in the body — the `Basmalah` workflow is what puts
    // it there. The form only *shows* it, so the guard is that the workflow
    // covers an issue opening, not that the form carries the line.
    const wf = read(join(WORKFLOWS, 'basmalah.yml'));
    expect(wf).toMatch(/issues:[\s\S]*types:[\s\S]*opened/);
    for (const file of [
      'bug_report.yml',
      'enhancement.yml',
      'documentation.yml',
      'refactor.yml',
      'chore.yml',
      'security.yml',
    ]) {
      const form = read(join(REPO_ROOT, '.github', 'ISSUE_TEMPLATE', file));
      expect(form, `${file} shows the basmalah as a form prompt`).toContain(arabic);
      // It must sit in a `type: markdown` block (a preview), never in a field
      // that would land in the body — otherwise "carried" would be false.
      const before = form.slice(0, form.indexOf(arabic));
      const lastType = [...before.matchAll(/type:\s*(\S+)/g)].pop();
      expect(lastType?.[1], `${file} basmalah block type`).toBe('markdown');
    }
  });

  it('uses only element types GitHub accepts in an issue form', () => {
    // GitHub's form schema allows exactly these; an unknown `type` makes GitHub
    // refuse the whole form, not hide the field — the bug path would vanish
    // silently. Pinned so a typo or an invented element (`upload2`, `file`, …)
    // fails here instead of in the New-issue picker. Source:
    // docs.github.com "Syntax for GitHub's form schema" (`type` key).
    const ALLOWED = new Set(['markdown', 'textarea', 'input', 'dropdown', 'checkboxes', 'upload']);
    for (const file of [
      'bug_report.yml',
      'enhancement.yml',
      'documentation.yml',
      'refactor.yml',
      'chore.yml',
      'security.yml',
      'config.yml',
    ]) {
      const form = read(join(REPO_ROOT, '.github', 'ISSUE_TEMPLATE', file));
      for (const m of form.matchAll(/^\s*-?\s*type:\s*(\S+)/gm)) {
        expect(ALLOWED.has(m[1]), `${file}: unsupported form element type "${m[1]}"`).toBe(true);
      }
    }
  });

  it('wires the label guard, acknowledgement and basmalah into workflows', () => {
    expect(read(join(WORKFLOWS, 'label-guard.yml'))).toContain('label-guard.sh');
    expect(read(join(WORKFLOWS, 'acknowledge.yml'))).toContain('acknowledge.sh');
    expect(read(join(WORKFLOWS, 'basmalah.yml'))).toContain('basmalah.sh');
  });

  it('has the label guard read the whole event, not a truncated one', () => {
    expect(read(join(WORKFLOWS, 'label-guard.yml'))).toContain('"$GITHUB_EVENT_PATH"');
  });

  it('keeps no AI-disclosure footer in the label-guard notice', () => {
    // The anti-loop guard is the author (`cipansor-bot`), not a footer; the
    // notice carries none.
    expect(read(LABEL_GUARD)).not.toContain(AI_FOOTER);
  });

  it('wires the triage bridge into a workflow that fires on labels and a sweep', () => {
    const wf = read(join(WORKFLOWS, 'issue-triage-bridge.yml'));
    expect(wf).toContain('issue-triage-bridge.sh');
    expect(wf).toMatch(/issues:[\s\S]*types:[\s\S]*labeled/);
    expect(wf).toMatch(/schedule:/);
    expect(wf).toContain('--sweep');
  });

  it('calls the triage bridge from `label-guard.yml` so a revocation is relabelled (#838)', () => {
    // The guard removes a protected label and applies nothing in its place, so
    // the issue can be left with no type or no priority. It cannot trigger the
    // bridge through GitHub — the removal is made with the automatic
    // `GITHUB_TOKEN`, and GitHub starts no workflow run for an event that token
    // creates — so `label-guard.yml` invokes the bridge's `--relabel` mode in the
    // same run, gated on the guard having actually removed a label.
    const wf = read(join(WORKFLOWS, 'label-guard.yml'));
    expect(wf).toContain('issue-triage-bridge.sh --relabel');
    expect(wf).toMatch(/steps\.guard\.outputs\.revoked == '1'/);
    expect(wf).toContain('OPENHANDS_API_KEY');
  });

  it('keeps the triage bridge from writing any comment, checkpointing in the KV store', () => {
    // An HTML-only marker comment renders as an *empty* comment: it notifies
    // every subscriber and leaves an unreadable husk (2026-11-11: 153 of them,
    // 81 sweep + 72 state). The bridge must not create or edit a comment on any
    // path — it checkpoints in the automation KV store instead, the one
    // the automation KV store already uses. A future edit that reintroduces a
    // comment write fails here.
    const sh = read(BRIDGE);
    expect(sh).toContain('/kv/');
    expect(sh).toContain('triage-sweep-');
    // No comment POST/PATCH: the only `/comments` writes left are DELETEs, which
    // remove a legacy marker comment after adopting it.
    expect(sh).not.toMatch(/issues\/[^\s"']*\/comments"?\s+-X\s+(POST|PATCH)/);
    expect(sh).not.toMatch(/comments\?per_page=100"\s+-X\s+(POST|PATCH)/);
    expect(sh).toContain('-X DELETE');
    // The cleanup of the 153 legacy marker comments must stay reachable, or the
    // empty comments already on the issues would never be removed.
    expect(read(join(WORKFLOWS, 'issue-triage-bridge.yml'))).toContain('--purge-markers');
  });

  it('keeps the triage bridge issues-only and off the edited event', () => {
    // The bridge answers issue activity, never a pull request; and it hooks
    // `issues.labeled` and a sweep, not `issues.edited` (an edited event would
    // also fire on basmalah.yml's and issue-label-sync.yml's own body PATCHes,
    // as `github-actions[bot]`). A PR description edit needs no automation: the
    // review gate already reads the description, the linked issue, the diff and
    // every comment. Inspect the `on:` block — the file's own comment names the
    // events it deliberately avoids.
    const wf = read(join(WORKFLOWS, 'issue-triage-bridge.yml'));
    const onBlock = wf.slice(wf.indexOf('\non:'), wf.indexOf('\njobs:'));
    expect(onBlock).toContain('labeled');
    expect(onBlock).not.toContain('pull_request');
    expect(onBlock).not.toContain('edited');
  });

  it('states in docs/SDLC-FLOW.md that a PR description edit is not auto-answered', () => {
    const flow = read(join(REPO_ROOT, 'docs', 'SDLC-FLOW.md'));
    expect(flow).toMatch(/deskripsi PR/);
    expect(flow).toMatch(/tidak ditanggapi otomatis|tidak ada pemicu/);
  });

  it('states the evidence-backed priority rubric in docs/LABELS.md', () => {
    const labels = read(join(REPO_ROOT, 'docs', 'LABELS.md'));
    expect(labels).toContain('priority:critical');
    expect(labels).toContain('layanan mati total');
    expect(labels).toContain('kehilangan/korupsi data');
    expect(labels).toContain('UU PDP');
    expect(labels).toContain('at most `medium`');
    expect(labels).toContain('Never inflate `critical`');
  });

  it('states the comment-first rule for issues in docs/SDLC-FLOW.md', () => {
    const flow = read(join(REPO_ROOT, 'docs', 'SDLC-FLOW.md'));
    expect(flow).toContain('komentar');
    expect(flow).toMatch(/komentar dulu|Komentar dulu/);
    expect(flow).toContain('`ready`');
  });

  it('removes the estimate step from the single triage owner (SDLC 15)', () => {
    // 2026-11-09 (user decision): `Estimasi usaha` (SDLC 02) was folded into
    // `Triase issue` (SDLC 15). 2026-11-11 (user decision): the estimate itself
    // is dropped — the work is done by an AI, so a size/calibration estimate is
    // noise the reader has to scroll past. The step is removed from the prompt,
    // not merely retired, so no automation asks for it again.
    const script = read(join(REPO_ROOT, 'scripts', 'deploy-sdlc-agents.py'));
    // `TAILS` is a dict (`\n}\n`), `DROPPED_STEP_TEXTS` a tuple (`\n)\n`).
    const block = (name: string) => {
      const start =
        script.indexOf(`${name} = {`) >= 0
          ? script.indexOf(`${name} = {`)
          : script.indexOf(`${name} = (`);
      expect(start, `${name} block`).toBeGreaterThan(-1);
      const dict = script.indexOf('\n}\n', start);
      const tuple = script.indexOf('\n)\n', start);
      const end = dict >= 0 && (tuple < 0 || dict < tuple) ? dict : tuple;
      return script.slice(start, end);
    };
    // The retired automation stays retired.
    expect(script).toMatch(/RETIRED\s*=\s*\{/);
    expect(script).toMatch(/"SDLC 02":/);
    expect(script).toContain('apply_retire');
    // Its old managed tail is gone: no `"SDLC 02": """PERILAKU SASARAN` entry.
    expect(script).not.toMatch(/"SDLC 02":\s*"""PERILAKU SASARAN/);
    // The estimate instruction no longer lives inside SDLC 15's tail either.
    const tails = block('TAILS');
    expect(tails).not.toMatch(/ESTIMASI USAHA/);
    expect(tails).not.toContain('JANGAN menulis komentar kedua untuk estimasi');
    expect(tails).not.toContain('- Estimasi usaha');
    expect(tails).not.toContain('sdlc:estimasi');
    expect(tails).not.toMatch(/lihat bagian di bawah/);
    // A live prompt is converged by a substitution, so the step cannot survive
    // a redeploy of an already-deployed prompt.
    const dropped = block('DROPPED_STEP_TEXTS');
    expect(dropped).toContain('triase, estimasi, kriteria');
    expect(script).toContain('for old, new in DROPPED_STEP_TEXTS');
  });

  it('folds Triase bug into the single triage owner (SDLC 01 -> SDLC 15)', () => {
    // 2026-11-09 (user decision): `Triase bug` (SDLC 01) was folded into
    // `Triase issue` (SDLC 15). Both fired on `issues.opened` and both wrote a
    // triage comment, which is the "Triase ganda" defect (#848). SDLC 01's
    // deeper criticality pass now lives in SDLC 15's tail; the bridge dispatches
    // SDLC 15 as the triage owner.
    const script = read(join(REPO_ROOT, 'scripts', 'deploy-sdlc-agents.py'));
    expect(script).toMatch(/"SDLC 01":/);
    // SDLC 01's own managed tail is gone: its instructions were merged into 15.
    expect(script).not.toMatch(/"SDLC 01":\s*"""PERILAKU SASARAN/);
    expect(script).not.toContain('Triase bug ini dengan KRITIS');
    // The merged tail carries both halves: the criticality pass (SDLC 01) and
    // the evidence-backed priority rubric (SDLC 15).
    expect(script).toContain('apa kegagalan dan penyebabnya');
    expect(script).toContain('Prioritas — beri bukti, jangan mengira-ngira');
    // The bridge dispatches SDLC 15, not the retired SDLC 01 id.
    const bridge = read(BRIDGE);
    expect(bridge).toContain('42ec7401-88f2-4f78-ab75-a93235fa52e4');
    expect(bridge).not.toContain('d648595e-b0d9-4120-bbc4-07395cdbe6bf');
  });

  it('retires the measured mapper but keeps the documentation manager', () => {
    // 2026-11-09 (corrected same day): `Peta basis kode` (SDLC 03) produced a
    // list that the documentation skill already measures (`collect_facts.py`,
    // `check_docs.py`), so it retires to `docs-drift.yml`. `Pengelola
    // dokumentasi` (SDLC 14) is KEPT: which prose went stale, and what it should
    // become, is a judgement, not a path diff. Its one issue so far (#943) names
    // a causal chain and a consequence, not a path list.
    const script = read(join(REPO_ROOT, 'scripts', 'deploy-sdlc-agents.py'));
    // SDLC 03 retired, and its own tail is gone.
    expect(script).toMatch(/"SDLC 03":/);
    expect(script).not.toMatch(/"SDLC 03":\s*"""PERILAKU SASARAN/);
    // SDLC 14 NOT retired, and it carries the module-map judgement SDLC 03 left.
    const retired = script.slice(
      script.indexOf('RETIRED = {'),
      script.indexOf('\n}', script.indexOf('RETIRED = {'))
    );
    expect(retired).not.toMatch(/"SDLC 14":/);
    expect(script).toMatch(/"SDLC 14":\s*"""PERILAKU SASARAN/);
    expect(script).toContain('nilai apakah peta modul dan arsitektur');
    // The deterministic layer must not open a second drift issue: #782 is the
    // one parent (owner decision 2026-10-11).
    const drift = read(join(REPO_ROOT, '.github', 'scripts', 'docs-drift.sh'));
    expect(drift).not.toContain('gh issue create');
    expect(drift).toContain('docs-drift:start');
    expect(drift).toContain('gh issue edit');
  });

  it('keeps docs/SDLC-FLOW.md consistent with the folded estimate', () => {
    const flow = read(join(REPO_ROOT, 'docs', 'SDLC-FLOW.md'));
    // The stage table and the issue subgraph name one triage owner; the separate
    // `Estimasi usaha` automation is gone, and so is the estimate step itself
    // (dropped 2026-11-11 — an AI does the work).
    expect(flow).not.toContain('| Estimasi usaha ');
    expect(flow).not.toContain('C2["Estimasi usaha"]');
    expect(flow).toMatch(/Triase issue — tipe \+ keparahan \+ label/);
    // No live instruction may still ask for an estimate.
    expect(flow).not.toMatch(/kesiapan, estimasi/);
    expect(flow).not.toMatch(/duplikat, dan estimasi/);
    // `Triase bug` (SDLC 01) was folded in the same day, so "Triase ganda" is
    // now finished (#848): one owner writes one comment. The doc must say so.
    expect(flow).toMatch(/Triase ganda — SELESAI/);
    expect(flow).toMatch(/Triase satu pemilik\*\* — SELESAI/);
    expect(flow).not.toMatch(/Triase ganda — sebagian/);
  });

  it('keeps every live report source in the flow diagram’s `IN` node', () => {
    // The diagram's `IN` node is where a reader learns which reports reach
    // triage. `Pemburu bug` (SDLC 19) is retired as a *label* (`bug-hunter`,
    // 2026-11-10) but the *automation* still runs and still opens `bug` issues,
    // so it stays a source; dropping it there loses the path from that
    // automation to triage. Guard the invariant, not the one string: every
    // report-opening role the doc names must appear in `IN`, and a role named
    // `RETIRED` in the deploy script must not. `Pemburu bug` is deliberately
    // absent from `RETIRED` — the label retired, not the automation.
    const flow = read(join(REPO_ROOT, 'docs', 'SDLC-FLOW.md'));
    const inNode = flow.match(/^ {2}IN\(\["([^"]+)"\]\)/m);
    expect(inNode, 'the flow diagram has an IN node').not.toBeNull();
    const sources = inNode![1];
    for (const source of ['manusia', 'Pemburu bug', 'Pemindai standar', 'Pemindai celah uji']) {
      expect(sources, source).toContain(source);
    }
    const script = read(join(REPO_ROOT, 'scripts', 'deploy-sdlc-agents.py'));
    const retired = script.slice(
      script.indexOf('RETIRED = {'),
      script.indexOf('\n}', script.indexOf('RETIRED = {'))
    );
    expect(retired, 'Pemburu bug still runs').not.toMatch(/"SDLC 19":/);
  });

  it('releases production from a vX.Y.Z tag, and only that workflow', () => {
    // 2026-11-09 decision. `Pembuat catatan rilis` (SDLC 13) cut `-rc` tags that
    // nothing consumed; it is retired, and a human-pushed `vX.Y.Z` tag is now the
    // release. This pins the shape so a later edit cannot quietly undo it:
    //   - deploy-production is triggered by a tag push;
    //   - workflow_dispatch survives ONLY as the rollback path;
    //   - no other workflow triggers on a tag, so a tag means exactly one thing.
    const wfDir = join(REPO_ROOT, '.github', 'workflows');
    const workflows = readdirSync(wfDir).filter((f) => f.endsWith('.yml'));
    for (const f of workflows) {
      const yml = readFileSync(join(wfDir, f), 'utf8');
      // Only the `on:` block decides a trigger. `tags:` also appears under a
      // docker push step, which is not a trigger and must not be read as one.
      const onStart = yml.indexOf('\non:');
      const onBlock = onStart < 0 ? '' : yml.slice(onStart, yml.indexOf('\njobs:'));
      const triggersOnTag = /^\s+tags:/m.test(onBlock);
      if (f === 'deploy-production.yml') {
        expect(yml, f).toContain("tags: ['v*']");
        expect(yml, f).toMatch(/workflow_dispatch:/);
        // The rollback input is named as such, not as the forward release path.
        expect(yml, f).toContain('Rollback only');
      } else {
        expect(triggersOnTag, `${f} must not be triggered by a tag`).toBe(false);
      }
    }
    // The retired automation is named in the deploy script's RETIRED map, so a
    // later `DEPLOY=true` run disables it rather than re-creating it.
    const script = read(join(REPO_ROOT, 'scripts', 'deploy-sdlc-agents.py'));
    expect(script).toMatch(/"SDLC 13":/);
    // The corrected rationale (including the two wrong first reasons) is kept.
    const ideas = read(join(REPO_ROOT, 'docs', 'IDEAS.md'));
    expect(ideas).toContain('DIPENSIUNKAN 2026-11-09');
    expect(ideas).toContain('tidak ada yang **mengonsumsi** tag');
  });

  it('lists `Uji beban` (SDLC 11) as retired, not only disabled', () => {
    // `Uji beban` was turned off on 2026-10-20 (#677) when the k6 smoke moved to
    // `load-tests.yml`, but unlike its sibling `Penjaga issue` (SDLC 21) it was
    // never added to `RETIRED`. A disabled automation with no `RETIRED` entry is
    // invisible to the next deploy: nothing records why it is off, and a
    // re-enable would silently restore the monthly staging load against a
    // baseline no job refreshes. This locks the entry so the gap cannot return.
    const script = read(join(REPO_ROOT, 'scripts', 'deploy-sdlc-agents.py'));
    const retired = script.slice(
      script.indexOf('RETIRED = {'),
      script.indexOf('\n}', script.indexOf('RETIRED = {'))
    );
    expect(retired).toMatch(/"SDLC 11":/);
    // The retired key must match the live automation name by substring, or
    // `retired_key()` finds nothing and the automation is redeployed instead of
    // disabled. `SDLC 11` is unique to `Uji beban` — no other live name carries
    // it — so the fold cannot misfire onto a different automation. The value
    // spans two source lines, so match the entry's text, not a single line.
    const entry = retired.slice(retired.indexOf('"SDLC 11":'));
    expect(entry.slice(0, entry.indexOf('\n    "SDLC'))).toContain('Uji beban');
    // Its deterministic replacement is a real workflow, not a promise.
    const loadTests = read(join(REPO_ROOT, '.github', 'workflows', 'load-tests.yml'));
    expect(loadTests).toMatch(/workflow_dispatch:/);
  });

  it('renames `Pelabel issue` to `Triase issue`, in the script and in the docs', () => {
    // 2026-11-09 (user decision): the automation is the single triage owner
    // (SDLC 01 and 02 folded into it), so "Pelabel issue" named only half the
    // job. Docs and the live name must not drift apart: `docs/SDLC-FLOW.md`
    // claims to describe the fleet "apa adanya". The rename lands through the
    // same deploy as the prompt, so a later run cannot leave the old name on.
    const script = read(join(REPO_ROOT, 'scripts', 'deploy-sdlc-agents.py'));
    const renames = script.slice(
      script.indexOf('RENAMES = {'),
      script.indexOf('\n}', script.indexOf('RENAMES = {'))
    );
    expect(renames).toMatch(/"SDLC 15":\s*"SDLC 15 · Triase issue"/);
    // No doc still calls the role by the old name.
    for (const doc of ['docs/SDLC-FLOW.md', 'docs/LABELS.md', 'docs/IDEAS.md']) {
      expect(read(join(REPO_ROOT, doc)), doc).not.toContain('Pelabel issue');
    }
  });

  it('writes no fleet size into the prompts or the flow doc', () => {
    // AGENTS.md: counts are never written into a guide — they drift with the
    // next change. The fleet shrank by one automation on 2026-11-09 and the
    // API still lists the retired ones, so any fixed number is wrong somewhere.
    const script = read(join(REPO_ROOT, 'scripts', 'deploy-sdlc-agents.py'));
    const flow = read(join(REPO_ROOT, 'docs', 'SDLC-FLOW.md'));
    for (const text of [script, flow]) {
      expect(text).not.toMatch(/\bke-\d+ automation\b/);
      expect(text).not.toMatch(/Daftar berisi \d+ automation/);
      expect(text).not.toMatch(/\b\d+ automation lebih banyak\b/);
    }
  });

  it('states in docs/SDLC-FLOW.md that `Tiket jadi PR` works the daily `ready` queue', () => {
    // `Tiket jadi PR` (SDLC 06) used to trigger on the `bot-implement` label. It
    // now runs on a daily cron, scans the `ready` queue oldest-first, and opens
    // at most DAILY_PR_MAX pull requests (owner decision 2026-11-11). The flow
    // doc must say so, or a reader waits on a label that no longer exists.
    const flow = read(join(REPO_ROOT, 'docs', 'SDLC-FLOW.md'));
    // Table cells are padded by prettier, so match the row, not a fixed string.
    const start5 = flow.search(/^\| 5\s+\| Implementasi/m);
    const start6 = flow.search(/^\| 6\s+\| CI/m);
    expect(start5, 'stage 5 row').toBeGreaterThan(-1);
    const stage5 = flow.slice(start5, start6);
    expect(stage5).toContain('`ready`');
    expect(stage5).toMatch(/terlama dulu/);
    // The retired hand-off label must not be named as the trigger anywhere.
    expect(flow).not.toContain('label `bot-implement` (`Bot sebutan`');
  });

  it('makes `Tiket jadi PR` claim the issue and un-draft the PR it opens', () => {
    // The 2026-11-11 queue rewrite dropped the two steps that move work forward:
    // the prompt opened a draft PR and stopped. Issue #857 shows the result — the
    // PR was merged 19 days later only because a human marked it ready, and the
    // issue kept `ready` (with `bot-implement`) for two more days, so the queue
    // still held work that was already in review. The prompt must move the issue
    // out of the queue and the PR out of draft.
    const script = read(join(REPO_ROOT, 'scripts', 'deploy-sdlc-agents.py'));
    const start = script.indexOf('Anda adalah SATU-SATUNYA pembuka pull request');
    expect(start, 'SDLC 06 prompt body').toBeGreaterThan(-1);
    const prompt = script.slice(start, script.indexOf('"SDLC 07"', start));
    expect(prompt).toContain('`in-progress`');
    expect(prompt).toMatch(/CABUT `ready`/);
    expect(prompt).toContain('ready_for_review');
    // The draft stays the escape hatch when the work is not done, so the
    // instruction is conditional, not unconditional.
    expect(prompt).toMatch(/BIARKAN draf/);
  });
});

describe('deploy-sdlc-agents.py', () => {
  const hasPy = spawnSync('python3', ['--version']).status === 0;
  // The mandate paragraph and the footer line it mandates, as a live prompt
  // still carries them. The redeploy must strip both (2026-10-14).
  const FOOTER =
    'Setiap komentar yang Anda tulis ke GitHub WAJIB diakhiri dengan baris footer persis ini, kata demi kata, dalam bahasa Inggris (guard anti-loop bergantung pada teksnya):\n_This comment was created by an AI agent (OpenHands) on behalf of the maintainer._';

  // Call the real new_prompt(name, prompt) from the script (its __main__ is
  // guarded, so importing it does nothing else).
  const runNewPrompt = (
    name: string,
    prompt: string
  ): { status: number | null; stdout: string; stderr: string } => {
    const driver = [
      'import importlib.util, sys',
      'spec = importlib.util.spec_from_file_location("d", sys.argv[1])',
      'm = importlib.util.module_from_spec(spec)',
      'spec.loader.exec_module(m)',
      'sys.stdout.write(m.new_prompt(sys.argv[2], sys.stdin.read()))',
    ].join('\n');
    const r = spawnSync('python3', ['-c', driver, DEPLOY, name], {
      encoding: 'utf8',
      input: prompt,
    });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  };

  const newPrompt = (name: string, prompt: string): string => {
    const r = runNewPrompt(name, prompt);
    if (r.status !== 0) throw new Error(r.stderr || 'python failed');
    return r.stdout;
  };

  // A distinctive line from SDLC 15's managed tail (`TAILS` in the deploy
  // script) — the single triage owner since SDLC 01 was folded into it. Its
  // presence proves the tail — the task instructions — was re-attached, not
  // merely that a budget was appended.
  const TAILS_SDLC_15_MARKER = 'Prioritas — beri bukti, jangan mengira-ngira.';

  // The pre-fix environment note, as the live prompts still carry it verbatim.
  const AMBIENT =
    'Catatan lingkungan: `gh` mungkin belum terautentikasi; gunakan REST API GitHub (https://api.github.com) dengan token yang tertanam di remote git `origin` untuk operasi baca dan tulis apa pun pada GitHub.';

  // Load the deploy script as a module and run a Python snippet against it.
  const py = (code: string, env: Record<string, string> = {}) =>
    spawnSync(
      'python3',
      [
        '-c',
        [
          'import importlib.util, json, sys',
          'spec = importlib.util.spec_from_file_location("d", sys.argv[1])',
          'm = importlib.util.module_from_spec(spec)',
          'spec.loader.exec_module(m)',
          code,
        ].join('\n'),
        DEPLOY,
      ],
      { encoding: 'utf8', env: { ...process.env, ...env } }
    );

  it.skipIf(!hasPy)(
    'tells a writer automation to author issues/PRs as adminypc, not the bot',
    () => {
      // The environment note used to authorise the `origin` token (the
      // writer's, `adminypc`) for "any read and write on GitHub". The identity
      // block is now the single source of truth for which token does what.
      const original = `Header\n\n${AMBIENT}\n\nPERILAKU SASARAN (level agentic)\nTail`;
      const out = newPrompt('SDLC 04', original);
      expect(out).not.toContain('untuk operasi baca dan tulis apa pun pada GitHub');
      expect(out).toContain('JANGAN memakai token yang tertanam di remote git `origin`');
      expect(out).toContain('IDENTITAS — DUA AKUN, JANGAN DITUKAR');
      expect(out).toContain('`GITHUB_TOKEN` (akun `adminypc`) — PENULIS');
      expect(out).toContain('`GITHUB_BOT_TOKEN` (akun `cipansor-bot`) — KOMUNIKATOR');
      // Issues/PRs are created without labels (label-guard revokes labels from
      // any account but the bot, #838), and body edits go through the bot.
      expect(out).toContain('TANPA field `labels`');
      expect(out).toMatch(/setiap `PATCH` body issue atau PR/);
      // Drift guard: the replacement is the bullet the block carries.
      expect(py('sys.exit(0 if m.NEW_IDENTITY_LINE in m.BODY_BLOCK else 1)').status).toBe(0);
    }
  );

  it.skipIf(!hasPy)(
    'upgrades a live prompt that already carries the BODY block, idempotently',
    () => {
      // A deployed prompt already has the BODY block, so the insert is a no-op
      // for it: only the by-text replacement upgrades the identity bullet —
      // both the original one-account bullet and the first two-account bullet
      // that reached the fleet before review (#968).
      const r = py(
        [
          'res = {}',
          'for legacy in ("OLD_IDENTITY_LINE", "FIRST_SPLIT_IDENTITY_LINE"):',
          '    live = "H\\n" + m.BODY_BLOCK.replace(m.NEW_IDENTITY_LINE, getattr(m, legacy)) + "\\n" + m.AMBIENT_TOKEN_NOTE + "\\n\\nPERILAKU SASARAN (level agentic)\\nT"',
          '    out = m.new_prompt("SDLC 04 · X", live)',
          '    res[legacy] = {',
          '        "upgraded": m.NEW_IDENTITY_LINE in out and getattr(m, legacy) not in out,',
          '        "note": m.IDENTITY_TOKEN_NOTE in out and m.AMBIENT_TOKEN_NOTE not in out,',
          '        "idempotent": m.new_prompt("SDLC 04 · X", out) == out,',
          '    }',
          'print(json.dumps(res))',
        ].join('\n')
      );
      expect(r.status, r.stderr).toBe(0);
      const res = JSON.parse(r.stdout);
      for (const legacy of ['OLD_IDENTITY_LINE', 'FIRST_SPLIT_IDENTITY_LINE']) {
        expect(res[legacy], legacy).toEqual({ upgraded: true, note: true, idempotent: true });
      }
    }
  );

  it.skipIf(!hasPy)(
    'never redeploys a retired automation, whether or not it is still enabled',
    () => {
      // The first version decided "retired" from apply_retire's return value,
      // which is False once the automation is off — so every later deploy fell
      // through to new_prompt and re-uploaded the retired prompt, and its
      // trigger and timeout were PATCHed before the check. Run main() with
      // DEPLOY on against a fake API and record every write it makes.
      const deploy = (enabled: boolean) => {
        const r = py(
          [
            'calls = []',
            'autos = [',
            `  {"id": "a02", "name": "SDLC 02 · Estimasi usaha", "enabled": ${enabled ? 'True' : 'False'}, "prompt": "x", "timeout": 900, "trigger": {}},`,
            '  {"id": "a15", "name": "SDLC 15 · Triase issue", "enabled": True, "prompt": "old", "timeout": 900, "trigger": {}},',
            ']',
            'def fake_req(method, path, body=None, *a, **k):',
            '    if method == "GET":',
            '        return {"automations": autos}',
            '    calls.append([method, path, body])',
            '    return {}',
            'm.req = fake_req',
            'm.patch_tarball = lambda aid, new: calls.append(["TARBALL", aid, None]) or b""',
            'm.upload = lambda blob, label: {"tarball_path": "t"}',
            'm.time.sleep = lambda s: None',
            'm.new_prompt = lambda name, base: (calls.append(["NEW_PROMPT", name, None]) or "new")',
            'm.DEPLOY = True',
            'm.KEY = "test"',
            'm.ONLY = ""',
            'm.main()',
            'print(json.dumps(calls))',
          ].join('\n')
        );
        expect(r.status, r.stderr).toBe(0);
        // main() logs its own lines first; the recorded writes are the last line.
        const last = r.stdout.trim().split('\n').pop() ?? '[]';
        return JSON.parse(last) as [string, string, unknown][];
      };

      const touches02 = (calls: [string, string, unknown][]) =>
        calls.filter(([, target]) => target.includes('a02') || target.includes('SDLC 02'));

      // Still on: exactly one write, the disable — no trigger, timeout or prompt.
      expect(touches02(deploy(true))).toEqual([['PATCH', '/a02', { enabled: false }]]);
      // Already off: not a single write.
      expect(touches02(deploy(false))).toEqual([]);
      // The automation it was folded into is still deployed as usual.
      expect(
        deploy(false).some(([kind, name]) => kind === 'NEW_PROMPT' && name.includes('SDLC 15'))
      ).toBe(true);
    }
  );

  it.skipIf(!hasPy)('strips the AI-disclosure footer mandate from the head', () => {
    const original = `Header\n\n${FOOTER}\n\nPERILAKU SASARAN (level agentic)\nTail`;
    const out = newPrompt('SDLC 03', original);
    expect(out).not.toContain('This comment was created by an AI agent');
    expect(out).not.toContain('WAJIB diakhiri dengan baris footer');
    // The body block still lands, now anchored on the task paragraph.
    expect(out).toContain('BODY ISSUE/PR — KOMENTAR DULU');
  });

  // Call the real apply_timeout(aid, name, old_timeout, dry) from the script.
  // It returns True on a change, prints the plan on a dry run, and only ever
  // raises a value below the ceiling — never lowers one.
  const applyTimeout = (
    oldTimeout: number | null,
    dry = true
  ): { changed: boolean; out: string } => {
    const driver = [
      'import importlib.util, sys, json',
      'spec = importlib.util.spec_from_file_location("d", sys.argv[1])',
      'm = importlib.util.module_from_spec(spec)',
      'spec.loader.exec_module(m)',
      'old = None if sys.argv[2] == "null" else int(sys.argv[2])',
      'dry = sys.argv[3] == "1"',
      'changed = m.apply_timeout("aid", "SDLC 03", old, dry)',
      'sys.stdout.write("CHANGED=" + str(changed))',
    ].join('\n');
    const r = spawnSync('python3', ['-c', driver, DEPLOY, String(oldTimeout), dry ? '1' : '0'], {
      encoding: 'utf8',
    });
    if (r.status !== 0) throw new Error(r.stderr || 'python failed');
    return { changed: r.stdout.includes('CHANGED=True'), out: r.stdout + r.stderr };
  };

  it.skipIf(!hasPy)('raises a timeout below the ceiling to 1800 (invariant 20)', () => {
    const r = applyTimeout(900);
    expect(r.changed).toBe(true);
    expect(r.out).toContain('1800');
  });

  it.skipIf(!hasPy)('leaves a timeout already at the ceiling alone', () => {
    expect(applyTimeout(1800).changed).toBe(false);
  });

  it.skipIf(!hasPy)('never lowers a timeout the API somehow accepted above the ceiling', () => {
    // The API refuses > 1800 with a 422, so this is defensive: a value above the
    // ceiling must not be silently rewritten downward.
    expect(applyTimeout(3600).changed).toBe(false);
  });

  it.skipIf(!hasPy)('sets a missing timeout to the ceiling', () => {
    expect(applyTimeout(null).changed).toBe(true);
  });

  it.skipIf(!hasPy)('tells the fleet watchdog to flag a timeout below the ceiling', () => {
    // The watchdog is the runtime checker for invariant 20: the deploy script
    // sets the value, but only the watchdog can notice a hand edit in the cloud.
    const original = `Header\n\n${FOOTER}\n\nPERILAKU SASARAN (level agentic)\nOLD watchdog`;
    const out = newPrompt('SDLC 23', original);
    expect(out).not.toContain('OLD watchdog');
    expect(out).toContain('tepat 1800');
    expect(out).toContain('timeout` < 1800 adalah cacat `config`');
    expect(out).toContain('ANGGARAN WAKTU');
  });

  it.skipIf(!hasPy)('gives every automation a work budget', () => {
    // Invariant 20 / §9: the 1800s ceiling cannot be raised, so an automation
    // whose task can sprawl needs an hourglass of its own. Gerbang tinjau PR
    // carries one and shows 0 wall deaths after it; Triase bug carried none and
    // shows 23 in the same window (measured 2026-10-20).
    const original = `Header\n\n${FOOTER}\n\nPERILAKU SASARAN (level agentic)\nOriginal tail`;
    // An automation with a managed tail but no tailored budget.
    expect(newPrompt('SDLC 15', original)).toContain('ANGGARAN WAKTU — JAM PASIR');
    // An automation with no managed tail keeps its tail and gains the budget.
    const plain = newPrompt('SDLC 04', original);
    expect(plain).toContain('ANGGARAN WAKTU — JAM PASIR');
    expect(plain).toContain('Original tail');
    // Idempotent: a redeploy must not stack a second copy.
    expect(newPrompt('SDLC 04', plain).match(/ANGGARAN WAKTU — JAM PASIR/g)).toHaveLength(1);
    // A tailored budget is not doubled with the generic one.
    expect(newPrompt('SDLC 18', original)).not.toContain('JAM PASIR');
    expect(newPrompt('SDLC 23', original)).not.toContain('JAM PASIR');
  });

  it.skipIf(!hasPy)('renames the live automation in place, and is idempotent', () => {
    // `apply_rename` must PATCH only the display name — the id, prompt and
    // tarball are untouched — and must be a no-op once the name already
    // matches, or every later deploy would PATCH the same rename forever.
    const r = py(
      [
        'calls = []',
        'def fake_req(method, path, body=None, *a, **k):',
        '    calls.append([method, path, body])',
        '    return {}',
        'm.req = fake_req',
        'res = {}',
        'res["renamed"] = m.apply_rename("a15", "SDLC 15 · Pelabel issue", False)',
        'res["calls"] = calls',
        'res["idempotent"] = m.apply_rename("a15", "SDLC 15 · Triase issue", False)',
        'res["other"] = m.apply_rename("a01", "SDLC 01 · Triase bug", False)',
        'print(json.dumps(res))',
      ].join('\n')
    );
    expect(r.status, r.stderr).toBe(0);
    // apply_rename prints its own line first; the JSON is the last line.
    const last = r.stdout.trim().split('\n').pop() ?? '{}';
    const res = JSON.parse(last) as {
      renamed: boolean;
      calls: [string, string, Record<string, string>][];
      idempotent: boolean;
      other: boolean;
    };
    expect(res.renamed).toBe(true);
    expect(res.calls).toEqual([['PATCH', '/a15', { name: 'SDLC 15 · Triase issue' }]]);
    expect(res.idempotent).toBe(false);
    expect(res.other).toBe(false);
  });

  it.skipIf(!hasPy)('refuses a truncated prompt whose task instructions are gone', () => {
    // A live prompt truncated by the old head-slicing bug carries no
    // `PERILAKU SASARAN` marker. For an automation with no managed tail
    // (`TAILS`), that marker held the task's own instructions — appending a
    // budget to the surviving head would ship a prompt that cannot do its job.
    // The deploy must refuse and name the repair (`ORIGINALS`), not deploy it.
    const r = runNewPrompt('SDLC 04', 'Header tanpa ekor');
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('no ');
    expect(r.stderr).toContain('ORIGINALS');
  });

  it.skipIf(!hasPy)('rebuilds a truncated prompt whole when given the original', () => {
    // The repair path: `ORIGINALS` supplies the untruncated prompt as the base,
    // so the head is rebuilt and the tail (the task instructions) is restored —
    // not merely given a budget. The tail's own instruction text must come back.
    const original =
      'Header\n\nSertakan tes bersama perubahan kode.\n\n' +
      'PERILAKU SASARAN (level agentic)\nInstruksi tugas yang hilang saat terpotong.';
    const out = newPrompt('SDLC 04', original);
    expect(out).toContain('Instruksi tugas yang hilang saat terpotong.');
    expect(out).toContain('BODY ISSUE/PR');
    expect(out).toContain('ANGGARAN WAKTU — JAM PASIR');
    // Idempotent on that result.
    expect(newPrompt('SDLC 04', out).match(/ANGGARAN WAKTU — JAM PASIR/g)).toHaveLength(1);
  });

  it.skipIf(!hasPy)('rebuilds a managed-tail automation whole even from a truncated head', () => {
    // For an automation with a managed tail (`TAILS`), a missing live tail is
    // harmless: the tail is re-attached from the script, so the automation is
    // rebuilt whole and its instructions are not lost. No refusal.
    const out = newPrompt('SDLC 15', 'Header tanpa ekor');
    expect(out).toContain('BODY ISSUE/PR');
    expect(out).toContain('ANGGARAN WAKTU — JAM PASIR');
    expect(out).toContain(TAILS_SDLC_15_MARKER);
  });

  it.skipIf(!hasPy)('tells the triage owner never to pair `ready` with `blocked`', () => {
    // `ready` and `blocked` contradict each other (owner decision 2026-11-10):
    // an issue that cannot proceed is not one a contributor can pick up. The
    // label-guard enforces it deterministically, but the prompt must not create
    // the conflict in the first place — the triage owner wrote it 29 times.
    const out = newPrompt('SDLC 15', 'Header');
    expect(out).toContain('`ready` tidak boleh bersama `question` atau `blocked`');
    expect(out).toContain('Issue `blocked` TIDAK boleh `ready`');
  });

  it.skipIf(!hasPy)(
    'upgrades the exclusion list in a body block the live prompt already carries',
    () => {
      // The body block is inserted once, so a live prompt keeps its old one. The
      // instruction to withdraw contradicting labels before `ready` must drop
      // the removed `needs-info`/`pending-maintainer` by text — and it must
      // upgrade both older forms (without `blocked`, and with it), or a prompt
      // deployed by an earlier version keeps naming labels that no longer exist.
      const live =
        'Header\n\nBODY ISSUE/PR — KOMENTAR DULU, BODY SAAT SIAP (WAJIB)\n' +
        'Sebelum memasang `ready`, cabut dulu `question`/`needs-info`/`pending-maintainer` yang bertentangan. ' +
        'Bila belum `ready`, jangan mengubah body issue.';
      const out = newPrompt('SDLC 15', live);
      expect(out).toContain('cabut dulu `question`/`blocked` yang bertentangan');
      expect(out).not.toContain('needs-info');
      const mid =
        'Header\n\nBODY ISSUE/PR — KOMENTAR DULU, BODY SAAT SIAP (WAJIB)\n' +
        'Sebelum memasang `ready`, cabut dulu `question`/`needs-info`/`pending-maintainer`/`blocked` yang bertentangan. ' +
        'Bila belum `ready`, jangan mengubah body issue.';
      const out2 = newPrompt('SDLC 15', mid);
      expect(out2).toContain('cabut dulu `question`/`blocked` yang bertentangan');
      expect(out2).not.toContain('needs-info');
    }
  );

  it.skipIf(!hasPy)('strips the retired `bug-hunter` label from a live tail', () => {
    // The label is deleted from the repository, and the labels API creates a
    // missing label on `POST`, so a live prompt that still applies it would
    // resurrect it on the next run. The redeploy must drop the mention, and it
    // must match the real SDLC 19 wording (a narrower pattern missed it).
    const original =
      'Header\n\nPERILAKU SASARAN (level agentic)\n' +
      'berlabel `bug`, satu prioritas dari priority:critical/high/medium/low, `bug-hunter`, ' +
      'dan `bot-implement` — jangan membuka pull request.';
    const out = newPrompt('SDLC 19 · Pemburu bug', original);
    expect(out).not.toContain('bug-hunter');
    // `bot-implement` went the same way on 2026-11-11 (the fleet implements from
    // `ready`), so the strip leaves the bare priority list.
    expect(out).toContain('priority:critical/high/medium/low');
    expect(out).not.toContain('bot-implement');
    // Idempotent: a second pass changes nothing.
    expect(newPrompt('SDLC 19 · Pemburu bug', out)).toBe(out);
  });

  it.skipIf(!hasPy)('keeps the guidance sentence about the retired label intact', () => {
    // The strip must touch the live prompt's text only. Applied to the whole
    // assembled result it also rewrote the tail this script authors — leaving
    // "JANGAN memakai label ;" — so the SDLC 15 rule about `bug-hunter` must
    // survive a redeploy.
    const out = newPrompt('SDLC 15', 'Header');
    expect(out).toContain('JANGAN memakai label `bug-hunter`');
  });

  it.skipIf(!hasPy)('still enforces the 1800s timeout when a truncated prompt is refused', () => {
    // Config fixes do not depend on the prompt: when new_prompt refuses a
    // truncated prompt, the automation must still get `timeout=1800` (and its
    // trigger guard) — otherwise it stays on the old, too-short wall clock
    // that caused the wall deaths in the first place. And the refused prompt
    // itself must NOT be deployed (no PATCH carrying `prompt`).
    const driver = [
      'import importlib.util, sys, os, json',
      "os.environ['DEPLOY'] = 'true'",
      "os.environ['OPENHANDS_API_KEY'] = 'test-key'",
      'spec = importlib.util.spec_from_file_location("d", sys.argv[1])',
      'm = importlib.util.module_from_spec(spec)',
      'spec.loader.exec_module(m)',
      'calls = []',
      'def fake_req(method, path, data=None, raw=False):',
      '    calls.append({"method": method, "path": path, "data": data})',
      '    if method == "GET" and path == "/":',
      '        return {"automations": [{"id": "aid-1", "name": "SDLC 04",',
      '            "prompt": "Header tanpa ekor", "timeout": 900, "trigger": {}}]}',
      '    return {}',
      'm.req = fake_req',
      'm.patch_tarball = lambda aid, prompt: b""',
      'm.upload = lambda blob, name: {"tarball_path": "x"}',
      'code = 0',
      'try:',
      '    m.main()',
      'except SystemExit as e:',
      '    code = e.code if e.code is not None else 0',
      'print("RESULT " + json.dumps({"code": code, "calls": calls}))',
    ].join('\n');
    const r = spawnSync('python3', ['-c', driver, DEPLOY], { encoding: 'utf8' });
    const line = r.stdout.split('\n').find((l) => l.startsWith('RESULT '));
    if (!line) throw new Error(`no RESULT line: ${r.stdout}\n${r.stderr}`);
    const result = JSON.parse(line.slice('RESULT '.length)) as {
      code: number;
      calls: { method: string; path: string; data: unknown }[];
    };
    // The prompt was refused, so the script reports failure.
    expect(result.code).toBe(2);
    // The wall clock was still raised to the ceiling.
    expect(result.calls).toContainEqual({
      method: 'PATCH',
      path: '/aid-1',
      data: { timeout: 1800 },
    });
    // No PATCH carried the prompt: a refused prompt is never deployed.
    const promptPatches = result.calls.filter(
      (c) => c.method === 'PATCH' && c.data && 'prompt' in (c.data as object)
    );
    expect(promptPatches).toHaveLength(0);
  });

  it.skipIf(!hasPy)('cites the automation API endpoints the retry script actually uses', () => {
    // The fleet's own integration (the removed `automation-retry.sh`) read
    // the list at the API root and runs at `/{id}/runs`. `/automations` answers
    // 422 and `/automations/{id}/runs` answers 404, so a watchdog told to use
    // them gets no data at all.
    const out = newPrompt('SDLC 23', `x\n\nPERILAKU SASARAN (level agentic)\ny`);
    expect(out).not.toContain('/api/automation/v1/automations');
    expect(out).toContain('GET https://app.all-hands.dev/api/automation/v1`');
    expect(out).toContain('/api/automation/v1/{id}/runs?limit=5');
  });

  it.skipIf(!hasPy)(
    'tells the watchdog to classify wall failures by timeout_at, and to rotate coverage',
    () => {
      const out = newPrompt('SDLC 23', `x\n\nPERILAKU SASARAN (level agentic)\ny`);
      // A fixed 1780s threshold misclassifies the ~1000s deaths from the era of
      // `timeout=900`; the run's own deadline is the robust discriminator.
      expect(out).toContain('completed_at >= timeout_at');
      // A `command timed out` run that dies *before* its own deadline is a
      // distinct class (`wall-short`), not lumped into `wall`: the `wall` advice
      // (add budget) is wrong for a hung command. No timed-out run is classless.
      expect(out).toContain('wall-short');
      expect(out).toContain('Lima kelas');
      // 24 automations, ~19 run reads: without rotation the tail is never seen.
      expect(out).toContain('ROTASI WAJIB');
      expect(out).toContain('%j');
    }
  );

  it.skipIf(!hasPy)(
    'tells the watchdog to classify failures from error_detail, not conversation_id',
    () => {
      // The dominant fleet failure is the wall clock, not a wrong task: 128 of
      // 253 FAILED runs died at >=1780s with the agent still working. A watchdog
      // keyed on `conversation_id` would mislabel them — that field is null on
      // almost every run that dies at the wall (234 of 253 FAILED runs still had
      // a `sandbox_id`), so the classification must key on `error_detail` plus
      // time.
      const original = `Header\n\n${FOOTER}\n\nPERILAKU SASARAN (level agentic)\nOLD watchdog`;
      const out = newPrompt('SDLC 23', original);
      expect(out).toContain('`conversation_id` **bukan** penanda sandbox');
      expect(out).toContain('Timed out: command timed out or was killed');
      expect(out).toContain('Timed out: Sandbox not available');
      expect(out).toContain('Failed to get execution context');
    }
  );

  it.skipIf(!hasPy)('keeps the original tail when it has no replacement tail', () => {
    const original = `Header\n\n${FOOTER}\n\nPERILAKU SASARAN (level agentic)\nAturan khusus yang harus utuh`;
    const out = newPrompt('SDLC 03', original);
    // The old tail survives, the BODY block is inserted, nothing is truncated.
    expect(out).toContain('Aturan khusus yang harus utuh');
    expect(out).toContain('BODY ISSUE/PR');
    expect(out.endsWith('Aturan khusus yang harus utuh')).toBe(true);
  });

  it.skipIf(!hasPy)('is idempotent: a second pass does not duplicate the body block', () => {
    const original = `Header\n\n${FOOTER}\n\nPERILAKU SASARAN (level agentic)\nTail`;
    const once = newPrompt('SDLC 03', original);
    const twice = newPrompt('SDLC 03', once);
    expect(twice).toBe(once);
    expect(twice.split('BODY ISSUE/PR').length - 1).toBe(1);
  });

  it.skipIf(!hasPy)('uses the replacement tail for an automation that has one', () => {
    const original = `Header\n\n${FOOTER}\n\nPERILAKU SASARAN (level agentic)\nOLD tail`;
    const out = newPrompt('SDLC 15', original);
    expect(out).not.toContain('OLD tail');
    expect(out).toContain('KRITIS dan habis-habisan');
  });

  it.skipIf(!hasPy)('rewrites the legacy footer filter in a kept tail to the author filter', () => {
    // A tail with no replacement keeps its text, except the self-comment filter:
    // the footer is gone, so a body-text match would match nothing.
    const legacy = "!icontains(comment.body, 'This comment was created by an AI agent')";
    const original = `Header\n\n${FOOTER}\n\nPERILAKU SASARAN (level agentic)\nPeriksa filter ${legacy} pada tiap trigger.`;
    const out = newPrompt('SDLC 03', original);
    expect(out).not.toContain(legacy);
    expect(out).toContain("comment.user.login != 'cipansor-bot' && comment.user.type != 'Bot'");
  });

  it.skipIf(!hasPy)('summons @cipansor-bot in the Bot sebutan tail, not @openhands', () => {
    // `@openhands` wakes the OpenHands GitHub App; the fleet's summon is
    // `@cipansor-bot` (split 2026-10-14, one mention must not fire two agents).
    const original = `Header\n\n${FOOTER}\n\nPERILAKU SASARAN (level agentic)\nOLD tail`;
    const out = newPrompt('SDLC 07', original);
    expect(out).toContain('menyebut @cipansor-bot');
    expect(out).toContain('`@openhands` bukan pemicu Anda');
  });

  it.skipIf(!hasPy)('rebuilds from an original even when the live prompt lost its tail', () => {
    // The repair path: the truncated live prompt is not the base when the
    // original is supplied, so the tail comes back.
    const truncated = `Header\n\n${FOOTER}\n\nBODY ISSUE/PR — KOMENTAR DULU, BODY SAAT SIAP (WAJIB)\n- x`;
    const original = `Header\n\n${FOOTER}\n\nPERILAKU SASARAN (level agentic)\nAturan khusus`;
    expect(newPrompt('SDLC 03', original)).toContain('Aturan khusus');
    // The truncated base is refused outright (its task instructions are gone),
    // rather than silently rebuilt as a head-only prompt.
    expect(runNewPrompt('SDLC 03', truncated).status).not.toBe(0);
  });

  it.skipIf(!hasPy)('inserts the comment-first body block exactly once', () => {
    const original = `Header\n\n${FOOTER}\n\nPERILAKU SASARAN (level agentic)\nTail`;
    const out = newPrompt('SDLC 03', original);
    expect(out).toContain('KOMENTAR DULU, BODY SAAT SIAP');
    expect(out.split('KOMENTAR DULU, BODY SAAT SIAP').length - 1).toBe(1);
  });

  it.skipIf(!hasPy)('replaces the old body block instead of stacking a second one', () => {
    // A live prompt deployed before 2026-10-14 still carries the previous
    // marker. The redeploy must replace it, not leave both blocks in place.
    const old = `Header\n\n${FOOTER}\n\nBODY ISSUE/PR — SATU DESKRIPSI (WAJIB)\n- aturan lama\n\nPERILAKU SASARAN (level agentic)\nTail`;
    const out = newPrompt('SDLC 03', old);
    expect(out).not.toContain('SATU DESKRIPSI');
    expect(out).not.toContain('aturan lama');
    expect(out.split('KOMENTAR DULU, BODY SAAT SIAP').length - 1).toBe(1);
  });

  it.skipIf(!hasPy)(
    'tells the issue triage owner to comment first and edit the body only at ready',
    () => {
      const original = `Header\n\n${FOOTER}\n\nPERILAKU SASARAN (level agentic)\nOLD`;
      const out = newPrompt('SDLC 15', original);
      // Comment first while not ready...
      expect(out).toContain('KOMENTAR BARU');
      // ...the body only once `ready` is applied.
      expect(out).toContain('pasang `ready`');
      expect(out).toMatch(/DESKRIPSI UTAMA issue/);
      // And the priority rubric weighs impact, urgency and risk with evidence.
      expect(out).toContain('Prioritas — beri bukti');
      expect(out).toContain('layanan mati total');
      expect(out).toContain('kehilangan/korupsi data');
      expect(out).toContain('UU PDP');
      expect(out).toContain('tanpa bukti, maksimum `medium`');
      expect(out).toContain('pilih yang LEBIH RENDAH');
      expect(out).toContain('Jangan menginflasi `critical`');
    }
  );

  it.skipIf(!hasPy)(
    'tells both PR reviewers to check the acceptance criteria as a checklist',
    () => {
      // The user asked twice (2026-10-14): a PR review must say whether every
      // acceptance criterion of the linked issue is met or not, as a simple
      // markdown checkbox list — the diff, not the PR description, decides.
      for (const name of ['SDLC 08', 'SDLC 18']) {
        const out = newPrompt(name, `Header\n\n${FOOTER}\n\nPERILAKU SASARAN (level agentic)\nOLD`);
        expect(out, name).toContain('KRITERIA PENERIMAAN (WAJIB)');
        expect(out, name).toContain('- [x] <kriteria>');
        expect(out, name).toContain('- [ ] <kriteria>');
        // Two states only, and a derived criterion is marked as derived — the
        // prompt, the PR body and the reviewer's output must agree (finding:
        // the body promised a `sebagian` state the prompt never had).
        expect(out, name).not.toContain('sebagian');
        expect(out, name).toContain('(turunan)');
        expect(out, name).toMatch(/Fixes #n/);
      }
    }
  );

  it.skipIf(!hasPy)('gives the review gate a target rule and a no-build budget', () => {
    // The gate's own runs died on the 1800s platform ceiling (PATCH timeout
    // above it is rejected 422): a 3224-line diff plus `pnpm install` and
    // repeated `vitest` runs burned the budget before the review was posted.
    // The prompt must (a) tell the gate where its target is when a payload-less
    // API dispatch carries none, and (b) forbid building/testing in the
    // sandbox — CI already did that, and reading check-runs is enough.
    const out = newPrompt(
      'SDLC 18',
      `Header\n\n${FOOTER}\n\nPERILAKU SASARAN (level agentic)\nOLD`
    );
    expect(out).toContain('SASARAN (WAJIB saat payload kosong)');
    expect(out).toContain('requested_reviewers');
    expect(out).toContain('ANGGARAN WAKTU — JANGAN MEMBANGUN DI SANDBOX');
    expect(out).toContain('1800');
    expect(out).toMatch(/JANGAN `pnpm install`/);
    expect(out).toMatch(/JANGAN menjalankan suite tes repo/);
    // The tiebreak must pick the *freshest* owed head, not the oldest: a
    // payload-less dispatch fires the moment a head turns green, so the newest
    // green head is the one that asked for this run. With "oldest green" the
    // gate kept choosing a stale PR (a big diff) and starved the head that had
    // just triggered it (PR #837 review of SDLC 18).
    expect(out).toContain('paling baru hijau');
    expect(out).not.toContain('paling lama hijau');
    // A single target and a bounded investigation, so a large diff cannot burn
    // the whole budget before a review is posted.
    expect(out).toMatch(/jangan meninjau lebih dari satu PR/);
    expect(out).toContain('BATAS PENELUSURAN — WAJIB');
    // The investigation cap is concrete and self-checked (count your own
    // terminal commands): a soft "be brief" was ignored — a run spent 182
    // commands / 36 min and never posted before the 1800s ceiling.
    expect(out).toMatch(/Setelah \*\*30 perintah\*\*/);
    expect(out).toMatch(/Jangan pernah melewati 30 perintah/);
  });
});

// The EXTRACT mode archives the fleet source that only lives in the automation
// API. Two defects found in review (issue #933) are pinned here so they cannot
// come back: a relative destination wrote nothing, and two automation names
// could slugify to one directory.
describe('deploy-sdlc-agents.py --EXTRACT', () => {
  const hasPy = spawnSync('python3', ['--version']).status === 0;
  const PY_HEAD = [
    'import importlib.util, sys, os, json, tempfile',
    'spec = importlib.util.spec_from_file_location("d", sys.argv[1])',
    'm = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(m)',
  ].join('\n');

  const runDriver = (body: string): unknown => {
    const r = spawnSync('python3', ['-c', `${PY_HEAD}\n${body}`, DEPLOY], {
      encoding: 'utf8',
    });
    const line = r.stdout.split('\n').find((l) => l.startsWith('RESULT '));
    if (!line) throw new Error(`no RESULT line: ${r.stdout}\n${r.stderr}`);
    return JSON.parse(line.slice('RESULT '.length));
  };

  it.skipIf(!hasPy)(
    'writes the archive for a relative destination and still refuses a path escape',
    () => {
      // `EXTRACT=fleet-source` is relative. The guard compared a relative
      // `target` against an absolute root, so every member failed the prefix
      // test: the archive came out empty while the report claimed success.
      const result = runDriver(
        [
          'work = tempfile.mkdtemp()',
          'os.chdir(work)',
          'members = {"main.py": b"print(1)\\n", "prompt.txt": b"p", "../evil": b"boom"}',
          'rep = m.extract_one("rel-out", "SDLC 01", "sdlc-01", members)',
          'written = sorted(os.path.relpath(os.path.join(r, f), work)',
          '                 for r, _, fs in os.walk(work) for f in fs)',
          'print("RESULT " + json.dumps({"written": written, "members": sorted(rep["members"])}))',
        ].join('\n')
      ) as { written: string[]; members: string[] };

      expect(result.written).toContain('rel-out/sdlc-01/main.py');
      expect(result.written).toContain('rel-out/sdlc-01/prompt.txt');
      // The escape is neither written nor reported as an archived member.
      expect(result.written.some((p) => p.includes('evil'))).toBe(false);
      expect(result.members).not.toContain('../evil');
    }
  );

  it.skipIf(!hasPy)('gives colliding automation names their own directory', () => {
    // "SDLC 01 · Bug" and "SDLC 01 Bug" slugify alike. Sharing a directory made
    // them overwrite each other and report the same runner_digest, faking the
    // shared runner this report exists to check.
    const result = runDriver(
      [
        'autos = [{"id": "a1", "name": "SDLC 01 \\u00b7 Bug"}, {"id": "a2", "name": "SDLC 01 Bug"}]',
        'm.req = lambda method, path, raw=False: {"automations": autos}',
        'm.tarball_members = lambda aid: {"main.py": b"x", "prompt.txt": b"y"}',
        'dest = tempfile.mkdtemp()',
        'm.extract(dest)',
        'print("RESULT " + json.dumps({"dirs": sorted(os.listdir(dest))}))',
      ].join('\n')
    ) as { dirs: string[] };

    expect(result.dirs).toEqual(['manifest.json', 'sdlc-01-bug', 'sdlc-01-bug-2']);
  });
});

describe('issue-triage-bridge.sh', () => {
  const labeledEvent = (sender: string, label: string) =>
    JSON.stringify({
      action: 'labeled',
      sender: { login: sender },
      label: { name: label },
      issue: { number: 818, labels: [{ name: 'bug' }, { name: 'priority:high' }] },
    });

  // The sweep checkpoint is a hash of the issue body plus the non-fleet comments
  // (author + `updated_at` + body), serialized as two compact JSON lines exactly
  // as the script pipes them to `sha256sum` — including the trailing newline of
  // each line, so a body that only gains a trailing newline hashes differently.
  const signal = (body: string, nonfleet = '') => {
    const line1 = JSON.stringify({ body });
    const line2 = nonfleet
      ? JSON.stringify([{ login: 'reporter', updated: '2026-01-01T00:00:00Z', body: nonfleet }])
      : '[]';
    return createHash('sha256').update(`${line1}\n${line2}\n`).digest('hex').slice(0, 16);
  };
  const sweepMarker = (n: number, sig: string, run = '') =>
    `<!-- triage-bridge-sweep:${n}:${sig}:${run} -->`;

  it('dispatches the triage owner when a bot applies a type label', () => {
    const { calls, out, kv } = runBridge(
      { GH_STUB_ISSUE_LABELS: 'bug+priority:high' },
      ['--stdin'],
      labeledEvent('cipansor-bot', 'bug')
    );
    expect(calls).toContain('DISPATCH');
    expect(calls).toContain('/dispatch');
    expect(out).toContain('Dispatched the triage owner for #818');
    // The checkpoints go to the KV store, not to comments: a marker comment
    // renders empty and notifies every subscriber (the noise this fixes).
    expect(calls).not.toContain('POST_MARKER');
    expect(kv['triage-state-818']).toMatchObject({ state: 'bug+priority:high' });
    expect(kv['triage-sweep-818']).toMatchObject({ run: 'run-1' });
  });

  it('dispatches when a bot applies a priority label', () => {
    const { calls } = runBridge(
      { GH_STUB_ISSUE_LABELS: 'bug+priority:high' },
      ['--stdin'],
      labeledEvent('cipansor-bot', 'priority:high')
    );
    expect(calls).toContain('DISPATCH');
  });

  it('ignores a label a person applied', () => {
    const { calls } = runBridge(
      { GH_STUB_ISSUE_LABELS: 'bug+priority:high' },
      ['--stdin'],
      labeledEvent('adminypc', 'bug')
    );
    expect(calls).not.toContain('DISPATCH');
  });

  it('ignores a status label the labeler also sets', () => {
    const { calls } = runBridge(
      { GH_STUB_ISSUE_LABELS: 'bug+priority:high' },
      ['--stdin'],
      labeledEvent('cipansor-bot', 'ready')
    );
    expect(calls).not.toContain('DISPATCH');
  });

  // #838: `label-guard` removes a protected label a person applied and applies
  // nothing in its place, leaving the issue with no type or no priority. The
  // guard cannot trigger the bridge through GitHub (its removal is made with the
  // automatic `GITHUB_TOKEN`, and GitHub starts no run for an event that token
  // creates), so `label-guard.yml` calls `--relabel` in the same run.
  it('dispatches the labeler when a guard revocation leaves no type or priority', () => {
    const { calls, out } = runBridge({ GH_STUB_LABELS_LIST: '' }, ['--relabel', '818']);
    expect(calls).toContain('DISPATCH');
    expect(calls).toContain('/dispatch');
    expect(out).toContain('Dispatched the triage owner for #818');
  });

  it('dispatches when only the priority was revoked and the type survives', () => {
    const { calls } = runBridge({ GH_STUB_LABELS_LIST: 'bug' }, ['--relabel', '818']);
    expect(calls).toContain('DISPATCH');
  });

  it('does not dispatch when a type and a priority survive the revocation', () => {
    const { calls, out } = runBridge({ GH_STUB_LABELS_LIST: 'bug+priority:high' }, [
      '--relabel',
      '818',
    ]);
    expect(calls).not.toContain('DISPATCH');
    expect(out).toContain('still holds a type and a priority');
  });

  it('does not dispatch a relabel for a closed issue', () => {
    const { calls, out } = runBridge({ GH_STUB_LABELS_LIST: '', GH_STUB_ISSUE_STATE: 'closed' }, [
      '--relabel',
      '818',
    ]);
    expect(calls).not.toContain('DISPATCH');
    expect(out).toContain('closed');
  });

  it('collapses the guard’s removal burst to one relabel dispatch per issue', () => {
    // The guard removes one label per event, and its concurrency group is per
    // label, so the runs race. The collapse is keyed on the issue and the burst
    // window: a second relabel within the window is the same burst.
    const { calls, out } = runBridge(
      {
        GH_STUB_LABELS_LIST: 'bug',
        KV_SEED: { 'triage-unlabeled-818': { at: Math.floor(Date.now() / 1000) } },
      },
      ['--relabel', '818']
    );
    expect(calls).not.toContain('DISPATCH');
    expect(out).toContain('burst collapsed');
  });

  it('collapses a full-revocation burst even when no labels remain', () => {
    // The reported case (#836) is *every* label revoked: the resulting set is
    // empty, and the collapse must still hold or each event dispatches again.
    const { calls, out } = runBridge(
      {
        GH_STUB_LABELS_LIST: '',
        KV_SEED: { 'triage-unlabeled-818': { at: Math.floor(Date.now() / 1000) } },
      },
      ['--relabel', '818']
    );
    expect(calls).not.toContain('DISPATCH');
    expect(out).toContain('burst collapsed');
  });

  it('re-dispatches a relabel when the previous burst is older than the window', () => {
    // A genuine later revocation (a fresh hand-applied label removed after the
    // window) is a new response, not the same burst.
    const { calls } = runBridge(
      {
        GH_STUB_LABELS_LIST: '',
        KV_SEED: { 'triage-unlabeled-818': { at: 0 } },
      },
      ['--relabel', '818']
    );
    expect(calls).toContain('DISPATCH');
  });

  it('posts no comment at all, so no empty marker lands on the issue', () => {
    // Every checkpoint used to be an HTML marker comment, which renders as an
    // *empty* comment: it notified the issue's subscribers and left an
    // unreadable husk (2026-11-11: 153 of them). The bridge must create no
    // comment on any path.
    const { calls } = runBridge(
      { GH_STUB_ISSUE_LABELS: 'bug+priority:high', GH_STUB_BODY: 'triaged' },
      ['--stdin'],
      labeledEvent('cipansor-bot', 'bug')
    );
    expect(calls).toContain('DISPATCH');
    expect(calls).not.toContain('POST_MARKER');
    expect(calls).not.toContain('PATCH_BODY');
    expect(calls).not.toContain('POST /issues/818/comments');
    expect(calls).not.toContain(AI_FOOTER);
  });

  it('collapses the labeler’s burst to one dispatch per type+priority state', () => {
    // The state was recorded seconds ago, so a second label of the same burst
    // does not dispatch again.
    const { calls, out } = runBridge(
      {
        GH_STUB_ISSUE_LABELS: 'bug+priority:high',
        KV_SEED: {
          'triage-state-818': {
            state: 'bug+priority:high',
            at: Math.floor(Date.now() / 1000),
          },
        },
      },
      ['--stdin'],
      labeledEvent('cipansor-bot', 'priority:high')
    );
    expect(calls).not.toContain('DISPATCH');
    expect(out).toContain('burst collapsed');
  });

  it('re-dispatches when the issue returns to an old label state', () => {
    // The same state is recorded, but older than the burst window, so a fresh
    // move back to that state is a new response and dispatches again.
    const { calls } = runBridge(
      {
        GH_STUB_ISSUE_LABELS: 'bug+priority:high',
        KV_SEED: { 'triage-state-818': { state: 'bug+priority:high', at: 0 } },
      },
      ['--stdin'],
      labeledEvent('cipansor-bot', 'priority:high')
    );
    expect(calls).toContain('DISPATCH');
  });

  it('records no checkpoint when the label dispatch fails, so it retries', () => {
    const { calls, status, out, kv } = runBridge(
      { GH_STUB_ISSUE_LABELS: 'bug+priority:high', CURL_STUB_CODE: '503' },
      ['--stdin'],
      labeledEvent('cipansor-bot', 'bug')
    );
    expect(calls).not.toContain('POST_MARKER');
    expect(kv['triage-state-818']).toBeUndefined();
    expect(kv['triage-sweep-818']).toBeUndefined();
    expect(status).not.toBe(0);
    expect(out).toContain('failed (HTTP 503)');
  });

  it('records the sweep checkpoint after a label dispatch, so the sweep does not repeat it', () => {
    // Finding R265: the label path wrote only the state marker, so the next
    // sweep saw an empty checkpoint and dispatched the same activity again — two
    // dispatches for one label. The label path must also record the sweep
    // checkpoint of the activity it just answered.
    const { calls, kv } = runBridge(
      { GH_STUB_ISSUE_LABELS: 'bug+priority:high', GH_STUB_BODY: 'triaged' },
      ['--stdin'],
      labeledEvent('cipansor-bot', 'bug')
    );
    expect(calls).toContain('DISPATCH');
    expect(kv['triage-sweep-818']).toEqual({
      signal: signal('triaged'),
      run: 'run-1',
    });
  });

  it('snapshots the signal before the label dispatch, so an edit during it is not lost', () => {
    // Finding R243: taking the signal *after* the dispatch folds an edit landing
    // in that window into the checkpoint, and no `issues.edited` event recovers
    // it. The checkpoint must hold the pre-dispatch signal; the edit then
    // differs from it and the next sweep dispatches.
    const { calls, kv } = runBridge(
      {
        GH_STUB_ISSUE_LABELS: 'bug+priority:high',
        GH_STUB_BODY: 'before',
        GH_STUB_BODY2: 'edited-during-dispatch',
      },
      ['--stdin'],
      labeledEvent('cipansor-bot', 'bug')
    );
    expect(calls).toContain('DISPATCH');
    // The checkpoint is the activity the label dispatch actually answered...
    expect(kv['triage-sweep-818']).toEqual({ signal: signal('before'), run: 'run-1' });
    // ...not the post-dispatch edit, which would have hidden it.
    expect(kv['triage-sweep-818']).not.toMatchObject({
      signal: signal('edited-during-dispatch'),
    });
  });

  it('skips an issue whose state read fails, instead of sweeping it', () => {
    // Finding R261: a failed state read left `state` empty, no `closed`/`ready`
    // pattern matched, and the issue was swept as if it were open.
    const { calls, out } = runBridge(
      { GH_STUB_SEARCH: '2026-10-14T02:14:15Z 818', GH_STUB_READ_FAIL: 'state' },
      ['--sweep']
    );
    expect(calls).not.toContain('DISPATCH');
    expect(out).toContain('could not read #818');
  });

  it('skips an issue whose activity read fails, instead of dispatching an empty signal', () => {
    // Finding R270: `activity_signal` swallowed the error, so an empty pipe still
    // hashed to `e3b0c44298fc1c14` — a non-empty value that looked like a change
    // and dispatched an unchanged issue on every sweep.
    const { calls, out } = runBridge(
      {
        GH_STUB_SEARCH: '2026-10-14T02:14:15Z 818',
        GH_STUB_STATE_LABELS: 'open bug priority:medium',
        GH_STUB_READ_FAIL: 'comments',
      },
      ['--sweep']
    );
    expect(calls).not.toContain('DISPATCH');
    expect(calls).not.toContain('POST_MARKER');
    expect(out).toContain('could not read the activity of #818');
  });

  it('dispatches a legacy issue whose body holds the summary but has no marker comment', () => {
    // #818: the triage summary lives in the body (`<!-- sdlc:triase -->`) and no
    // fleet comment exists. It must still be swept, not skipped forever.
    const { calls } = runBridge(
      { GH_STUB_SEARCH: '2026-10-14T02:14:15Z 818', GH_STUB_BODY: 'summary' },
      ['--sweep']
    );
    expect(calls).toContain('DISPATCH');
    expect(calls).toContain('sweep-activity');
    expect(calls).not.toContain('POST_MARKER');
  });

  it('dispatches when the description changed since the checkpoint', () => {
    const { calls } = runBridge(
      {
        GH_STUB_SEARCH: '2026-10-14T02:14:15Z 818',
        GH_STUB_BODY: 'edited',
        KV_SEED: { 'triage-sweep-818': { signal: signal('before'), run: '' } },
      },
      ['--sweep']
    );
    expect(calls).toContain('DISPATCH');
  });

  it('dispatches when only a trailing newline was added to the body', () => {
    // Finding R161: reading the body through `$(…)` strips trailing newlines, so
    // `A` and `A\n` hashed the same and the edit was missed. The body is read as
    // JSON and hashed straight from the pipe, so the two differ.
    expect(signal('A')).not.toBe(signal('A\n'));
    const { calls } = runBridge(
      {
        GH_STUB_SEARCH: '2026-10-14T02:14:15Z 818',
        GH_STUB_BODY: 'A\n',
        KV_SEED: { 'triage-sweep-818': { signal: signal('A'), run: '' } },
      },
      ['--sweep']
    );
    expect(calls).toContain('DISPATCH');
  });

  it('does not dispatch when nothing changed since the checkpoint', () => {
    // The checkpoint stores the signal of the activity already answered, so an
    // unchanged issue is not re-dispatched — this is what keeps the loop closed.
    const { calls } = runBridge(
      {
        GH_STUB_SEARCH: '2026-10-14T02:14:15Z 818',
        GH_STUB_BODY: 'same',
        KV_SEED: { 'triage-sweep-818': { signal: signal('same'), run: '' } },
      },
      ['--sweep']
    );
    expect(calls).not.toContain('DISPATCH');
  });

  it('does not dispatch on a fleet comment alone', () => {
    // The bot's own comment is excluded from the signal, so a bot reply never
    // re-triages the issue.
    const { calls } = runBridge(
      {
        GH_STUB_SEARCH: '2026-10-14T02:14:15Z 818',
        GH_STUB_BODY: 'same',
        GH_STUB_NONFLEET: '',
        KV_SEED: { 'triage-sweep-818': { signal: signal('same', ''), run: '' } },
      },
      ['--sweep']
    );
    expect(calls).not.toContain('DISPATCH');
  });

  it('scopes a checkpoint to its own issue number, not a foreign key', () => {
    // #837 R512: the old listing scraped marker comments, so a comment quoting
    // the syntax could name an unrelated issue. The key is `triage-sweep-<n>`, so
    // a checkpoint under another number must not satisfy #818 — the issue has no
    // checkpoint of its own and is dispatched.
    const { calls } = runBridge(
      {
        GH_STUB_SEARCH: '2026-10-14T02:14:15Z 818',
        GH_STUB_BODY: 'same',
        GH_STUB_NONFLEET: '',
        KV_SEED: { 'triage-sweep-999': { signal: signal('same', ''), run: '' } },
      },
      ['--sweep']
    );
    expect(calls).toContain('DISPATCH');
  });

  it('keeps sweeping after an issue that needs no dispatch (set -e must not abort)', () => {
    // #819 is unchanged (process_one returns 1); #818 was edited. Both must be
    // visited: a bare call under `set -e` would stop the sweep at #819.
    const { calls } = runBridge(
      {
        GH_STUB_SEARCH: '2026-10-14T02:14:15Z 819\n2026-10-14T02:14:00Z 818',
        GH_STUB_BODY: 'edited',
        KV_SEED: {
          'triage-sweep-818': { signal: signal('before'), run: '' },
          'triage-sweep-819': { signal: signal('edited'), run: '' },
        },
      },
      ['--sweep']
    );
    expect(calls).toContain('/issues/818');
    expect(calls).toContain('/issues/819');
    expect(calls).toContain('DISPATCH');
  });

  it('reads at most SWEEP_PAGES pages of the search', () => {
    // A full page 1 would normally make `--paginate` read every page; the sweep
    // requests pages one at a time and stops at SWEEP_PAGES, so the search cost
    // is bounded (finding: the page cap did not bound the API calls).
    const items = Array.from({ length: 100 }, (_, i) => `2026-10-14T02:00:00Z ${900 - i}`).join(
      '\n'
    );
    const { calls } = runBridge({ GH_STUB_SEARCH: items, SWEEP_PAGES: '2', SWEEP_MAX: '0' }, [
      '--sweep',
    ]);
    const searchCalls = calls.split('\n').filter((l) => l.includes('search/issues')).length;
    expect(searchCalls).toBe(2);
  });

  it('records no sweep marker and fails the run when the dispatch fails', () => {
    const { calls, status } = runBridge(
      {
        GH_STUB_SEARCH: '2026-10-14T02:14:15Z 818',
        GH_STUB_BODY: 'edited',
        CURL_STUB_CODE: '500',
      },
      ['--sweep']
    );
    expect(calls).not.toContain('POST_MARKER');
    expect(status).not.toBe(0);
  });

  it('drops a stale checkpoint on an issue that is now ready', () => {
    const { calls, kv } = runBridge(
      {
        GH_STUB_SEARCH: '2026-10-14T02:14:15Z 818',
        GH_STUB_STATE_LABELS: 'open ready',
        KV_SEED: { 'triage-sweep-818': { signal: 'deadbeefdeadbeef', run: '' } },
      },
      ['--sweep']
    );
    expect(kv['triage-sweep-818']).toBeUndefined();
    expect(calls).not.toContain('DISPATCH');
  });

  // --- #836/#841: retry on the run's result, and cap the burst ---------------

  it('retries an issue whose marked run did not complete, instead of skipping it', () => {
    // #836: the marker was written at the 201, so an unchanged signal made the
    // sweep skip an issue whose run then died. The marker now names the run; a
    // FAILED run must re-dispatch the same activity.
    const { calls } = runBridge(
      {
        GH_STUB_SEARCH: '2026-10-14T02:14:15Z 818',
        GH_STUB_BODY: 'edited',
        KV_SEED: { 'triage-sweep-818': { signal: signal('edited'), run: 'run-x' } },
        CURL_STUB_RUNS: '{"runs":[{"id":"run-x","status":"FAILED"}]}',
      },
      ['--sweep']
    );
    expect(calls).toContain('DISPATCH');
  });

  it('reads the named run from the listing, not the newest run', () => {
    // #836 regression: the runs endpoint ignores `run_id=`, so a read that
    // trusted it would see the newest run (here COMPLETED) for any id and
    // finalise a failed run without retrying. The read must select `.id`.
    const { calls } = runBridge(
      {
        GH_STUB_SEARCH: '2026-10-14T02:14:15Z 818',
        GH_STUB_BODY: 'edited',
        KV_SEED: { 'triage-sweep-818': { signal: signal('edited'), run: 'run-x' } },
        CURL_STUB_RUNS:
          '{"runs":[{"id":"newest","status":"COMPLETED"},{"id":"run-x","status":"FAILED"}]}',
      },
      ['--sweep']
    );
    // The named run FAILED (not the newest, which COMPLETED), so it re-dispatches.
    expect(calls).toContain('DISPATCH');
  });

  it('finalises the checkpoint, without re-dispatching, when the marked run completed', () => {
    const { calls, kv } = runBridge(
      {
        GH_STUB_SEARCH: '2026-10-14T02:14:15Z 818',
        GH_STUB_BODY: 'edited',
        KV_SEED: { 'triage-sweep-818': { signal: signal('edited'), run: 'run-x' } },
        CURL_STUB_RUNS: '{"runs":[{"id":"run-x","status":"COMPLETED"}]}',
      },
      ['--sweep']
    );
    expect(calls).not.toContain('DISPATCH');
    // The run field is cleared, so a later sweep sees a finished checkpoint.
    expect(kv['triage-sweep-818']).toEqual({ signal: signal('edited'), run: '' });
  });

  it('leaves an in-flight run alone rather than dispatching it again', () => {
    const { calls } = runBridge(
      {
        GH_STUB_SEARCH: '2026-10-14T02:14:15Z 818',
        GH_STUB_BODY: 'edited',
        KV_SEED: { 'triage-sweep-818': { signal: signal('edited'), run: 'run-x' } },
        CURL_STUB_RUNS: '{"runs":[{"id":"run-x","status":"RUNNING"}]}',
      },
      ['--sweep']
    );
    expect(calls).not.toContain('DISPATCH');
    expect(calls).not.toContain('POST_MARKER');
  });

  it('finds a marked run on a later page instead of re-dispatching it', () => {
    // R220: the listing is paged. A run pushed past the first 100 newer ones must
    // still be found, or its checkpoint never finalises and it re-dispatches on
    // every sweep.
    const fillers = Array.from({ length: 100 }, (_, i) => ({ id: `f${i}`, status: 'COMPLETED' }));
    const runs = JSON.stringify({ runs: [...fillers, { id: 'run-x', status: 'COMPLETED' }] });
    const { calls, kv } = runBridge(
      {
        GH_STUB_SEARCH: '2026-10-14T02:14:15Z 818',
        GH_STUB_BODY: 'edited',
        KV_SEED: { 'triage-sweep-818': { signal: signal('edited'), run: 'run-x' } },
        CURL_STUB_RUNS: runs,
      },
      ['--sweep']
    );
    expect(calls).not.toContain('DISPATCH');
    expect(kv['triage-sweep-818']).toEqual({ signal: signal('edited'), run: '' });
  });

  it('does not re-dispatch when the run listing cannot be read', () => {
    // R220: a read hiccup must not masquerade as a failed run. The marker is left
    // for the next sweep, and nothing is dispatched or rewritten.
    const { calls } = runBridge(
      {
        GH_STUB_SEARCH: '2026-10-14T02:14:15Z 818',
        GH_STUB_BODY: 'edited',
        KV_SEED: { 'triage-sweep-818': { signal: signal('edited'), run: 'run-x' } },
        CURL_STUB_RUNS_RAW: 'not json',
      },
      ['--sweep']
    );
    expect(calls).not.toContain('DISPATCH');
    expect(calls).not.toContain('POST_MARKER');
  });

  it('treats a page with runs:null as unreadable, not as a missing run', () => {
    // R226: `has("runs")` passed for `{"runs":null}`, then `.runs[]` failed and
    // length read 0 — the run looked gone and was re-dispatched though it may
    // still be in flight. A non-array `runs` is an unreadable page.
    const { calls } = runBridge(
      {
        GH_STUB_SEARCH: '2026-10-14T02:14:15Z 818',
        GH_STUB_BODY: 'edited',
        KV_SEED: { 'triage-sweep-818': { signal: signal('edited'), run: 'run-x' } },
        CURL_STUB_RUNS_RAW: '{"runs":null}',
      },
      ['--sweep']
    );
    expect(calls).not.toContain('DISPATCH');
    expect(calls).not.toContain('POST_MARKER');
  });

  it('retries when the marked run is absent from the whole listing', () => {
    const { calls } = runBridge(
      {
        GH_STUB_SEARCH: '2026-10-14T02:14:15Z 818',
        GH_STUB_BODY: 'edited',
        KV_SEED: { 'triage-sweep-818': { signal: signal('edited'), run: 'run-x' } },
        CURL_STUB_RUNS: '{"runs":[{"id":"other","status":"COMPLETED"}]}',
      },
      ['--sweep']
    );
    expect(calls).toContain('DISPATCH');
  });

  it('records the run id in the checkpoint, not just the 201', () => {
    const { calls, kv } = runBridge(
      { GH_STUB_SEARCH: '2026-10-14T02:14:15Z 818', GH_STUB_BODY: 'edited' },
      ['--sweep']
    );
    expect(calls).toContain('DISPATCH');
    expect(kv['triage-sweep-818']).toEqual({ signal: signal('edited'), run: 'run-1' });
  });

  it('defers a candidate once MAX_INFLIGHT triage runs are already in flight', () => {
    // #841: the fleet never forms the burst. With the pool already full, the
    // candidate is deferred to the next sweep, not dispatched into a dead run.
    const { calls, out } = runBridge(
      {
        GH_STUB_SEARCH: '2026-10-14T02:14:15Z 818',
        GH_STUB_BODY: 'edited',
        CURL_STUB_RUNS: '{"runs":[{"status":"RUNNING"},{"status":"RUNNING"}]}',
        MAX_INFLIGHT: '2',
      },
      ['--sweep']
    );
    expect(calls).not.toContain('DISPATCH');
    expect(out).toContain('deferred');
  });

  it('dispatches when the in-flight count is below the cap', () => {
    const { calls } = runBridge(
      {
        GH_STUB_SEARCH: '2026-10-14T02:14:15Z 818',
        GH_STUB_BODY: 'edited',
        CURL_STUB_RUNS: '{"runs":[{"status":"RUNNING"}]}',
        MAX_INFLIGHT: '2',
      },
      ['--sweep']
    );
    expect(calls).toContain('DISPATCH');
  });

  it('adopts a legacy marker comment into the store, then deletes the comment', () => {
    // The pre-KV checkpoints are marker comments. When a key is absent but such a
    // comment exists, it is adopted and the comment is deleted — the store
    // becomes the only home, and the empty comment disappears from the issue.
    // A pre-#836 marker has no run field, so its outcome was never recorded: it
    // maps to `pending` and re-dispatches once, exactly as before.
    const { calls, kv } = runBridge(
      {
        GH_STUB_SEARCH: '2026-10-14T02:14:15Z 818',
        GH_STUB_BODY: 'edited',
        GH_STUB_LEGACY_BODY: `<!-- triage-bridge-sweep:818:${signal('edited')} -->`,
      },
      ['--sweep']
    );
    // The checkpoint is now in the store (the run the re-dispatch started).
    expect(kv['triage-sweep-818']).toEqual({ signal: signal('edited'), run: 'run-1' });
    expect(calls).toContain('DISPATCH');
    // The legacy comment is deleted, and no new comment is written.
    expect(calls).toContain('DELETE_MARKER');
    expect(calls).not.toContain('POST_MARKER');
  });

  it('adopts a legacy in-flight marker without re-dispatching', () => {
    // A marker that names a run (the post-#836 form) records an outcome to read,
    // so adoption must not re-dispatch: the checkpoint is adopted as-is.
    const { calls, kv } = runBridge(
      {
        GH_STUB_SEARCH: '2026-10-14T02:14:15Z 818',
        GH_STUB_BODY: 'edited',
        GH_STUB_LEGACY_BODY: `<!-- triage-bridge-sweep:818:${signal('edited')}:run-x -->`,
        CURL_STUB_RUNS: '{"runs":[{"id":"run-x","status":"COMPLETED"}]}',
      },
      ['--sweep']
    );
    expect(calls).not.toContain('DISPATCH');
    expect(kv['triage-sweep-818']).toEqual({ signal: signal('edited'), run: '' });
    expect(calls).toContain('DELETE_MARKER');
  });

  it('reads an empty run field as a finished checkpoint', () => {
    // `run` empty means the run finished: the checkpoint is final, so an
    // unchanged issue is not re-dispatched.
    const { calls } = runBridge(
      {
        GH_STUB_SEARCH: '2026-10-14T02:14:15Z 818',
        GH_STUB_BODY: 'edited',
        KV_SEED: { 'triage-sweep-818': { signal: signal('edited'), run: '' } },
      },
      ['--sweep']
    );
    expect(calls).not.toContain('DISPATCH');
  });

  it('treats a 2xx dispatch that names no run as failed, so the checkpoint is not finalised blind', () => {
    // R121: a 2xx without `.id` wrote an empty run field, which the next sweep
    // read as finished and skipped — a silent failure. It is now a failure: no
    // marker, a non-zero exit, and a retry.
    const { calls, status, out } = runBridge(
      { GH_STUB_SEARCH: '2026-10-14T02:14:15Z 818', GH_STUB_BODY: 'edited', CURL_STUB_RUN_ID: '' },
      ['--sweep']
    );
    expect(calls).toContain('DISPATCH');
    expect(calls).not.toContain('POST_MARKER');
    expect(status).not.toBe(0);
    expect(out).toContain('named no run');
  });

  it('defers a labelled issue once MAX_INFLIGHT triage runs are in flight', () => {
    // R319: the label path bypassed the cap, so a burst of labels formed the
    // burst the sweep cap prevents. It honours the same cap.
    const { calls, out } = runBridge(
      {
        GH_STUB_ISSUE_LABELS: 'bug+priority:high',
        CURL_STUB_RUNS: '{"runs":[{"status":"RUNNING"},{"status":"RUNNING"}]}',
        MAX_INFLIGHT: '2',
      },
      ['--stdin'],
      labeledEvent('cipansor-bot', 'bug')
    );
    expect(calls).not.toContain('DISPATCH');
    expect(out).toContain('deferred');
  });

  it('records a pending checkpoint when it defers, and dispatches it once capacity frees', () => {
    // A deferred issue must not be lost: the pending checkpoint keeps it
    // re-triable, and once the pool has room the sweep dispatches it.
    const deferred = runBridge(
      {
        GH_STUB_SEARCH: '2026-10-14T02:14:15Z 818',
        GH_STUB_BODY: 'edited',
        CURL_STUB_RUNS: '{"runs":[{"status":"RUNNING"}]}',
        MAX_INFLIGHT: '1',
      },
      ['--sweep']
    );
    expect(deferred.kv['triage-sweep-818']).toEqual({
      signal: signal('edited'),
      run: 'pending',
    });

    const resumed = runBridge(
      {
        GH_STUB_SEARCH: '2026-10-14T02:14:15Z 818',
        GH_STUB_BODY: 'edited',
        KV_SEED: { 'triage-sweep-818': { signal: signal('edited'), run: 'pending' } },
        CURL_STUB_RUNS: '{"runs":[]}',
        MAX_INFLIGHT: '1',
      },
      ['--sweep']
    );
    expect(resumed.calls).toContain('DISPATCH');
    expect(resumed.kv['triage-sweep-818']).toEqual({
      signal: signal('edited'),
      run: 'run-1',
    });
  });

  it('keeps a deferred checkpoint pending while the pool stays full, writing no comment', () => {
    // The full-pool sweep re-writes the same `pending` checkpoint. That used to
    // PATCH the marker comment every run and bump the issue's update time
    // (R402); the store upsert is silent, and no comment is written at all.
    const { calls, out, kv } = runBridge(
      {
        GH_STUB_SEARCH: '2026-10-14T02:14:15Z 818',
        GH_STUB_BODY: 'edited',
        KV_SEED: { 'triage-sweep-818': { signal: signal('edited'), run: 'pending' } },
        CURL_STUB_RUNS: '{"runs":[{"status":"RUNNING"}]}',
        MAX_INFLIGHT: '1',
      },
      ['--sweep']
    );
    expect(out).toContain('deferred');
    expect(kv['triage-sweep-818']).toEqual({ signal: signal('edited'), run: 'pending' });
    expect(calls).not.toContain('POST_MARKER');
    expect(calls).not.toContain('PATCH_BODY');
    expect(calls).not.toContain('/issues/comments/');
  });

  // ---- #1031 review: legacy-marker migration edge cases --------------------

  const sweepMarkerComment = (n: number, body: string, id = 900) => ({
    id,
    body,
    issue_url: `https://api.github.com/repos/o/r/issues/${n}`,
    user: { login: 'github-actions[bot]' },
    updated_at: '2026-11-11T05:00:00Z',
  });

  it('adopts a legacy sweep marker that sits past the first page of comments', () => {
    // #1031 review: `gh api --paginate` runs the filter per page, so a page with
    // no marker must emit nothing (not `null`) and the *last* line of the whole
    // listing must win. The marker is the 101st comment here.
    const { calls, kv } = runBridge(
      {
        GH_STUB_SEARCH: '2026-10-14T02:14:15Z 818',
        GH_STUB_BODY: 'edited',
        GH_STUB_COMMENTS_JSON: JSON.stringify([sweepMarkerComment(818, 'just a comment', 500)]),
        GH_STUB_LEGACY_PAGE2: JSON.stringify([
          sweepMarkerComment(
            818,
            `<!-- triage-bridge-sweep:818:${signal('edited')}:run-x -->`,
            901
          ),
        ]),
        CURL_STUB_RUNS: '{"runs":[{"id":"run-x","status":"COMPLETED"}]}',
      },
      ['--sweep']
    );
    // The marker on page 2 was adopted: the checkpoint names run-x (not a run
    // built from a `null` id), and it is finalised rather than re-dispatched.
    expect(kv['triage-sweep-818']).toEqual({ signal: signal('edited'), run: '' });
    expect(calls).not.toContain('DISPATCH');
    expect(calls).toContain('DELETE_MARKER');
  });

  it('keeps the legacy marker when the store write fails, so the run is not lost', () => {
    // #1031 review: deleting the marker before the checkpoint is stored loses the
    // only copy of the run being waited on, so the next sweep re-dispatches.
    const { calls, kv, out } = runBridge(
      {
        GH_STUB_SEARCH: '2026-10-14T02:14:15Z 818',
        GH_STUB_BODY: 'edited',
        GH_STUB_LEGACY_BODY: `<!-- triage-bridge-sweep:818:${signal('edited')}:run-x -->`,
        CURL_STUB_KV_PUT_FAIL: '1',
        CURL_STUB_RUNS: '{"runs":[{"id":"run-x","status":"RUNNING"}]}',
      },
      ['--sweep']
    );
    // The write failed: no checkpoint, the marker is kept, and the sweep leaves
    // the issue alone instead of dispatching a second run.
    expect(kv['triage-sweep-818']).toBeUndefined();
    expect(calls).not.toContain('DELETE_MARKER');
    expect(calls).not.toContain('DISPATCH');
    expect(out).toContain('keeping it for the next sweep');
  });

  it('adopts a legacy pending marker on a ready issue in the recovery pass', () => {
    // #1031 review: the store listing is empty for a pre-KV checkpoint, and the
    // ordinary sweep skips `ready` issues — so the recovery pass must also find
    // the legacy marker, or the deferred dispatch is lost.
    const { calls, kv } = runBridge(
      {
        GH_STUB_STATE_LABELS: 'open bug ready priority:high',
        GH_STUB_BODY: 'edited',
        GH_STUB_LEGACY_BODY: `<!-- triage-bridge-sweep:818:${signal('edited')} -->`,
      },
      ['--recover-ready']
    );
    expect(calls).toContain('DISPATCH');
    expect(kv['triage-sweep-818']).toEqual({ signal: signal('edited'), run: 'run-1' });
  });

  it('adopts a legacy marker whose comment sits past the comment-page cap', () => {
    // #1031 review (R673): `legacy_ready_issues` used to scan the repository's
    // comment history, so a marker past the page cap (a busy repo) was never
    // found and its deferred dispatch was lost. It now enumerates the open
    // `ready` issues and checks each for a marker, so the marker's depth in the
    // history is irrelevant.
    const { calls, kv } = runBridge(
      {
        GH_STUB_READY_ISSUES: '818',
        GH_STUB_STATE_LABELS: 'open bug ready priority:high',
        GH_STUB_BODY: 'edited',
        GH_STUB_LEGACY_BODY: `<!-- triage-bridge-sweep:818:${signal('edited')} -->`,
        // The repo-wide comment window the old discovery scanned holds no
        // marker: only the `ready`-issue enumeration can find #818.
        GH_STUB_RAW_COMMENTS: JSON.stringify([{ id: 7, body: 'ordinary chatter' }]),
      },
      ['--recover-ready']
    );
    expect(calls).toContain('/issues?state=open&labels=ready');
    expect(calls).toContain('DISPATCH');
    expect(kv['triage-sweep-818']).toEqual({ signal: signal('edited'), run: 'run-1' });
  });

  it('adopts a legacy marker found on a second page of ready issues', () => {
    // #1031 review (R673): the enumeration must page, not stop at the first 100
    // `ready` issues. #818 sits on page 2 and is still adopted.
    const { calls, kv } = runBridge(
      {
        GH_STUB_READY_PAGE2: '818',
        GH_STUB_STATE_LABELS: 'open bug ready priority:high',
        GH_STUB_BODY: 'edited',
        GH_STUB_LEGACY_BODY: `<!-- triage-bridge-sweep:818:${signal('edited')} -->`,
        GH_STUB_RAW_COMMENTS: JSON.stringify([{ id: 7, body: 'ordinary chatter' }]),
      },
      ['--recover-ready']
    );
    expect(calls).toContain('page=2');
    expect(calls).toContain('DISPATCH');
    expect(kv['triage-sweep-818']).toEqual({ signal: signal('edited'), run: 'run-1' });
  });

  it('deletes a status-only legacy marker on a ready issue when purging', () => {
    // #1031 review (R732): for a `ready` issue carrying only a status marker the
    // purge looked for a *sweep* marker, found none, skipped the delete — yet
    // still counted the comment as removed. The row's own id and kind are used
    // now, so the status marker is deleted and the count is honest.
    const { calls, out } = runBridge(
      {
        GH_STUB_STATE_LABELS: 'open bug ready',
        GH_STUB_LEGACY_KIND: 'state',
        GH_STUB_LEGACY_STATE: 'bug+priority:medium',
      },
      ['--purge-markers']
    );
    expect(calls).toContain('DELETE_MARKER');
    expect(out).toContain('1 legacy marker comment(s) removed.');
  });

  it('adopts a legacy pending marker on a ready issue before purging it', () => {
    // #1031 review: `--purge-markers` used to delete the marker without moving
    // the checkpoint, dropping a deferred dispatch. It adopts first.
    const { calls, kv } = runBridge(
      {
        GH_STUB_STATE_LABELS: 'open bug ready priority:high',
        GH_STUB_LEGACY_BODY: `<!-- triage-bridge-sweep:818:${signal('edited')} -->`,
      },
      ['--purge-markers']
    );
    expect(kv['triage-sweep-818']).toEqual({ signal: signal('edited'), run: 'pending' });
    expect(calls).toContain('DELETE_MARKER');
  });

  it('records the sweep checkpoint when the label-state read fails, instead of aborting', () => {
    // #1031 review: a failed `issue_state` read left `state` unset, and under
    // `set -u` the unguarded expansion aborted the script *after* the dispatch —
    // so the run was never recorded and the next sweep dispatched again.
    const { calls, status, kv } = runBridge(
      {
        GH_STUB_ISSUE_LABELS_FAIL: '1',
        GH_STUB_BODY: 'triaged',
      },
      ['--stdin'],
      labeledEvent('cipansor-bot', 'bug')
    );
    expect(calls).toContain('DISPATCH');
    expect(status).toBe(0);
    expect(kv['triage-sweep-818']).toEqual({ signal: signal('triaged'), run: 'run-1' });
    expect(kv['triage-state-818']).toBeUndefined();
  });

  it('still records the sweep checkpoint when the state write fails', () => {
    // The state write is best effort: a store hiccup on the state key must not
    // abort (set -e) before the sweep checkpoint of the accepted dispatch is
    // written, or the next sweep would dispatch the same activity again.
    const { calls, status, kv } = runBridge(
      {
        GH_STUB_ISSUE_LABELS: 'bug+priority:high',
        GH_STUB_BODY: 'triaged',
        CURL_STUB_KV_PUT_FAIL: '1',
      },
      ['--stdin'],
      labeledEvent('cipansor-bot', 'bug')
    );
    expect(calls).toContain('DISPATCH');
    expect(status).toBe(0);
    expect(kv['triage-state-818']).toBeUndefined();
    expect(kv['triage-sweep-818']).toBeUndefined();
  });

  it('collapses a label burst that began before the migration, via the legacy state marker', () => {
    // #1031 review: with no state in the store, a second label of a burst that
    // started before the deploy started a second run. The legacy state marker is
    // adopted and the burst collapses.
    const { calls, out, kv } = runBridge(
      {
        GH_STUB_ISSUE_LABELS: 'bug+priority:high',
        GH_STUB_LEGACY_STATE: 'bug+priority:high',
        GH_STUB_LEGACY_STATE_AT: new Date().toUTCString(),
      },
      ['--stdin'],
      labeledEvent('cipansor-bot', 'priority:high')
    );
    expect(calls).not.toContain('DISPATCH');
    expect(out).toContain('burst collapsed');
    expect(kv['triage-state-818']).toMatchObject({ state: 'bug+priority:high' });
  });
});
