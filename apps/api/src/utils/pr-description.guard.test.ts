import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

/**
 * The PR-description checks, driven against a stub `gh` and the real `jq`:
 *
 *  - `pr-template-guard.sh` is a HARD gate: it fails the check while the body
 *    is missing a required part (Mengapa/Yang diubah/Cara menguji/Kriteria
 *    penerimaan, a linked ready issue, Indonesian prose, and — on a risky PR
 *    only — a `## Risiko` statement, #965), and passes once the body is
 *    complete. Each section also answers to its old English heading, so a body
 *    written before the rename still passes.
 *  - `visual-evidence.sh` asks for before/after visuals only when `apps/web`
 *    changed and no image or video is present in the body, and stays advisory.
 */
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const TEMPLATE = join(REPO_ROOT, '.github', 'scripts', 'pr-template-guard.sh');
const VISUAL = join(REPO_ROOT, '.github', 'scripts', 'visual-evidence.sh');
const WORKFLOW = join(REPO_ROOT, '.github', 'workflows', 'pr-description-checks.yml');

const STUB = `#!/bin/sh
log() { [ -n "\${GH_STUB_LOG:-}" ] && echo "$*" >> "$GH_STUB_LOG"; }
case "$1" in
  pr)
    case "$*" in
      *"--json files,body"*) printf '%s\\n' "\${GH_STUB_PRJSON-}" ;;
      *"--json labels"*) [ "\${GH_STUB_PRLABELS_FAIL:-}" = "1" ] && exit 1; printf '%s\\n' "\${GH_STUB_PRLABELS-}" ;;
      *"--json body"*) printf '%s\\n' "\${GH_STUB_BODY-}" ;;
      *"comment"*)
        log "COMMENT $*"
        # Log the reminder itself too, so a test can read what it says.
        prev=""; for a in "$@"; do [ "$prev" = "--body-file" ] && log "COMMENTBODY $(cat "$a")"; prev="$a"; done
        [ "\${GH_STUB_WRITE_FAIL:-}" = "1" ] && exit 1 ;;
    esac ;;
  api)
    case "$*" in
      *"comments?per_page"*)
        # The marker comment is on a later page, so it is only found when the
        # caller paginates.
        case "$*" in *--paginate*) [ -n "\${GH_STUB_CID:-}" ] && printf '%s\\n' "\$GH_STUB_CID" ;; esac ;;
      *"-X PATCH"*)
        # Resolve the body the way gh does: only a typed field (-F) reads
        # \`@file\`; a raw field (-f) sends the text as written.
        body=""; prev=""
        for a in "$@"; do
          case "$prev" in
            -F) case "$a" in body=@*) body=$(cat "\${a#body=@}") ;; body=*) body="\${a#body=}" ;; esac ;;
            -f) case "$a" in body=*) body="\${a#body=}" ;; esac ;;
          esac
          prev="$a"
        done
        log "PATCH $*"; log "PATCHBODY $body"
        [ "\${GH_STUB_WRITE_FAIL:-}" = "1" ] && exit 1 ;;
      *"-X DELETE"*) log "DELETE $*"; [ "\${GH_STUB_WRITE_FAIL:-}" = "1" ] && exit 1 ;;
      *"/pulls/"*"/files"*)
        # The PR's changed files, one per line; only read when paginated.
        [ "\${GH_STUB_FILES_FAIL:-}" = "1" ] && exit 1
        case "$*" in *--paginate*) printf '%s\\n' "\${GH_STUB_FILES-}" ;; esac ;;
      *"/issues/"*)
        # The lookup of one linked issue: "<state> <issue|pr> <labels CSV>".
        # GH_STUB_ISSUE_<n> answers for issue n; otherwise an open issue
        # carrying GH_STUB_LABELS. GH_STUB_ISSUE_FAIL=<n> makes n unreadable.
        n=$(printf '%s\\n' "$*" | sed -n 's|.*/issues/\\([0-9][0-9]*\\).*|\\1|p')
        log "ISSUE $n"
        [ "\${GH_STUB_ISSUE_FAIL:-}" = "$n" ] && exit 1
        eval "v=\\\${GH_STUB_ISSUE_$n-}"
        if [ -n "$v" ]; then printf '%s\\n' "$v"; else printf 'open issue %s\\n' "\${GH_STUB_LABELS:-}"; fi ;;
    esac ;;
esac
exit 0
`;

let dir: string;
let log: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'pr-desc-guards-'));
  writeFileSync(join(dir, 'gh'), STUB, { mode: 0o755 });
  log = join(dir, 'calls.log');
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function run(script: string, env: Record<string, string>) {
  writeFileSync(log, '');
  const r = spawnSync('sh', [script, '7'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      REPO: 'o/r',
      GH_TOKEN: 'x',
      GH_STUB_LOG: log,
      // The linked issue answers the label lookup; a body with `Fixes #12` is
      // only complete when that issue is ready for development.
      GH_STUB_LABELS: 'ready',
      ...env,
    },
  });
  return {
    status: r.status ?? -1,
    out: `${r.stdout}${r.stderr}`,
    calls: existsSync(log) ? readFileSync(log, 'utf8') : '',
  };
}

