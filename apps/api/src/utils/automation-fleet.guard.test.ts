import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
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
      *"/collaborators/"*"/permission"*) printf '%s\\n' "\${GH_STUB_PERM:-none}" ;;
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
code="\${CURL_STUB_CODE:-200}"
out=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -w) shift 2 ;;
    -X) shift 2 ;;
    -d) log "BODY $2"; shift 2 ;;
    -H) shift 2 ;;
    -*) shift ;;
    *) [ -z "$url" ] && url="$1"; shift ;;
  esac
done
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
case "$*" in
  *"search/issues"*) printf '%s\\n' "\${GH_STUB_SEARCH:-}" ;;
  *"[.state, (.labels[].name)]"*)
    [ "\${GH_STUB_READ_FAIL:-}" = state ] && exit 1
    printf '%s\\n' "\${GH_STUB_STATE_LABELS:-open bug priority:medium}" ;;
  *"select(("*) printf '%s\\n' "\${GH_STUB_NONFLEET:-}" ;;
  *"startswith(\\"<!-- triage-bridge-sweep:"*)
    n=$(printf '%s' "$*" | sed -n 's#.*/issues/\\([0-9][0-9]*\\)/.*#\\1#p')
    want=$(printf '%s' "$*" | sed -n 's#.*triage-bridge-sweep:\\([0-9][0-9]*\\):.*#\\1#p')
    m=$(printenv "GH_STUB_MARKER_$n" 2>/dev/null || true)
    [ -n "$m" ] || m="\${GH_STUB_SWEEP_MARKER:-}"
    if [ -z "$want" ]; then
      # A prefix with no issue number (the regression) also matches a stray
      # marker of another number sharing the comment set.
      m="\${GH_STUB_MARKER_STRAY:-\$m}"
    elif [ "$want" != "$n" ]; then
      m=""
    fi
    [ -n "$m" ] && printf '%s' "$m" ;;
  *"| max //"*) printf '%s\\n' "\${GH_STUB_LASTTRIAGE:-}" ;;
  *"[0-9]+:[0-9a-f]+"*) printf '%s\\n' "\${GH_STUB_SWEEP_BODIES:-}" ;;
  *"join(\\"+\\")"*) printf '%s\\n' "\${GH_STUB_ISSUE_LABELS:-bug+priority:medium}" ;;
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
  env: Record<string, string>,
  args: string[] = [],
  stdin?: string,
  binDir = dir
) {
  writeFileSync(log, '');
  rmSync(`${log}.n`, { force: true });
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
      OPENHANDS_API_KEY: 'test-key',
      ...env,
    },
  });
  return {
    status: r.status ?? -1,
    out: `${r.stdout}${r.stderr}`,
    calls: existsSync(log) ? readFileSync(log, 'utf8') : '',
  };
}

const runBridge = (env: Record<string, string>, args: string[], stdin?: string) =>
  run(BRIDGE, env, args, stdin, bridgeDir);

const LABELS =
  'bug\nenhancement\nready\nquestion\nneeds-info\npriority:high\npriority:medium\nrilis-disetujui\nrilis-ditolak\nbot-implement\nsource:template';

