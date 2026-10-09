import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

/**
 * `.claude/hooks/guard.sh` is the one PreToolUse guard of both agents: Claude
 * Code runs it from `.claude/settings.json`, OpenHands from
 * `.openhands/hooks.json`. Exit 2 refuses the tool call; anything else lets it
 * through. Each refusal below is a mistake the guard exists for, asked in both
 * tools' words (Claude `Bash`/`Write`/`Edit`, OpenHands `terminal`/
 * `file_editor`); each pass is a near miss it must not refuse.
 *
 * Before this test, the push check had been rewritten twice with no committed
 * case: the rewrite let `git -c … push origin main`, `+main` and `--all`
 * through, and an unbalanced quote turned a refused push into an allowed one.
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const GUARD = join(REPO_ROOT, '.claude', 'hooks', 'guard.sh');
// Spelled in two parts: the test names this path, it never reads the file
// (change-scope.guard.test.ts treats a quoted *.md as a file a test reads).
const MEMORY_POINTER = join(REPO_ROOT, '.openhands', 'memory', 'MEMORY' + '.md');
const REFUSED = 2;
const ALLOWED = 0;

let scratch: string;
let feature: string; // a checkout on a feature branch
let onMain: string; // a checkout on main
let tracksMain: string; // a feature branch whose upstream is main

function checkout(dir: string, branch: string, upstream?: string): string {
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });
  execFileSync('git', ['init', '-q', '-b', branch, dir], { stdio: 'ignore' });
  git(
    '-c',
    'user.email=guard@test',
    '-c',
    'user.name=guard',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'init'
  );
  if (upstream) {
    git('config', `branch.${branch}.remote`, 'origin');
    git('config', `branch.${branch}.merge`, `refs/heads/${upstream}`);
  }
  return dir;
}

function guard(event: Record<string, unknown>): { status: number; stderr: string } {
  const r = spawnSync('bash', [GUARD], { input: JSON.stringify(event), encoding: 'utf8' });
  return { status: r.status ?? -1, stderr: r.stderr };
}

/** The same shell command through both tools; both answers must agree. */
function shell(command: string, cwd = feature): number {
  const claude = guard({ tool_name: 'Bash', tool_input: { command }, cwd }).status;
  const openhands = guard({
    tool_name: 'terminal',
    tool_input: { command },
    working_dir: cwd,
  }).status;
  expect(openhands, `OpenHands and Claude disagree on: ${command}`).toBe(claude);
  return claude;
}

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'agent-guard-'));
  feature = checkout(join(scratch, 'feature'), 'feat-x');
  onMain = checkout(join(scratch, 'main'), 'main');
  tracksMain = checkout(join(scratch, 'tracks'), 'feat-y', 'main');
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('a push that lands on main is refused', () => {
  it.each([
    'git push origin main',
    'git push origin HEAD:main',
    'git push origin HEAD:refs/heads/main',
    'git push origin +main',
    'git push -f origin +HEAD:main',
    'git push --all origin',
    'git push --mirror origin',
    'git -c push.default=current push origin main',
    'git push origin main #"',
    'cd /tmp && git push origin main',
    'cd "$HOME" && git push',
  ])('%s', (command) => {
    expect(shell(command)).toBe(REFUSED);
  });

  it('a push naming no destination, on main or tracking it', () => {
    expect(shell('git push', onMain)).toBe(REFUSED);
    expect(shell('git push origin', onMain)).toBe(REFUSED);
    expect(shell('git push -o ci.skip origin', onMain)).toBe(REFUSED);
    expect(shell('git push', tracksMain)).toBe(REFUSED);
    expect(shell(`git -C ${onMain} push`)).toBe(REFUSED);
  });
});

describe('ordinary pushes and mere mentions pass', () => {
  it.each([
    'git push origin feat-x',
    'git push -u origin HEAD',
    'git push -o ci.skip origin feat-x',
    'FOO="x main y" git push origin feat-x',
    'echo "git push origin main"',
    'git commit -m "push to main after review"',
    'git log --oneline origin/main',
  ])('%s', (command) => {
    expect(shell(command)).toBe(ALLOWED);
  });

  it('HEAD names the current branch, even when it tracks main', () => {
    expect(shell('git push -u origin HEAD', tracksMain)).toBe(ALLOWED);
  });
});