const RISK = 'Rendah: hanya endpoint health yang berubah, dan revert satu commit mengembalikannya.';

const COMPLETE = `## Mengapa

Endpoint health berbohong tentang keadaan basis data.

## Yang diubah

- memeriksa basis data sebelum menjawab

## Linked issue

Fixes #12

## Kriteria penerimaan

- [x] menjawab 503 ketika pemeriksaan gagal

## Cara menguji

pnpm --filter api test

## Risiko

${RISK}
`;

describe('pr-template-guard.sh', () => {
  it('fails the check when the description is incomplete', () => {
    const { status, calls } = run(TEMPLATE, { GH_STUB_BODY: '## Mengapa\n\nSomething broke.' });
    expect(status).toBe(1);
    expect(calls).toContain('COMMENT');
  });

  it('passes when the description is complete', () => {
    const { status, calls } = run(TEMPLATE, { GH_STUB_BODY: COMPLETE });
    expect(status).toBe(0);
    expect(calls).not.toContain('COMMENT');
    expect(calls).not.toContain('PATCH');
  });

  // A body typed in an editor that writes CRLF arrives as `## Mengapa\r`, which is
  // never equal to the `## Mengapa` the section matcher compares against — a
  // complete body was refused with every section listed as missing. PR #726.
  it('reads a CRLF body as complete', () => {
    const { status, calls } = run(TEMPLATE, { GH_STUB_BODY: COMPLETE.replace(/\n/g, '\r\n') });
    expect(status).toBe(0);
    expect(calls).not.toContain('COMMENT');
  });

  // #866/#965: the guard used to strip fenced code before reading sections, so
  // a `## Cara menguji` that was only a block of commands read as empty.
  it('reads a How to test that is only a fenced block of commands as complete', () => {
    const fenced = COMPLETE.replace(
      'pnpm --filter api test\n',
      '```bash\npnpm --filter api test\n```\n'
    );
    const { status, calls } = run(TEMPLATE, { GH_STUB_BODY: fenced });
    expect(status).toBe(0);
    expect(calls).not.toContain('COMMENT');
  });

  it('leaves fenced code out of the language check', () => {
    // English commands in a fence say nothing about the description's language,
    // and an Indonesian body with them still passes.
    const withCode = COMPLETE.replace(
      'pnpm --filter api test\n',
      'Jalankan perintah ini:\n\n```bash\n# the test that should fail before the fix\npnpm --filter api test\n```\n'
    );
    expect(run(TEMPLATE, { GH_STUB_BODY: withCode }).status).toBe(0);
  });

  it('still accepts a body written with the old HUMAN/AGENT template', () => {
    const old = `## HUMAN\n\nSaya menjalankan tes API dan mencoba alur yang berubah.\n\n## AGENT\n\n${COMPLETE}`;
    expect(run(TEMPLATE, { GH_STUB_BODY: old }).status).toBe(0);
  });

  it('still accepts a body written with the old English headings', () => {
    // The headings were renamed to Indonesian; a body written before the rename
    // (or by an automation that still emits the English names) must still pass.
    const english = COMPLETE.replace('## Mengapa', '## Why')
      .replace('## Yang diubah', '## What changed')
      .replace('## Kriteria penerimaan', '## Acceptance criteria')
      .replace('## Cara menguji', '## How to test')
      .replace('## Risiko', '## Risk and rollback');
    expect(run(TEMPLATE, { GH_STUB_BODY: english }).status).toBe(0);
  });

  it('still fails a CRLF body that is missing a section', () => {
    const missing = COMPLETE.replace(/## Yang diubah\r?\n\r?\n[^\n]*\n/, '');
    const { status, calls } = run(TEMPLATE, { GH_STUB_BODY: missing.replace(/\n/g, '\r\n') });
    expect(status).toBe(1);
    expect(calls).toContain('COMMENT');
  });

  // A risky PR states what can break and how to undo it (#965, replacing the
  // free-form `## HUMAN` note of #760); every PR still needs an approval.
  describe('the risk statement on a risky PR', () => {
    // COMPLETE's Indonesian function words sit in its risk statement, so the
    // body without one gets an Indonesian sentence of its own (the language
    // check is not what these tests are about).
    const NO_RISK = COMPLETE.replace(
      RISK,
      '<!-- Wajib bila PR berisiko: apa yang bisa rusak dan cara mengembalikannya. -->'
    ).replace('## Mengapa\n\n', '## Mengapa\n\nIni perbaikan yang kecil dan terukur. ');

    it('is not required on an ordinary PR', () => {
      const { status, calls } = run(TEMPLATE, {
        GH_STUB_BODY: NO_RISK,
        GH_STUB_PRLABELS: 'bug,priority:medium',
        GH_STUB_FILES: 'apps/api/src/modules/marketing/roi.service.ts\ndocs/ARCHITECTURE.md',
      });
      expect(status).toBe(0);
      expect(calls).not.toContain('COMMENT');
    });

    it.each([
      ['labelled security', { GH_STUB_PRLABELS: 'bug,security' }, 'berlabel `security`'],
      [
        'touching a migration',
        { GH_STUB_FILES: 'docs/x.md\napps/api/prisma/migrations/20261010_x/migration.sql' },
        'apps/api/prisma/migrations/20261010_x/migration.sql',
      ],
      [
        'touching a production data script',
        { GH_STUB_FILES: 'apps/api/scripts/require-password-change-all.ts' },
        'apps/api/scripts/require-password-change-all.ts',
      ],
      [
        'touching the API auth middleware',
        { GH_STUB_FILES: 'apps/api/src/middleware/auth.ts' },
        'apps/api/src/middleware/auth.ts',
      ],
      [
        'touching role permissions',
        { GH_STUB_FILES: 'apps/api/src/modules/roles/permissions.ts' },
        'apps/api/src/modules/roles/permissions.ts',
      ],
      [
        'touching the student scope',
        { GH_STUB_FILES: 'apps/api/src/utils/student-scope.ts' },
        'apps/api/src/utils/student-scope.ts',
      ],
      [
        'touching the web route guard',
        { GH_STUB_FILES: 'apps/web/src/lib/rbac.ts' },
        'apps/web/src/lib/rbac.ts',
      ],
      [
        'touching the shared role groups',
        { GH_STUB_FILES: 'packages/shared/src/roles.ts' },
        'packages/shared/src/roles.ts',
      ],
      ['whose labels cannot be read', { GH_STUB_PRLABELS_FAIL: '1' }, 'label PR tidak terbaca'],
      ['whose files cannot be read', { GH_STUB_FILES_FAIL: '1' }, 'daftar berkas PR tidak terbaca'],
    ])('is required on a PR %s, and the reminder names why', (_name, env, reason) => {
      const { status, calls } = run(TEMPLATE, { GH_STUB_BODY: NO_RISK, ...env });
      expect(status).toBe(1);
      expect(calls).toContain('COMMENTBODY');
      expect(calls).toContain('## Risiko');
      expect(calls).toContain(reason);
    });

    it('is satisfied by a risk statement on a risky PR', () => {
      const { status } = run(TEMPLATE, {
        GH_STUB_BODY: COMPLETE,
        GH_STUB_PRLABELS: 'security',
        GH_STUB_FILES: 'apps/api/prisma/schema.prisma',
      });
      expect(status).toBe(0);
    });

    it('does not call a guide under the prisma folder risky (#765)', () => {
      const { status, calls } = run(TEMPLATE, {
        GH_STUB_BODY: NO_RISK,
        GH_STUB_FILES: 'apps/api/prisma/AGENTS.md\ndocs/DEPLOYMENT.md',
      });
      expect(status).toBe(0);
      expect(calls).not.toContain('COMMENT');
    });

    it('still asks for it when the guide comes with the schema', () => {
      const { status, calls } = run(TEMPLATE, {
        GH_STUB_BODY: NO_RISK,
        GH_STUB_FILES: 'apps/api/prisma/AGENTS.md\napps/api/prisma/schema.prisma',
      });
      expect(status).toBe(1);
      expect(calls).toContain('apps/api/prisma/schema.prisma');
    });

    it('does not mistake a test beside the auth middleware for the middleware', () => {
      const { status } = run(TEMPLATE, {
        GH_STUB_BODY: NO_RISK,
        GH_STUB_FILES: 'apps/api/src/middleware/auth.guards.test.ts',
      });
      expect(status).toBe(0);
    });
  });

  it('fails when the description reads as English', () => {
    const english = COMPLETE.replace(
      RISK,
      'Low: only the health endpoint changes, and one revert undoes it.'
    )
      .replace(
        'Endpoint health berbohong tentang keadaan basis data.',
        'The health endpoint lied about the database.'
      )
      .replace('memeriksa basis data sebelum menjawab', 'probe the database before answering')
      .replace('menjawab 503 ketika pemeriksaan gagal', 'answers 503 when the probe fails');
    const { status, calls } = run(TEMPLATE, { GH_STUB_BODY: english });
    expect(status).toBe(1);
    expect(calls).toContain('COMMENT');
  });

  it('fails an English body even when a word merely contains an Indonesian word', () => {
    // `ini` sits inside "initial". The Indonesian match must be word-anchored,
    // or an English body that happens to contain such a substring would pass.
    const english =
      COMPLETE.replace(RISK, 'Low: only the health endpoint changes, and one revert undoes it.')
        .replace(
          'Endpoint health berbohong tentang keadaan basis data.',
          'The health endpoint lied about the database.'
        )
        .replace('memeriksa basis data sebelum menjawab', 'probe the database before answering')
        .replace('menjawab 503 ketika pemeriksaan gagal', 'answers 503 when the probe fails') +
      '\nInitial rollout only.\n';
    const { status, calls } = run(TEMPLATE, { GH_STUB_BODY: english });
    expect(status).toBe(1);
    expect(calls).toContain('COMMENT');
  });

  it('passes an English body that says English is intended', () => {
    const english = COMPLETE.replace(
      RISK,
      'Low: only the health endpoint changes, and one revert undoes it.\n\nEnglish is intended.'
    )
      .replace(
        'Endpoint health berbohong tentang keadaan basis data.',
        'The health endpoint lied about the database.'
      )
      .replace('memeriksa basis data sebelum menjawab', 'probe the database before answering')
      .replace('menjawab 503 ketika pemeriksaan gagal', 'answers 503 when the probe fails');
    const { status } = run(TEMPLATE, { GH_STUB_BODY: english });
    expect(status).toBe(0);
  });

  it('fails when the linked issue is not ready for development', () => {
    const { status, calls } = run(TEMPLATE, {
      GH_STUB_BODY: COMPLETE,
      GH_STUB_LABELS: 'question',
    });
    expect(status).toBe(1);
    expect(calls).toContain('COMMENT');
  });

  it('treats an untouched template placeholder as missing content', () => {
    const placeholder = `## Risiko

<!-- Wajib bila PR berisiko: apa yang bisa rusak dan cara mengembalikannya. -->

## Mengapa

<!-- The problem and its motivation. -->
`;
    const { status, calls } = run(TEMPLATE, { GH_STUB_BODY: placeholder });
    expect(status).toBe(1);
    expect(calls).toContain('COMMENT');
  });

  it('treats a lone list marker as a missing change summary', () => {
    // The template's `## Yang diubah` ships a bare "-"; leaving it there is not
    // a change summary, so the check must still fail.
    const bareDash = COMPLETE.replace('- memeriksa basis data sebelum menjawab', '-');
    const { status, calls } = run(TEMPLATE, { GH_STUB_BODY: bareDash });
    expect(status).toBe(1);
    expect(calls).toContain('COMMENT');
  });

  it('removes an earlier reminder once the description is complete', () => {
    // GH_STUB_CID is only returned when the lookup paginates, so this also
    // proves the marker is found past the first page of comments.
    const { status, calls } = run(TEMPLATE, { GH_STUB_BODY: COMPLETE, GH_STUB_CID: '555' });
    expect(status).toBe(0);
    expect(calls).toContain('DELETE');
    expect(calls).not.toContain('COMMENT');
  });

  it('updates an earlier reminder in place with the reminder itself', () => {
    // The update path: a reminder is already there and the body is still
    // incomplete. The comment must keep its marker and text — a raw \`-f\` field
    // turned it into the literal "@/tmp/…/out" on every update.
    const { calls } = run(TEMPLATE, {
      GH_STUB_BODY: '## Mengapa\n\nSomething broke.',
      GH_STUB_CID: '555',
    });
    expect(calls).toContain('PATCH');
    expect(calls).not.toContain('COMMENT');
    expect(calls).toContain('PATCHBODY <!-- pr-template-guard -->');
    expect(calls).toContain('Deskripsi pull request ini belum lengkap');
    expect(calls).not.toMatch(/PATCHBODY @/);
  });

  describe('the linked issues (#772)', () => {
    it('fails a body that says there is no linked issue: a PR starts from an issue', () => {
      const none = COMPLETE.replace('Fixes #12', 'Tanpa issue tertaut — sebuah chore.');
      const { status, calls } = run(TEMPLATE, { GH_STUB_BODY: none });
      expect(status).toBe(1);
      expect(calls).toContain('PR tanpa issue tidak diterima');
    });

    it('does not count a mention without a closing keyword as a link', () => {
      const mention = COMPLETE.replace('Fixes #12', 'Refs #12');
      const { status, calls } = run(TEMPLATE, { GH_STUB_BODY: mention });
      expect(status).toBe(1);
      expect(calls).toContain('PR tanpa issue tidak diterima');
    });

    it('does not read a closing keyword inside another word as a link', () => {
      // "prefix", "hotfix", "disclose" and "suffixes" end in a keyword; none of
      // them links an issue, so a body naming no issue still fails even when
      // the numbers happen to be open, ready issues.
      const glued = COMPLETE.replace(
        'Fixes #12',
        'Lihat prefix #12, hotfix #15, disclose #14, dan suffixes #13.'
      );
      const { status, calls } = run(TEMPLATE, { GH_STUB_BODY: glued });
      expect(status).toBe(1);
      expect(calls).toContain('PR tanpa issue tidak diterima');
      expect(calls).not.toMatch(/^ISSUE /m);
    });

    it('still reads a keyword after punctuation or at the start of a line', () => {
      const punctuated = COMPLETE.replace('Fixes #12', '(fixes #12)\nCloses #13.');
      const { status, calls } = run(TEMPLATE, { GH_STUB_BODY: punctuated });
      expect(status).toBe(0);
      expect(calls).toMatch(/^ISSUE 12$/m);
      expect(calls).toMatch(/^ISSUE 13$/m);
    });

    it('checks every issue the PR closes, not only the first', () => {
      const two = COMPLETE.replace('Fixes #12', 'Fixes #12\nFixes #13');
      const { status, calls } = run(TEMPLATE, {
        GH_STUB_BODY: two,
        GH_STUB_ISSUE_13: 'open issue question',
      });
      expect(status).toBe(1);
      expect(calls).toContain('issue tertaut #13 harus berlabel');
      expect(calls).not.toContain('#12 harus');
    });

    it('accepts an in-progress issue, so a PR the bot claimed can still merge', () => {
      // `Tiket jadi PR` (SDLC 06) moves the issue `ready` -> `in-progress` as it
      // opens the PR, so the gate must treat that as claimed, not unready.
      const { status } = run(TEMPLATE, {
        GH_STUB_BODY: COMPLETE,
        GH_STUB_ISSUE_12: 'open issue bug,in-progress',
      });
      expect(status).toBe(0);
    });

    it('rejects an issue that is in-progress and also blocked or in question', () => {
      // `label-guard` strips only `ready`, so `in-progress` can sit beside
      // `blocked`/`question`. A claimed-but-unstartable issue is not a green
      // light: `blocked`/`question` are checked before `ready`/`in-progress`.
      for (const labels of [
        'open issue bug,in-progress,blocked',
        'open issue bug,in-progress,question',
      ]) {
        const { status, calls } = run(TEMPLATE, {
          GH_STUB_BODY: COMPLETE,
          GH_STUB_ISSUE_12: labels,
        });
        expect(status, labels).toBe(1);
        expect(calls, labels).toContain('bukan `question`/`blocked`');
      }
    });

    it('still rejects an issue that is only in question or blocked', () => {
      for (const labels of ['open issue bug,question', 'open issue bug,blocked']) {
        const { status, calls } = run(TEMPLATE, {
          GH_STUB_BODY: COMPLETE,
          GH_STUB_ISSUE_12: labels,
        });
        expect(status).toBe(1);
        expect(calls).toContain('harus berlabel');
      }
    });

    it('passes when every issue the PR closes is open and ready, looking each up once', () => {
      const several = COMPLETE.replace('Fixes #12', 'Fixes #12, closes #13\nResolves #12');
      const { status, calls } = run(TEMPLATE, {
        GH_STUB_BODY: several,
        GH_STUB_ISSUE_13: 'open issue bug,ready',
      });
      expect(status).toBe(0);
      expect(calls.match(/^ISSUE 12$/gm)).toHaveLength(1);
      expect(calls.match(/^ISSUE 13$/gm)).toHaveLength(1);
    });

    it('fails when a linked number is a pull request, not an issue', () => {
      const { status, calls } = run(TEMPLATE, {
        GH_STUB_BODY: COMPLETE,
        GH_STUB_ISSUE_12: 'open pr ready',
      });
      expect(status).toBe(1);
      expect(calls).toContain('#12 adalah pull request');
    });

    it('fails when a linked issue is already closed', () => {
      const { status, calls } = run(TEMPLATE, {
        GH_STUB_BODY: COMPLETE,
        GH_STUB_ISSUE_12: 'closed issue ready',
      });
      expect(status).toBe(1);
      expect(calls).toContain('issue #12 sudah tertutup');
    });

    it('fails when a linked issue cannot be read', () => {
      const { status, calls } = run(TEMPLATE, {
        GH_STUB_BODY: COMPLETE,
        GH_STUB_ISSUE_FAIL: '12',
      });
      expect(status).toBe(1);
      expect(calls).toContain('#12 tidak ditemukan');
    });

    it('reads an issue with no labels as not ready', () => {
      const { status, calls } = run(TEMPLATE, {
        GH_STUB_BODY: COMPLETE,
        GH_STUB_ISSUE_12: 'open issue ',
      });
      expect(status).toBe(1);
      expect(calls).toContain('(sekarang: tidak ada)');
    });

    it('tells a PR into another branch that its closing keyword closes nothing', () => {
      const { status, calls } = run(TEMPLATE, {
        GH_STUB_BODY: COMPLETE,
        BASE_REF: 'feat/induk',
        DEFAULT_BRANCH: 'main',
      });
      expect(status).toBe(1);
      expect(calls).toContain('PR ini menuju `feat/induk`, bukan `main`');
    });

    it('passes a PR into the default branch', () => {
      const { status } = run(TEMPLATE, {
        GH_STUB_BODY: COMPLETE,
        BASE_REF: 'main',
        DEFAULT_BRANCH: 'main',
      });
      expect(status).toBe(0);
    });
  });

  it('still fails the check when the reminder cannot be posted', () => {
    const { status, out } = run(TEMPLATE, {
      GH_STUB_BODY: '## Mengapa\n\nSomething broke.',
      GH_STUB_WRITE_FAIL: '1',
    });
    expect(status).toBe(1);
    expect(out).toContain('could not post');
  });
});

describe('pr-description-checks.yml (#772)', () => {
  // The template job alone, from its header to the next job, comments dropped:
  // they explain why `github.actor` and `user.type` are not used.
  const templateJob = () => {
    const yml = readFileSync(WORKFLOW, 'utf8');
    return yml
      .slice(yml.indexOf('  template:'), yml.indexOf('  visual:'))
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n');
  };

  it('skips only Dependabot, keyed on the PR author rather than the last pusher', () => {
    const job = templateJob();
    expect(job).toMatch(
      /^\s+if: github\.event\.pull_request\.user\.login != 'dependabot\[bot\]'$/m
    );
    expect(job).not.toMatch(/github\.actor/);
    expect(job).not.toMatch(/user\.type/);
  });

  it('hands the guard the base and default branches', () => {
    const job = templateJob();
    expect(job).toContain('BASE_REF: ${{ github.event.pull_request.base.ref }}');
    expect(job).toContain('DEFAULT_BRANCH: ${{ github.event.repository.default_branch }}');
  });
});

describe('visual-evidence.sh', () => {
  const pr = (files: string[], body: string) =>
    JSON.stringify({ files: files.map((p) => ({ path: p })), body });

  it('asks for before/after visuals when apps/web changed and none are present', () => {
    const { status, calls } = run(VISUAL, {
      GH_STUB_PRJSON: pr(['apps/web/src/app/page.tsx'], 'Fixes #1'),
    });
    expect(status).toBe(0);
    expect(calls).toContain('COMMENT');
  });

  it('is silent when the body has both a before and an after image', () => {
    const body =
      'Before: ![old](https://user-images.githubusercontent.com/1/1.png)\n' +
      'After: ![new](https://user-images.githubusercontent.com/1/2.png)';
    const { calls } = run(VISUAL, {
      GH_STUB_PRJSON: pr(['apps/web/src/app/page.tsx'], body),
    });
    expect(calls).not.toContain('COMMENT');
  });

  it('is silent on an Indonesian before/after pair', () => {
    const body =
      '**Sebelum**\n![old](https://user-images.githubusercontent.com/1/1.png)\n\n' +
      '**Sesudah**\n![new](https://user-images.githubusercontent.com/1/2.png)';
    const { calls } = run(VISUAL, {
      GH_STUB_PRJSON: pr(['apps/web/src/app/page.tsx'], body),
    });
    expect(calls).not.toContain('COMMENT');
  });

  it('is silent on a before/after pair behind Markdown list bullets', () => {
    // `- **Before**` / `- **After**` is how most bodies and the reminder text
    // itself write the pair; the marker used to miss the bullet, read both
    // images as "before", and keep the reminder up (#983 review).
    const body =
      '- **Before** ![old](https://user-images.githubusercontent.com/1/1.png)\n' +
      '- **After** ![new](https://user-images.githubusercontent.com/1/2.png)';
    const { calls } = run(VISUAL, {
      GH_STUB_PRJSON: pr(['apps/web/src/app/page.tsx'], body),
    });
    expect(calls).not.toContain('COMMENT');
  });

  it('is silent on the Indonesian list-bullet form the reminder asks for', () => {
    const body =
      '- **Sebelum** ![old](https://user-images.githubusercontent.com/1/1.png)\n' +
      '- **Sesudah** ![new](https://user-images.githubusercontent.com/1/2.png)';
    const { calls } = run(VISUAL, {
      GH_STUB_PRJSON: pr(['apps/web/src/app/page.tsx'], body),
    });
    expect(calls).not.toContain('COMMENT');
  });

  it('does not split on a bullet sentence that merely starts with "Sesudah"', () => {
    // A test step written as `- Sesudah pengujian, periksa layar` used to match
    // the list-bullet marker, split the body before the visuals, and read both
    // images as "after" — a complete pair still got the reminder (#983 review).
    const body =
      '- Sesudah pengujian, periksa layar dashboard.\n\n' +
      '- **Sebelum** ![old](https://user-images.githubusercontent.com/1/1.png)\n' +
      '- **Sesudah** ![new](https://user-images.githubusercontent.com/1/2.png)';
    const { calls } = run(VISUAL, {
      GH_STUB_PRJSON: pr(['apps/web/src/app/page.tsx'], body),
    });
    expect(calls).not.toContain('COMMENT');
  });

  it('does not split on a plain sentence that merely starts with "After"', () => {
    const body =
      'After the deploy finishes, check the dashboard.\n\n' +
      'Before: ![old](https://user-images.githubusercontent.com/1/1.png)\n' +
      'After: ![new](https://user-images.githubusercontent.com/1/2.png)';
    const { calls } = run(VISUAL, {
      GH_STUB_PRJSON: pr(['apps/web/src/app/page.tsx'], body),
    });
    expect(calls).not.toContain('COMMENT');
  });

  it('is silent when each side is a bare image URL after the label', () => {
    // `After https://…` (no Markdown, no colon) is a legitimate marker; the
    // marker used to skip it because a letter follows the space, so both URLs
    // fell into the before region and a complete pair still got the reminder
    // (#983 review).
    const body =
      'Before https://user-images.githubusercontent.com/1/1.png\n' +
      'After https://user-images.githubusercontent.com/1/2.png';
    const { calls } = run(VISUAL, {
      GH_STUB_PRJSON: pr(['apps/web/src/app/page.tsx'], body),
    });
    expect(calls).not.toContain('COMMENT');
  });

  it('is silent on the Indonesian bare-URL pair behind list bullets', () => {
    const body =
      '- Sebelum https://user-images.githubusercontent.com/1/1.png\n' +
      '- Sesudah https://user-images.githubusercontent.com/1/2.png';
    const { calls } = run(VISUAL, {
      GH_STUB_PRJSON: pr(['apps/web/src/app/page.tsx'], body),
    });
    expect(calls).not.toContain('COMMENT');
  });

  it('still asks when a bare-URL body has only the after side', () => {
    const body = 'After https://user-images.githubusercontent.com/1/2.png';
    const { status, calls } = run(VISUAL, {
      GH_STUB_PRJSON: pr(['apps/web/src/app/page.tsx'], body),
    });
    expect(status).toBe(0);
    expect(calls).toContain('COMMENT');
  });

  it('does not split on a bare non-visual link after the marker', () => {
    // `After https://preview.example.org` is a link, not a visual; matching it
    // split the body before the real screenshots, so a complete pair still got
    // the reminder (#983 review).
    const body =
      'After https://preview.example.org\n\n' +
      'Before: ![old](https://user-images.githubusercontent.com/1/1.png)\n' +
      'After: ![new](https://user-images.githubusercontent.com/1/2.png)';
    const { calls } = run(VISUAL, {
      GH_STUB_PRJSON: pr(['apps/web/src/app/page.tsx'], body),
    });
    expect(calls).not.toContain('COMMENT');
  });

  it('recognises a bare media URL on a non-GitHub host', () => {
    const body =
      'Before https://cdn.example.com/old.png\n' + 'After https://cdn.example.com/new.png';
    const { calls } = run(VISUAL, {
      GH_STUB_PRJSON: pr(['apps/web/src/app/page.tsx'], body),
    });
    expect(calls).not.toContain('COMMENT');
  });

  it('does not split on "after" inside a sentence before the visuals', () => {
    // A `## Cara menguji` line such as "... after it passes" used to split the
    // body at that line, hiding a real before/after pair (#982).
    const body =
      'Jalankan build, lalu after it passes buka dashboard.\n\n' +
      '**Sebelum**\n![old](https://user-images.githubusercontent.com/1/1.png)\n\n' +
      '**Sesudah**\n![new](https://user-images.githubusercontent.com/1/2.png)';
    const { calls } = run(VISUAL, {
      GH_STUB_PRJSON: pr(['apps/web/src/app/page.tsx'], body),
    });
    expect(calls).not.toContain('COMMENT');
  });

  it('is silent when both visuals use GitHub attachment links', () => {
    const body =
      'Before: ![old](https://github.com/user-attachments/assets/11111111-1111-1111-1111-111111111111)\n' +
      'After: ![new](https://github.com/user-attachments/assets/22222222-2222-2222-2222-222222222222)';
    const { calls } = run(VISUAL, {
      GH_STUB_PRJSON: pr(['apps/web/src/app/page.tsx'], body),
    });
    expect(calls).not.toContain('COMMENT');
  });

  it('still asks when only an after image is present', () => {
    const body = 'After: ![shot](https://user-images.githubusercontent.com/1/2.png)';
    const { status, calls } = run(VISUAL, {
      GH_STUB_PRJSON: pr(['apps/web/src/app/page.tsx'], body),
    });
    expect(status).toBe(0);
    expect(calls).toContain('COMMENT');
  });

  it('removes the reminder once both visuals are added', () => {
    const body =
      'Before: ![old](https://user-images.githubusercontent.com/1/1.png)\n' +
      'After: ![new](https://user-images.githubusercontent.com/1/2.png)';
    const { calls } = run(VISUAL, {
      GH_STUB_PRJSON: pr(['apps/web/src/app/page.tsx'], body),
      GH_STUB_CID: '42',
    });
    expect(calls).toContain('DELETE');
  });

  it('updates an earlier reminder in place with the reminder itself', () => {
    const { calls } = run(VISUAL, {
      GH_STUB_PRJSON: pr(['apps/web/src/app/page.tsx'], 'Fixes #1'),
      GH_STUB_CID: '42',
    });
    expect(calls).toContain('PATCH');
    expect(calls).not.toContain('COMMENT');
    expect(calls).toContain('PATCHBODY <!-- visual-evidence -->');
    expect(calls).toContain('tangkapan visual sebelum dan sesudah');
    expect(calls).not.toMatch(/PATCHBODY @/);
  });

  it('is silent when prose bullets precede a before/after table (#1033)', () => {
    // The reproduction steps are written as bullets (`- **Sesudah** — POST …
    // 201`) *above* the `| Sebelum | Sesudah |` screenshot table. The old marker
    // accepted the trailing em dash as punctuation, split the body at that
    // bullet, and read the Before region as empty — a complete pair still got
    // the reminder. The check now counts media and looks for labels, so prose
    // cannot move a boundary.
    const U = 'https://user-images.githubusercontent.com/1';
    const body =
      '- **Sebelum** — `PUT /api/portfolio/<id>` dijawab 400.\n' +
      '- **Sesudah** — `POST /portfolio` dijawab 201.\n\n' +
      '| Sebelum | Sesudah |\n|---|---|\n' +
      `| ![a](${U}/1.png) | ![b](${U}/2.png) |`;
    const { calls } = run(VISUAL, {
      GH_STUB_PRJSON: pr(['apps/web/src/app/page.tsx'], body),
    });
    expect(calls).not.toContain('COMMENT');
  });

  it('asks when both images sit on the after side and before is only text', () => {
    // Two media plus two labels used to be enough, so `- **Sebelum** — no image`
    // beside two after shots cleared the reminder with no before evidence.
    const U = 'https://user-images.githubusercontent.com/1';
    const body =
      '- **Sebelum** — tidak ada gambar, alurnya sama.\n' +
      `- **Sesudah** — ![a](${U}/1.png) ![b](${U}/2.png)`;
    const { status, calls } = run(VISUAL, {
      GH_STUB_PRJSON: pr(['apps/web/src/app/page.tsx'], body),
    });
    expect(status).toBe(0);
    expect(calls).toContain('COMMENT');
  });

  it('asks when only the before side carries an image', () => {
    const U = 'https://user-images.githubusercontent.com/1';
    const body = `- **Sebelum** — ![a](${U}/1.png)\n` + '- **Sesudah** — belum ada tangkapan.';
    const { calls } = run(VISUAL, {
      GH_STUB_PRJSON: pr(['apps/web/src/app/page.tsx'], body),
    });
    expect(calls).toContain('COMMENT');
  });

  it('counts a bold table header as a before/after side', () => {
    // `| **Sebelum** | **Sesudah** |` leaves a `**` prefix on the cell, so
    // `side_of` must strip markdown emphasis or the columns map to no side and
    // the images fall back to the prose label above.
    const U = 'https://user-images.githubusercontent.com/1';
    const body =
      '| **Sebelum** | **Sesudah** |\n|---|---|\n' +
      `| ![a](${U}/1.png) | ![b](${U}/2.png) |`;
    const { calls } = run(VISUAL, {
      GH_STUB_PRJSON: pr(['apps/web/src/app/page.tsx'], body),
    });
    expect(calls).not.toContain('COMMENT');
  });

  it('counts an uppercase image extension like a lowercase one', () => {
    // The awk match replaced a case-insensitive `grep -iE`, so `.PNG` must not
    // silently count as zero media.
    const U = 'https://user-images.githubusercontent.com/1';
    const body =
      `- **Sebelum** — ![a](${U}/1.PNG)\n` + `- **Sesudah** — ![b](${U}/2.JPG)`;
    const { calls } = run(VISUAL, {
      GH_STUB_PRJSON: pr(['apps/web/src/app/page.tsx'], body),
    });
    expect(calls).not.toContain('COMMENT');
  });

  it('asks when the body has two images but no before/after labels', () => {
    // Two screenshots with no labelled sides cannot be told apart as a pair;
    // counting media alone would clear the reminder here.
    const U = 'https://user-images.githubusercontent.com/1';
    const body = `![a](${U}/1.png)\n\n![b](${U}/2.png)`;
    const { calls } = run(VISUAL, {
      GH_STUB_PRJSON: pr(['apps/web/src/app/page.tsx'], body),
    });
    expect(calls).toContain('COMMENT');
  });

  it('never asks when no apps/web file changed', () => {
    const { calls } = run(VISUAL, {
      GH_STUB_PRJSON: pr(['apps/api/src/app.ts'], 'Fixes #1'),
    });
    expect(calls).not.toContain('COMMENT');
  });

  it('stays advisory when the reminder cannot be posted', () => {
    const { status, out } = run(VISUAL, {
      GH_STUB_PRJSON: pr(['apps/web/src/app/page.tsx'], 'Fixes #1'),
      GH_STUB_WRITE_FAIL: '1',
    });
    expect(status).toBe(0);
    expect(out).toContain('could not post');
  });
});
