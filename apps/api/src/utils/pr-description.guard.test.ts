import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

/**
 * The PR-description checks, driven against a stub `gh` and the real `jq`:
 *
 *  - `pr-template-guard.sh` is a HARD gate: it fails the check while the body
 *    is missing a required part (Why/What changed/How to test/Acceptance
 *    criteria, a linked ready issue, Indonesian prose, and — on a risky PR
 *    only — a `## HUMAN` note), and passes once the body is complete.
 *  - `visual-evidence.sh` asks for before/after visuals only when `apps/web`
 *    changed and no image or video is present in the body, and stays advisory.
 */
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const TEMPLATE = join(REPO_ROOT, '.github', 'scripts', 'pr-template-guard.sh');
const VISUAL = join(REPO_ROOT, '.github', 'scripts', 'visual-evidence.sh');

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
        # Label lookup for the linked issue; GH_STUB_LABELS holds the CSV.
        printf '%s\\n' "\${GH_STUB_LABELS:-}" ;;
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

const COMPLETE = `## HUMAN

Saya menjalankan tes API dan mencoba alur yang berubah.

## AGENT

## Why

Endpoint health berbohong tentang keadaan basis data.

## What changed

- memeriksa basis data sebelum menjawab

## Linked issue

Fixes #12

## Acceptance criteria

- [x] menjawab 503 ketika pemeriksaan gagal

## How to test

pnpm --filter api test
`;

describe('pr-template-guard.sh', () => {
  it('fails the check when the description is incomplete', () => {
    const { status, calls } = run(TEMPLATE, { GH_STUB_BODY: '## Why\n\nSomething broke.' });
    expect(status).toBe(1);
    expect(calls).toContain('COMMENT');
  });

  it('passes when the description is complete', () => {
    const { status, calls } = run(TEMPLATE, { GH_STUB_BODY: COMPLETE });
    expect(status).toBe(0);
    expect(calls).not.toContain('COMMENT');
    expect(calls).not.toContain('PATCH');
  });

  // The human note is asked for only where a human must look before the merge
  // (#760); the gate reviews everything else and a human approves the release.
  describe('the human note on a risky PR', () => {
    // COMPLETE's Indonesian function words sit in its human note, so the body
    // without one gets an Indonesian sentence of its own (the language check is
    // not what these tests are about).
    const NO_HUMAN = COMPLETE.replace(
      /## HUMAN\n\n.*\n/,
      '## HUMAN\n\n<!-- Penulis manusia: ganti komentar ini. -->\n'
    ).replace('## Why\n\n', '## Why\n\nIni perbaikan yang kecil dan terukur. ');

    it('is not required on an ordinary PR', () => {
      const { status, calls } = run(TEMPLATE, {
        GH_STUB_BODY: NO_HUMAN,
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
      const { status, calls } = run(TEMPLATE, { GH_STUB_BODY: NO_HUMAN, ...env });
      expect(status).toBe(1);
      expect(calls).toContain('COMMENTBODY');
      expect(calls).toContain('## HUMAN');
      expect(calls).toContain(reason);
    });

    it('is satisfied by a note on a risky PR', () => {
      const { status } = run(TEMPLATE, {
        GH_STUB_BODY: COMPLETE,
        GH_STUB_PRLABELS: 'security',
        GH_STUB_FILES: 'apps/api/prisma/schema.prisma',
      });
      expect(status).toBe(0);
    });

    it('does not call a guide under the prisma folder risky (#765)', () => {
      const { status, calls } = run(TEMPLATE, {
        GH_STUB_BODY: NO_HUMAN,
        GH_STUB_FILES: 'apps/api/prisma/AGENTS.md\ndocs/DEPLOYMENT.md',
      });
      expect(status).toBe(0);
      expect(calls).not.toContain('COMMENT');
    });

    it('still asks for the note when the guide comes with the schema', () => {
      const { status, calls } = run(TEMPLATE, {
        GH_STUB_BODY: NO_HUMAN,
        GH_STUB_FILES: 'apps/api/prisma/AGENTS.md\napps/api/prisma/schema.prisma',
      });
      expect(status).toBe(1);
      expect(calls).toContain('apps/api/prisma/schema.prisma');
    });

    it('does not mistake a test beside the auth middleware for the middleware', () => {
      const { status } = run(TEMPLATE, {
        GH_STUB_BODY: NO_HUMAN,
        GH_STUB_FILES: 'apps/api/src/middleware/auth.guards.test.ts',
      });
      expect(status).toBe(0);
    });
  });

  it('fails when the description reads as English', () => {
    const english = COMPLETE.replace(
      'Saya menjalankan tes API dan mencoba alur yang berubah.',
      'I ran the API tests and walked the changed flow.'
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
      COMPLETE.replace(
        'Saya menjalankan tes API dan mencoba alur yang berubah.',
        'I ran the API tests and walked the changed flow.'
      )
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
      'Saya menjalankan tes API dan mencoba alur yang berubah.',
      'I ran the API tests and walked the changed flow.\n\nEnglish is intended.'
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
      GH_STUB_LABELS: 'needs-info',
    });
    expect(status).toBe(1);
    expect(calls).toContain('COMMENT');
  });

  it('treats an untouched template placeholder as missing content', () => {
    const placeholder = `## HUMAN

<!-- Human author: replace this comment with a short note. -->

## Why

<!-- The problem and its motivation. -->
`;
    const { status, calls } = run(TEMPLATE, { GH_STUB_BODY: placeholder });
    expect(status).toBe(1);
    expect(calls).toContain('COMMENT');
  });

  it('treats a lone list marker as a missing change summary', () => {
    // The template's `## What changed` ships a bare "-"; leaving it there is not
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
      GH_STUB_BODY: '## Why\n\nSomething broke.',
      GH_STUB_CID: '555',
    });
    expect(calls).toContain('PATCH');
    expect(calls).not.toContain('COMMENT');
    expect(calls).toContain('PATCHBODY <!-- pr-template-guard -->');
    expect(calls).toContain('Deskripsi pull request ini belum lengkap');
    expect(calls).not.toMatch(/PATCHBODY @/);
  });

  it('accepts a body that says there is no linked issue', () => {
    const none = COMPLETE.replace('Fixes #12', 'Tanpa issue tertaut — sebuah chore.');
    const { status, calls } = run(TEMPLATE, { GH_STUB_BODY: none });
    expect(status).toBe(0);
    expect(calls).not.toContain('COMMENT');
  });

  it('still fails the check when the reminder cannot be posted', () => {
    const { status, out } = run(TEMPLATE, {
      GH_STUB_BODY: '## Why\n\nSomething broke.',
      GH_STUB_WRITE_FAIL: '1',
    });
    expect(status).toBe(1);
    expect(out).toContain('could not post');
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
    expect(calls).toContain('has no before/after');
    expect(calls).not.toMatch(/PATCHBODY @/);
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
