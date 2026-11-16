import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';

/**
 * `docs/screens/templates-preview/` holds the mockups of the issue and PR
 * templates (#982/#983). The four PNGs were committed with no Markdown file
 * referring to them — 1.19 MB of orphaned binaries that `check-doc-refs.py`
 * lists under ORPHAN but nothing fails on (#986). A fifth one could land the
 * same way. This pins that every image in the folder is embedded by at least
 * one tracked document, so an unreferenced mockup cannot pass the gate again.
 *
 * The repository convention is that a committed image is referenced by the
 * prose that explains it (the image-docs decision under `.claude/memory/decisions/`).
 */
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const DIR = join(REPO_ROOT, 'docs', 'screens', 'templates-preview');

const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'coverage', 'test-results']);

function markdownFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) markdownFiles(path, acc);
    else if (name.endsWith('.md')) acc.push(path);
  }
  return acc;
}

function mockups(): string[] {
  return readdirSync(DIR).filter((f) => f.endsWith('.png'));
}

describe('docs/screens/templates-preview is referenced (#986)', () => {
  it('holds the template mockups', () => {
    expect(mockups().length).toBeGreaterThan(0);
  });

  it.each(mockups())('embeds %s from a tracked Markdown file', (file) => {
    const needle = `templates-preview/${file}`;
    const docs = markdownFiles(REPO_ROOT).filter((p) => readFileSync(p, 'utf8').includes(needle));
    expect(
      docs,
      `${needle} is not referenced by any Markdown file — add it to the document that ` +
        'explains the templates (docs/IDEAS.md §6), or do not commit the binary'
    ).not.toHaveLength(0);
  });
});
