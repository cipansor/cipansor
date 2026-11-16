import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { resolve } from 'path';

/**
 * `docs/screens/templates-preview/` holds the mockups of the issue and PR
 * templates (#982/#983). The four PNGs were committed with no Markdown file
 * referring to them — 1.19 MB of orphaned binaries that `check-doc-refs.py`
 * lists under ORPHAN but nothing fails on (#986). A fifth one could land the
 * same way. This pins that every image in the folder is embedded by at least
 * one tracked document, so an unreferenced mockup cannot pass the gate again.
 *
 * Two things make the check hold (#986 review):
 *
 *  - Only TRACKED files count. Walking the working tree let a local, uncommitted
 *    document satisfy the guard, so a local run passed without the embed being
 *    committed. `git ls-files` lists what is actually in the tree.
 *  - Only a real Markdown embed counts — `![alt](path)` or `<img src="path">` —
 *    not a prose mention of the filename. `includes(needle)` passed on a bare
 *    sentence naming the image, which embeds nothing.
 *
 * A PNG-only change under the folder must run this guard: `change-scope.sh`
 * classifies `docs/screens/templates-preview/*` as code, so the Tests job is not
 * skipped for a binary-only diff. `change-scope.guard.test.ts` pins that, and
 * the referencing document (`docs/IDEAS.md`) is code too, so removing the last
 * reference also runs the guard.
 */
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const DIR_REL = 'docs/screens/templates-preview';

const git = (...args: string[]): string =>
  execFileSync('git', ['-C', REPO_ROOT, ...args], { encoding: 'utf8' });

/** The repo-relative paths `git ls-files` reports for a pattern (tracked only). */
function tracked(pattern: string): string[] {
  return git('ls-files', '--', pattern).split('\n').filter(Boolean);
}

/** A tracked file's COMMITTED text, so an uncommitted local edit cannot satisfy the check. */
const committedText = (path: string): string => git('show', `HEAD:${path}`);

const mockups = (): string[] => tracked(`${DIR_REL}/*.png`);

/** Image paths a document embeds, as written: `![alt](path)` or `<img src="path">`. */
const IMG_RX = /!\[[^\]]*\]\(([^)\s]+)|<img[^>]+src="([^"]+)"/g;
function embeddedPaths(docText: string): string[] {
  return [...docText.matchAll(IMG_RX)].map((m) => m[1] ?? m[2]);
}

/**
 * The folder images a document embeds. A relative path resolves against the
 * document's directory, a leading `/` against the repo root — the rule
 * `check-doc-refs.py` uses, because a guide writing `screens/x.png` means
 * `docs/screens/x.png`.
 */
function embeddedMockups(docRelPath: string, docText: string): Set<string> {
  const dir = docRelPath.includes('/') ? docRelPath.slice(0, docRelPath.lastIndexOf('/')) : '';
  const images = new Set(mockups());
  const found = new Set<string>();
  for (const raw of embeddedPaths(docText)) {
    const target = raw.split('?')[0].split('#')[0];
    const candidates = target.startsWith('/')
      ? [target.slice(1)]
      : [`${dir}/${target}`, target].filter(Boolean);
    for (const candidate of candidates) {
      const normalized = candidate.replace(/^\.\//, '');
      if (images.has(normalized)) found.add(normalized);
    }
  }
  return found;
}

/** The tracked documents that embed `target` (repo-relative). */
function docsEmbedding(target: string): string[] {
  return tracked('*.md').filter((doc) => embeddedMockups(doc, committedText(doc)).has(target));
}

describe('docs/screens/templates-preview is referenced (#986)', () => {
  it('holds the template mockups', () => {
    expect(mockups().length).toBeGreaterThan(0);
  });

  it.each(mockups())('embeds %s from a tracked Markdown file', (target) => {
    expect(
      docsEmbedding(target),
      `${target} is not embedded by any tracked Markdown file — add it to the document ` +
        'that explains the templates (docs/IDEAS.md §6), or do not commit the binary'
    ).not.toHaveLength(0);
  });

  it('counts a real embed, not a prose mention of the filename', () => {
    const [target] = mockups();
    const name = target.slice(DIR_REL.length + 1);
    expect(
      embeddedMockups('docs/IDEAS.md', `![alt](screens/templates-preview/${name})`).has(target)
    ).toBe(true);
    expect(
      embeddedMockups(
        'docs/IDEAS.md',
        `Mockups live in docs/screens/templates-preview/${name}.`
      ).has(target)
    ).toBe(false);
  });
});
