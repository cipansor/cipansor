import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, posix, resolve } from 'path';

/**
 * `docs/screens/templates-preview/` holds the mockups of the issue and PR
 * templates (#982/#983). The four PNGs were committed with no Markdown file
 * referring to them — 1.19 MB of orphaned binaries that `check-doc-refs.py`
 * lists under ORPHAN but nothing fails on (#986). A fifth one could land the
 * same way. This pins that every image in the folder is embedded by at least
 * one document, so an unreferenced mockup cannot pass the gate again.
 *
 * Three things make the check hold (#986 review):
 *
 *  - One snapshot: every path and its text come from the SAME commit (`git
 *    ls-tree` + `git show HEAD:`). Listing the index while reading HEAD crashed
 *    on a staged-but-uncommitted document — the index named a file HEAD did not
 *    have — so a new document failing locally even though it is unrelated. The
 *    guard checks the committed tree, which is what the gate sees.
 *  - Only a real Markdown embed counts — `![alt](path)` or `<img src="path">` —
 *    not a prose mention of the filename. `includes(needle)` passed on a bare
 *    sentence naming the image, which embeds nothing.
 *  - The path is normalized (`path.posix`): a valid `./screens/x.png` written
 *    from `docs/IDEAS.md` used to build `docs/./screens/…` and miss the image,
 *    reporting a referenced mockup as orphaned.
 *
 * A PNG-only change under the folder must run this guard: `change-scope.sh`
 * classifies `docs/screens/templates-preview/*` as code, so the Tests job is not
 * skipped for a binary-only diff. `change-scope.guard.test.ts` pins that, and
 * the referencing document (`docs/IDEAS.md`) is code too, so removing the last
 * reference also runs the guard.
 */
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const DIR_REL = 'docs/screens/templates-preview';

const git = (root: string, ...args: string[]): string =>
  execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });

/** Every path in the HEAD commit — the index and working tree may differ from it. */
const headPaths = (root: string): string[] =>
  git(root, 'ls-tree', '-r', '--name-only', 'HEAD').split('\n').filter(Boolean);

/** A file's COMMITTED text, so an uncommitted local edit cannot satisfy the check. */
const committedText = (root: string, path: string): string => git(root, 'show', `HEAD:${path}`);

const mockupsIn = (root: string): string[] =>
  headPaths(root).filter((p) => p.startsWith(`${DIR_REL}/`) && p.endsWith('.png'));

/** Image paths a document embeds, as written: `![alt](path)` or `<img src="path">`. */
const IMG_RX = /!\[[^\]]*\]\(([^)\s]+)|<img[^>]+src="([^"]+)"/g;
function embeddedPaths(docText: string): string[] {
  return [...docText.matchAll(IMG_RX)].map((m) => m[1] ?? m[2]);
}

/**
 * The folder images a document embeds. A relative path resolves against the
 * document's directory, a leading `/` against the repo root — the rule
 * `check-doc-refs.py` uses, because a guide writing `screens/x.png` means
 * `docs/screens/x.png`. Both bases are tried and the result is normalized, so
 * `./screens/x.png` and a root-relative link both land on the real path.
 */
function embeddedMockups(docRelPath: string, docText: string, images: Set<string>): Set<string> {
  const dir = posix.dirname(docRelPath);
  const found = new Set<string>();
  for (const raw of embeddedPaths(docText)) {
    const target = raw.split('?')[0].split('#')[0];
    const candidates = target.startsWith('/')
      ? [posix.normalize(target.slice(1))]
      : [posix.normalize(posix.join(dir, target)), posix.normalize(target)];
    for (const candidate of candidates) if (images.has(candidate)) found.add(candidate);
  }
  return found;
}

/** For each folder image, the documents (repo-relative) that embed it. */
function docsByMockup(root: string): Map<string, string[]> {
  const images = new Set(mockupsIn(root));
  const byMockup = new Map<string, string[]>();
  for (const image of images) byMockup.set(image, []);
  for (const doc of headPaths(root).filter((p) => p.endsWith('.md'))) {
    for (const image of embeddedMockups(doc, committedText(root, doc), images)) {
      byMockup.get(image)?.push(doc);
    }
  }
  return byMockup;
}

describe('docs/screens/templates-preview is referenced (#986)', () => {
  const images = mockupsIn(REPO_ROOT);
  const referenced = docsByMockup(REPO_ROOT);

  it('holds the template mockups', () => {
    expect(images.length).toBeGreaterThan(0);
  });

  it.each(images)('embeds %s from a committed Markdown file', (target) => {
    expect(
      referenced.get(target) ?? [],
      `${target} is not embedded by any committed Markdown file — add it to the document ` +
        'that explains the templates (docs/IDEAS.md §6), or do not commit the binary'
    ).not.toHaveLength(0);
  });

  it('counts a real embed, not a prose mention of the filename', () => {
    const [target] = images;
    const name = target.slice(DIR_REL.length + 1);
    const set = new Set(images);
    expect(
      embeddedMockups('docs/IDEAS.md', `![alt](screens/templates-preview/${name})`, set).has(target)
    ).toBe(true);
    expect(
      embeddedMockups(
        'docs/IDEAS.md',
        `Mockups live in docs/screens/templates-preview/${name}.`,
        set
      ).has(target)
    ).toBe(false);
  });

  it('resolves a ./ relative embed instead of reporting the image orphaned', () => {
    const [target] = images;
    const name = target.slice(DIR_REL.length + 1);
    const set = new Set(images);
    expect(
      embeddedMockups('docs/IDEAS.md', `![alt](./screens/templates-preview/${name})`, set).has(
        target
      )
    ).toBe(true);
  });

  it('reads one snapshot: a staged, uncommitted document neither crashes nor counts', () => {
    const repo = mkdtempSync(join(tmpdir(), 'tpl-guard-'));
    const g = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' });
    try {
      execFileSync('git', ['init', '-q', '-b', 'main', repo], { stdio: 'pipe' });
      g('config', 'user.email', 'tpl@test');
      g('config', 'user.name', 'tpl');
      mkdirSync(join(repo, DIR_REL), { recursive: true });
      const image = `${DIR_REL}/01.png`;
      writeFileSync(join(repo, image), 'x');
      mkdirSync(join(repo, 'docs'), { recursive: true });
      writeFileSync(join(repo, 'docs/IDEAS.md'), `![x](screens/templates-preview/01.png)\n`);
      g('add', '-A');
      g('commit', '-q', '-m', 'init');

      // A new document staged but not committed: the index names it, HEAD does
      // not. Reading both from HEAD keeps the two consistent.
      writeFileSync(join(repo, 'docs/STAGED.md'), '# staged, unrelated\n');
      g('add', 'docs/STAGED.md');

      expect(() => docsByMockup(repo)).not.toThrow();
      expect(docsByMockup(repo).get(image)).toEqual(['docs/IDEAS.md']);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