describe('the Prisma schema is never rewritten wholesale', () => {
  const schema = join(REPO_ROOT, 'apps', 'api', 'prisma', 'schema.prisma');

  it('a whole-file write is refused, a surgical edit passes', () => {
    expect(
      guard({ tool_name: 'Write', tool_input: { file_path: schema, content: 'x' } }).status
    ).toBe(REFUSED);
    expect(
      guard({
        tool_name: 'file_editor',
        tool_input: { command: 'create', path: schema, file_text: 'x' },
      }).status
    ).toBe(REFUSED);
    expect(
      guard({
        tool_name: 'Edit',
        tool_input: { file_path: schema, old_string: 'a', new_string: 'b' },
      }).status
    ).toBe(ALLOWED);
    expect(
      guard({
        tool_name: 'file_editor',
        tool_input: { command: 'str_replace', path: schema, old_str: 'a', new_str: 'b' },
      }).status
    ).toBe(ALLOWED);
  });

  it.each([
    ['cat /tmp/s > apps/api/prisma/schema.prisma', REFUSED],
    ['cp /tmp/s apps/api/prisma/schema.prisma', REFUSED],
    ['generate | tee apps/api/prisma/schema.prisma', REFUSED],
    ['cat /tmp/model >> apps/api/prisma/schema.prisma', ALLOWED],
    ['cp apps/api/prisma/schema.prisma /tmp/s', ALLOWED],
    ['cat /tmp/s > apps/api/prisma/schema.prisma.bak', ALLOWED],
    ['npx prisma validate --schema apps/api/prisma/schema.prisma 2>&1', ALLOWED],
  ])('%s', (command, expected) => {
    expect(shell(command)).toBe(expected);
  });
});

describe('sensitive text never reaches a markdown file of the repository', () => {
  // Assembled at run time, so no scanner reads this file as a leak.
  const leak = 'see postgres' + 'ql://app:Tr0ub4dor-' + 'x9@db.internal.example/app';
  const note = join(REPO_ROOT, 'docs', 'guard-test-note' + '.md');

  it('refused in either tool, allowed outside a checkout', () => {
    expect(
      guard({ tool_name: 'Write', tool_input: { file_path: note, content: leak } }).status
    ).toBe(REFUSED);
    expect(
      guard({
        tool_name: 'file_editor',
        tool_input: { command: 'create', path: note, file_text: leak },
      }).status
    ).toBe(REFUSED);
    const local = join(scratch, 'memory', 'note' + '.md');
    expect(
      guard({ tool_name: 'Write', tool_input: { file_path: local, content: leak } }).status
    ).toBe(ALLOWED);
    expect(
      guard({ tool_name: 'Write', tool_input: { file_path: note, content: 'harmless' } }).status
    ).toBe(ALLOWED);
  });
});

describe("OpenHands' project memory index is a pointer to .claude/memory/", () => {
  it('a write to it is refused, and the refusal says where the finding goes', () => {
    const r = guard({
      tool_name: 'file_editor',
      tool_input: { command: 'str_replace', path: MEMORY_POINTER, old_str: 'a', new_str: 'b' },
    });
    expect(r.status).toBe(REFUSED);
    expect(r.stderr).toContain('.claude/memory/');
    expect(
      guard({
        tool_name: 'Edit',
        tool_input: { file_path: MEMORY_POINTER, old_string: 'a', new_string: 'b' },
      }).status
    ).toBe(REFUSED);
    expect(shell('echo fact > .openhands/memory/MEMORY.md', REPO_ROOT)).toBe(REFUSED);
  });

  it('reading it, the daily logs and the user tier stay open', () => {
    expect(
      guard({ tool_name: 'file_editor', tool_input: { command: 'view', path: MEMORY_POINTER } })
        .status
    ).toBe(ALLOWED);
    const daily = join(REPO_ROOT, '.openhands', 'memory', '2026-10-09' + '.md');
    expect(
      guard({
        tool_name: 'file_editor',
        tool_input: { command: 'create', path: daily, file_text: 'notes' },
      }).status
    ).toBe(ALLOWED);
    const userTier = join(scratch, '.openhands', 'memory', 'MEMORY' + '.md');
    expect(
      guard({
        tool_name: 'file_editor',
        tool_input: { command: 'create', path: userTier, file_text: 'x' },
      }).status
    ).toBe(ALLOWED);
  });
});