const labeledEvent = (login: string, label: string, opts: { pr?: boolean } = {}) =>
  JSON.stringify({
    action: 'labeled',
    sender: { login },
    label: { name: label },
    ...(opts.pr ? { pull_request: { number: 7 } } : { issue: { number: 7, pull_request: null } }),
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

  it('leaves the human-decision labels even when a person applies them', () => {
    for (const label of ['rilis-disetujui', 'rilis-ditolak', 'bot-implement']) {
      const { calls } = run(
        LABEL_GUARD,
        { GH_STUB_LABELS: LABELS, GH_STUB_PERM: 'admin' },
        ['--stdin'],
        labeledEvent('adminypc', label)
      );
      expect(calls, label).not.toContain('UNLABEL');
    }
  });

  it('leaves the issue template’s type label, applied when the issue opens', () => {
    // #842: `bug_report.yml` sets `bug` (and `feature_request.yml` sets
    // `enhancement`) the moment an issue is created, so revoking it fights the
    // template and posts a notice on every new issue. The type label is the
    // reporter's declared intent; the triage owner sets the correct one on top.
    const { calls, out } = run(
      LABEL_GUARD,
      { GH_STUB_LABELS: LABELS },
      ['--stdin'],
      labeledEvent('adminypc', 'bug')
    );
    expect(calls).not.toContain('UNLABEL');
    expect(calls).not.toContain('COMMENT');
    expect(out).toContain('not a protected label');
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

  it('removes a `ready` that contradicts `needs-info`', () => {
    const { calls } = run(
      LABEL_GUARD,
      { GH_STUB_LABELS: LABELS, GH_STUB_CURRENT: 'ready\nneeds-info' },
      ['--stdin'],
      labeledEvent('cipansor-bot', 'ready')
    );
    expect(calls).toContain('/issues/7/labels/ready');
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
    // The reviewer's scenario: `ready`+`needs-info` present, a human adds
    // `question`. Revoking `question` does not clear `needs-info`, so the issue
    // stays contradictory — `ready` must go too.
    const { calls } = run(
      LABEL_GUARD,
      {
        GH_STUB_LABELS: LABELS,
        GH_STUB_PERM: 'admin',
        GH_STUB_CURRENT: 'ready\nquestion\nneeds-info',
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

  it('acknowledges an outside reporter answering a `needs-info` issue', () => {
    // Penjernih issue fires on the reporter's reply, so it must be acknowledged.
    const { calls } = run(
      ACKNOWLEDGE,
      { GH_STUB_LOGIN: 'cipansor-bot' },
      ['--stdin'],
      event({ association: 'NONE', labels: ['needs-info', 'bug'] })
    );
    expect(calls).toContain('REACT_COMMENT');
  });

  it('acknowledges a maintainer on a `pending-maintainer` issue', () => {
    const { calls } = run(
      ACKNOWLEDGE,
      { GH_STUB_LOGIN: 'cipansor-bot' },
      ['--stdin'],
      event({ association: 'OWNER', labels: ['pending-maintainer'] })
    );
    expect(calls).toContain('REACT_COMMENT');
  });

  it('does not acknowledge an outsider on a `pending-maintainer` issue', () => {
    const { calls } = run(
      ACKNOWLEDGE,
      { GH_STUB_LOGIN: 'cipansor-bot' },
      ['--stdin'],
      event({ association: 'NONE', labels: ['pending-maintainer'] })
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
        labels: ['needs-info'],
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
    // searches `-label:ready`, so a pending marker there is never retried. The
    // recovery pass acts on it.
    const markup = `<!-- triage-bridge-sweep:818:${signal('edited')}:pending -->`;
    const { calls, out } = runBridge(
      {
        GH_STUB_SWEEP_BODIES: markup,
        GH_STUB_MARKER_818: markup,
        GH_STUB_STATE_LABELS: 'open bug ready priority:high',
        GH_STUB_BODY: 'edited',
      },
      ['--recover-ready']
    );
    expect(calls).toContain('DISPATCH');
    expect(calls).toContain(`triage-bridge-sweep:818:${signal('edited')}:run-1`);
    expect(out).toContain('recovered on ready issues');
  });

  it('recovers a pending marker even when its issue is outside the search window', () => {
    // R475: the recovery must find a marker by scanning markers, not a
    // `ready`-issue search bounded by update time — else an old pending marker is
    // forgotten once newer `ready` issues fill the page window.
    const markup = `<!-- triage-bridge-sweep:99:${signal('old')}:pending -->`;
    const { calls, out } = runBridge(
      {
        GH_STUB_SWEEP_BODIES: markup,
        GH_STUB_MARKER_99: markup,
        GH_STUB_STATE_LABELS: 'open bug ready',
        GH_STUB_BODY: 'old',
      },
      ['--recover-ready']
    );
    expect(calls).toContain('DISPATCH');
    expect(out).toContain('recovered on ready issues');
  });

  it('retries a failed recovery run on a ready issue, which the sweep skips', () => {
    // R474: a recovered dispatch turns the marker from `pending` into a run id;
    // if that run fails, only the recovery pass can retry it (the sweep skips
    // `ready`).
    const markup = `<!-- triage-bridge-sweep:818:${signal('edited')}:r1 -->`;
    const { calls } = runBridge(
      {
        GH_STUB_SWEEP_BODIES: markup,
        GH_STUB_MARKER_818: markup,
        GH_STUB_STATE_LABELS: 'open bug ready',
        GH_STUB_BODY: 'edited',
        CURL_STUB_RUNS: '{"runs":[{"id":"r1","status":"FAILED"}]}',
      },
      ['--recover-ready']
    );
    expect(calls).toContain('RUNS');
    expect(calls).toContain('DISPATCH');
    expect(calls).toContain(`triage-bridge-sweep:818:${signal('edited')}:run-1`);
  });

  it('finalises a completed recovery run on a ready issue without re-dispatching', () => {
    const markup = `<!-- triage-bridge-sweep:818:${signal('edited')}:r1 -->`;
    const { calls } = runBridge(
      {
        GH_STUB_SWEEP_BODIES: markup,
        GH_STUB_MARKER_818: markup,
        GH_STUB_STATE_LABELS: 'open bug ready',
        GH_STUB_BODY: 'edited',
        CURL_STUB_RUNS: '{"runs":[{"id":"r1","status":"COMPLETED"}]}',
      },
      ['--recover-ready']
    );
    expect(calls).toContain('RUNS');
    expect(calls).not.toContain('DISPATCH');
    expect(calls).toContain(`triage-bridge-sweep:818:${signal('edited')}: -->`);
  });

  it('does not re-triage a ready issue already finalised when a comment changes it', () => {
    // R496: a new comment on a `ready` issue changes the signal; the marker is a
    // final checkpoint, so the recovery must not dispatch again.
    const markup = `<!-- triage-bridge-sweep:818:${signal('A')}: -->`;
    const { calls } = runBridge(
      {
        GH_STUB_SWEEP_BODIES: markup,
        GH_STUB_MARKER_818: markup,
        GH_STUB_STATE_LABELS: 'open bug ready',
        GH_STUB_BODY: 'B',
      },
      ['--recover-ready']
    );
    expect(calls).not.toContain('DISPATCH');
    expect(calls).not.toContain('run_id=');
  });

  it('ignores a comment that only quotes the marker syntax', () => {
    // R512: a comment on another issue that quotes a marker names an issue it
    // does not belong to. The listing may name #818, but #818 has no marker of
    // its own, so it must not be re-triaged.
    const quoted = `Contoh: <!-- triage-bridge-sweep:818:abc123:pending -->`;
    const { calls } = runBridge(
      {
        GH_STUB_SWEEP_BODIES: quoted,
        GH_STUB_STATE_LABELS: 'open bug ready',
      },
      ['--recover-ready']
    );
    expect(calls).not.toContain('DISPATCH');
    expect(calls).not.toContain('run_id=');
  });

  it('ignores a stale marker when a newer final marker exists on the issue', () => {
    const stale = `<!-- triage-bridge-sweep:818:${signal('old')}:pending -->`;
    const current = `<!-- triage-bridge-sweep:818:${signal('new')}: -->`;
    const { calls } = runBridge(
      {
        GH_STUB_SWEEP_BODIES: stale,
        GH_STUB_MARKER_818: current,
        GH_STUB_STATE_LABELS: 'open bug ready',
        GH_STUB_BODY: 'new',
      },
      ['--recover-ready']
    );
    expect(calls).not.toContain('DISPATCH');
  });

  it('fails the recovery step when a dispatch is rejected, so it is visible', () => {
    // R481: a rejected dispatch must not leave the workflow green; the exit
    // status (not only the message) proves it.
    const markup = `<!-- triage-bridge-sweep:818:${signal('edited')}:pending -->`;
    const { calls, out, status } = runBridge(
      {
        GH_STUB_SWEEP_BODIES: markup,
        GH_STUB_MARKER_818: markup,
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

  it('leaves a ready issue with no marker untouched in the recovery pass', () => {
    const { calls } = runBridge(
      { GH_STUB_SWEEP_BODIES: '', GH_STUB_STATE_LABELS: 'open bug ready' },
      ['--recover-ready']
    );
    expect(calls).not.toContain('DISPATCH');
    expect(calls).not.toContain('run_id=');
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

## HUMAN`;
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
    for (const file of ['bug_report.yml', 'feature_request.yml']) {
      const form = read(join(REPO_ROOT, '.github', 'ISSUE_TEMPLATE', file));
      expect(form, `${file} shows the basmalah as a form prompt`).toContain(arabic);
      // It must sit in a `type: markdown` block (a preview), never in a field
      // that would land in the body — otherwise "carried" would be false.
      const before = form.slice(0, form.indexOf(arabic));
      const lastType = [...before.matchAll(/type:\s*(\S+)/g)].pop();
      expect(lastType?.[1], `${file} basmalah block type`).toBe('markdown');
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

  it('states in docs/SDLC-FLOW.md that `bot-implement`, not `ready`, triggers implementation', () => {
    // A `ready` issue with a maintainer comment asking for a PR got no bot: the
    // trigger is the `bot-implement` label (SDLC 06). The flow doc must say so,
    // or a reader waits on `ready` that was never going to start anything.
    const flow = read(join(REPO_ROOT, 'docs', 'SDLC-FLOW.md'));
    const stage5 = flow.slice(flow.indexOf('| 5 | Implementasi'), flow.indexOf('| 6 | CI'));
    expect(stage5).toContain('bot-implement');
    expect(stage5).toMatch(/`ready` saja TIDAK memicu/);
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
  const newPrompt = (name: string, prompt: string): string => {
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
    if (r.status !== 0) throw new Error(r.stderr || 'python failed');
    return r.stdout;
  };

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
    const out = newPrompt('SDLC 01', original);
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
    // And the buggy base would not have recovered it (idempotent head only).
    expect(newPrompt('SDLC 03', truncated)).not.toContain('Aturan khusus');
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
    const { calls, out } = runBridge(
      { GH_STUB_ISSUE_LABELS: 'bug+priority:high' },
      ['--stdin'],
      labeledEvent('cipansor-bot', 'bug')
    );
    expect(calls).toContain('DISPATCH');
    expect(calls).toContain('/dispatch');
    expect(calls).toContain('POST_MARKER');
    expect(out).toContain('Dispatched the triage owner for #818');
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

  it('carries no AI-disclosure footer on its marker comment', () => {
    // The marker posts as `github-actions[bot]`; a comment-triggered automation
    // tells it from a reporter by that `*[bot]` author, so no footer is needed.
    const { calls } = runBridge(
      { GH_STUB_ISSUE_LABELS: 'bug+priority:high' },
      ['--stdin'],
      labeledEvent('cipansor-bot', 'bug')
    );
    expect(calls).not.toContain(AI_FOOTER);
  });

  it('collapses the labeler’s burst to one dispatch per type+priority state', () => {
    // The state marker was written seconds ago, so a second label of the same
    // burst does not dispatch again.
    const marker = '<!-- triage-bridge:818:bug+priority:high -->';
    const { calls, out } = runBridge(
      {
        GH_STUB_ISSUE_LABELS: 'bug+priority:high',
        GH_STUB_COMMENTS: marker,
        GH_STUB_LASTTRIAGE: new Date().toISOString(),
      },
      ['--stdin'],
      labeledEvent('cipansor-bot', 'priority:high')
    );
    expect(calls).not.toContain('DISPATCH');
    expect(out).toContain('burst collapsed');
  });

  it('re-dispatches when the issue returns to an old label state', () => {
    // The same state marker exists, but it is older than the burst window, so a
    // fresh move back to that state is a new response and dispatches again.
    const marker = '<!-- triage-bridge:818:bug+priority:high -->';
    const { calls } = runBridge(
      {
        GH_STUB_ISSUE_LABELS: 'bug+priority:high',
        GH_STUB_COMMENTS: marker,
        GH_STUB_LASTTRIAGE: '2020-01-01T00:00:00Z',
      },
      ['--stdin'],
      labeledEvent('cipansor-bot', 'priority:high')
    );
    expect(calls).toContain('DISPATCH');
  });

  it('records no marker when the label dispatch fails, so it retries', () => {
    const { calls, status, out } = runBridge(
      { GH_STUB_ISSUE_LABELS: 'bug+priority:high', CURL_STUB_CODE: '503' },
      ['--stdin'],
      labeledEvent('cipansor-bot', 'bug')
    );
    expect(calls).not.toContain('POST_MARKER');
    expect(status).not.toBe(0);
    expect(out).toContain('failed (HTTP 503)');
  });

  it('records the sweep checkpoint after a label dispatch, so the sweep does not repeat it', () => {
    // Finding R265: the label path wrote only the state marker, so the next
    // sweep saw an empty checkpoint and dispatched the same activity again — two
    // dispatches for one label. The label path must also record the sweep
    // checkpoint of the activity it just answered.
    const { calls } = runBridge(
      { GH_STUB_ISSUE_LABELS: 'bug+priority:high', GH_STUB_BODY: 'triaged' },
      ['--stdin'],
      labeledEvent('cipansor-bot', 'bug')
    );
    expect(calls).toContain('DISPATCH');
    expect(calls).toContain('POST_MARKER');
    const sweepMarkers = calls.match(/triage-bridge-sweep:818:[0-9a-f]{16}/g) ?? [];
    expect(sweepMarkers.length).toBe(1);
    expect(calls).toContain(`triage-bridge-sweep:818:${signal('triaged')}:run-1`);
  });

  it('snapshots the signal before the label dispatch, so an edit during it is not lost', () => {
    // Finding R243: taking the signal *after* the dispatch folds an edit landing
    // in that window into the checkpoint, and no `issues.edited` event recovers
    // it. The checkpoint must hold the pre-dispatch signal; the edit then
    // differs from it and the next sweep dispatches.
    const { calls } = runBridge(
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
    expect(calls).toContain(`triage-bridge-sweep:818:${signal('before')}:run-1`);
    // ...not the post-dispatch edit, which would have hidden it.
    expect(calls).not.toContain(
      `triage-bridge-sweep:818:${signal('edited-during-dispatch')}:run-1`
    );
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
    expect(calls).toContain('POST_MARKER');
  });

  it('dispatches when the description changed since the checkpoint', () => {
    const { calls } = runBridge(
      {
        GH_STUB_SEARCH: '2026-10-14T02:14:15Z 818',
        GH_STUB_BODY: 'edited',
        GH_STUB_SWEEP_MARKER: sweepMarker(818, signal('before')),
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
        GH_STUB_SWEEP_MARKER: sweepMarker(818, signal('A')),
      },
      ['--sweep']
    );
    expect(calls).toContain('DISPATCH');
  });

  it('does not dispatch when nothing changed since the checkpoint', () => {
    // The marker stores the signal of the activity already answered, so an
    // unchanged issue is not re-dispatched — this is what keeps the loop closed.
    const { calls } = runBridge(
      {
        GH_STUB_SEARCH: '2026-10-14T02:14:15Z 818',
        GH_STUB_BODY: 'same',
        GH_STUB_SWEEP_MARKER: sweepMarker(818, signal('same')),
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
        GH_STUB_SWEEP_MARKER: sweepMarker(818, signal('same', '')),
      },
      ['--sweep']
    );
    expect(calls).not.toContain('DISPATCH');
  });

  it('matches a sweep marker only under its own issue number', () => {
    // With correct number-scoping the query sees only the 818 marker, so the
    // unchanged issue is not dispatched. The stub's numberless branch (the
    // regression) serves GH_STUB_MARKER_STRAY instead — the same comment set
    // with a foreign-number marker last, which a numberless prefix would read.
    const { calls } = runBridge(
      {
        GH_STUB_SEARCH: '2026-10-14T02:14:15Z 818',
        GH_STUB_BODY: 'same',
        GH_STUB_NONFLEET: '',
        GH_STUB_SWEEP_MARKER: sweepMarker(818, signal('same', '')),
        // The body a numberless prefix would select as `last`: the foreign
        // marker, so `marker_signal` returns `deadbeefdeadbeef` and the
        // unchanged issue is dispatched (the regression).
        GH_STUB_MARKER_STRAY: '<!-- triage-bridge-sweep:999:deadbeefdeadbeef -->',
      },
      ['--sweep']
    );
    expect(calls).not.toContain('DISPATCH');
  });

  it('keeps sweeping after an issue that needs no dispatch (set -e must not abort)', () => {
    // #819 is unchanged (process_one returns 1); #818 was edited. Both must be
    // visited: a bare call under `set -e` would stop the sweep at #819.
    const { calls } = runBridge(
      {
        GH_STUB_SEARCH: '2026-10-14T02:14:15Z 819\n2026-10-14T02:14:00Z 818',
        GH_STUB_BODY: 'edited',
        GH_STUB_MARKER_818: sweepMarker(818, signal('before')),
        GH_STUB_MARKER_819: sweepMarker(819, signal('edited')),
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

  it('drops a stale sweep marker on an issue that is now ready', () => {
    const { calls } = runBridge(
      {
        GH_STUB_SEARCH: '2026-10-14T02:14:15Z 818',
        GH_STUB_STATE_LABELS: 'open ready',
        GH_STUB_SWEEP_MARKER: 'yes',
      },
      ['--sweep']
    );
    expect(calls).toContain('DELETE_MARKER');
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
        GH_STUB_SWEEP_MARKER: sweepMarker(818, signal('edited'), 'run-x'),
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
        GH_STUB_SWEEP_MARKER: sweepMarker(818, signal('edited'), 'run-x'),
        CURL_STUB_RUNS:
          '{"runs":[{"id":"newest","status":"COMPLETED"},{"id":"run-x","status":"FAILED"}]}',
      },
      ['--sweep']
    );
    // The named run FAILED (not the newest, which COMPLETED), so it re-dispatches.
    expect(calls).toContain('DISPATCH');
  });

  it('finalises the checkpoint, without re-dispatching, when the marked run completed', () => {
    const { calls } = runBridge(
      {
        GH_STUB_SEARCH: '2026-10-14T02:14:15Z 818',
        GH_STUB_BODY: 'edited',
        GH_STUB_SWEEP_MARKER: sweepMarker(818, signal('edited'), 'run-x'),
        CURL_STUB_RUNS: '{"runs":[{"id":"run-x","status":"COMPLETED"}]}',
      },
      ['--sweep']
    );
    expect(calls).not.toContain('DISPATCH');
    // The run field is cleared, so a later sweep sees a finished checkpoint.
    expect(calls).toContain(`triage-bridge-sweep:818:${signal('edited')}: `);
  });

  it('leaves an in-flight run alone rather than dispatching it again', () => {
    const { calls } = runBridge(
      {
        GH_STUB_SEARCH: '2026-10-14T02:14:15Z 818',
        GH_STUB_BODY: 'edited',
        GH_STUB_SWEEP_MARKER: sweepMarker(818, signal('edited'), 'run-x'),
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
    const { calls } = runBridge(
      {
        GH_STUB_SEARCH: '2026-10-14T02:14:15Z 818',
        GH_STUB_BODY: 'edited',
        GH_STUB_SWEEP_MARKER: sweepMarker(818, signal('edited'), 'run-x'),
        CURL_STUB_RUNS: runs,
      },
      ['--sweep']
    );
    expect(calls).not.toContain('DISPATCH');
    expect(calls).toContain(`triage-bridge-sweep:818:${signal('edited')}: `);
  });

  it('does not re-dispatch when the run listing cannot be read', () => {
    // R220: a read hiccup must not masquerade as a failed run. The marker is left
    // for the next sweep, and nothing is dispatched or rewritten.
    const { calls } = runBridge(
      {
        GH_STUB_SEARCH: '2026-10-14T02:14:15Z 818',
        GH_STUB_BODY: 'edited',
        GH_STUB_SWEEP_MARKER: sweepMarker(818, signal('edited'), 'run-x'),
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
        GH_STUB_SWEEP_MARKER: sweepMarker(818, signal('edited'), 'run-x'),
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
        GH_STUB_SWEEP_MARKER: sweepMarker(818, signal('edited'), 'run-x'),
        CURL_STUB_RUNS: '{"runs":[{"id":"other","status":"COMPLETED"}]}',
      },
      ['--sweep']
    );
    expect(calls).toContain('DISPATCH');
  });

  it('records the run id in the sweep marker, not just the 201', () => {
    const { calls } = runBridge(
      { GH_STUB_SEARCH: '2026-10-14T02:14:15Z 818', GH_STUB_BODY: 'edited' },
      ['--sweep']
    );
    expect(calls).toContain(`triage-bridge-sweep:818:${signal('edited')}:run-1`);
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

  it('re-dispatches a legacy marker with no run field, migrating it to the new form', () => {
    // R378: a marker written at the 201 before #836 has no run field, so whether
    // its run finished was never recorded. It must not be read as a finished
    // checkpoint; the sweep re-dispatches once and rewrites the marker with the
    // run id, so the next sweep can read the outcome.
    const legacy = `<!-- triage-bridge-sweep:818:${signal('edited')} -->`;
    const { calls, out } = runBridge(
      {
        GH_STUB_SEARCH: '2026-10-14T02:14:15Z 818',
        GH_STUB_BODY: 'edited',
        GH_STUB_SWEEP_MARKER: legacy,
      },
      ['--sweep']
    );
    expect(calls).toContain('DISPATCH');
    expect(calls).toContain(`triage-bridge-sweep:818:${signal('edited')}:run-1`);
    expect(out).toContain('legacy marker');
  });

  it('reads the new final form (empty run field) as a finished checkpoint', () => {
    // The final form is `…:<signal>: -->`; the run field is present and empty.
    // It is a finished checkpoint, not a legacy marker.
    const { calls } = runBridge(
      {
        GH_STUB_SEARCH: '2026-10-14T02:14:15Z 818',
        GH_STUB_BODY: 'edited',
        GH_STUB_SWEEP_MARKER: sweepMarker(818, signal('edited')),
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
    // A deferred issue must not be lost: the pending run field keeps it
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
    expect(deferred.calls).toContain(`triage-bridge-sweep:818:${signal('edited')}:pending`);

    const resumed = runBridge(
      {
        GH_STUB_SEARCH: '2026-10-14T02:14:15Z 818',
        GH_STUB_BODY: 'edited',
        GH_STUB_SWEEP_MARKER: sweepMarker(818, signal('edited'), 'pending'),
        CURL_STUB_RUNS: '{"runs":[]}',
        MAX_INFLIGHT: '1',
      },
      ['--sweep']
    );
    expect(resumed.calls).toContain('DISPATCH');
    expect(resumed.calls).toContain(`triage-bridge-sweep:818:${signal('edited')}:run-1`);
  });

  it('does not rewrite an identical pending marker while the pool stays full', () => {
    // R402: clearing the marker's fields before the capacity check made every
    // full-pool sweep rewrite the same `pending` marker, bumping the issue's
    // update time. With the fields preserved the marker is recognised as
    // identical and left alone.
    const { calls, out } = runBridge(
      {
        GH_STUB_SEARCH: '2026-10-14T02:14:15Z 818',
        GH_STUB_BODY: 'edited',
        GH_STUB_SWEEP_MARKER: sweepMarker(818, signal('edited'), 'pending'),
        CURL_STUB_RUNS: '{"runs":[{"status":"RUNNING"}]}',
        MAX_INFLIGHT: '1',
      },
      ['--sweep']
    );
    expect(out).toContain('deferred');
    expect(calls).not.toContain('POST_MARKER');
    expect(calls).not.toContain('/issues/comments/');
  });
});
