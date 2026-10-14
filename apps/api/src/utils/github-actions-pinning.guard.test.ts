import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';

/**
 * Every third-party Action a workflow runs must be pinned to a full-length
 * commit SHA, not a moving tag.
 *
 * GitHub's own hardening guidance is explicit: "Pinning an action to a
 * full-length commit SHA is currently the only way to use an action as an
 * immutable release" — a tag can be moved under us, so a compromised Action
 * repository (or a tag an attacker can retag) silently swaps the code that
 * receives this repo's credentials. `azure/login`, `docker/*` and the other
 * Actions here take tokens and secrets, which is exactly the case the rule is
 * written for.
 *
 * The guard exists so the pins cannot drift back to tags: a tag on a single
 * line is invisible in a diff a reviewer skims, and Dependabot's
 * github-actions updates would happily reopen one.
 *
 * A pin is `owner/repo[/subpath]@<40 hex> # vX`, the trailing comment being
 * what Dependabot reads to know which release to move the SHA to — so both
 * halves are asserted, not just the SHA.
 */

const ROOT = resolve(__dirname, '..', '..', '..', '..');
const WORKFLOWS = resolve(ROOT, '.github', 'workflows');

const SHA_REF = /^[0-9a-f]{40}$/;
/** `owner/repo[/subpath]@ref`, or a local `./…` reusable workflow. */
const USES_LINE = /^\s*(?:-\s*)?uses:\s*(\S+)(.*)$/;

/** Actions that must be present, so a broken walker cannot pass by finding none. */
const MUST_FIND = ['actions/checkout', 'actions/setup-node', 'pnpm/action-setup'];

function workflowFiles(): string[] {
  return readdirSync(WORKFLOWS)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .map((name) => resolve(WORKFLOWS, name));
}

/** Every `uses:` value in a workflow, from the parsed YAML (authoritative count). */
function usesFromYaml(file: string): string[] {
  const doc = parse(readFileSync(file, 'utf8'));
  const found: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (key === 'uses' && typeof value === 'string') found.push(value);
        else walk(value);
      }
    }
  };
  walk(doc);
  return found;
}

/** Every `uses:` line as written, so the Dependabot version comment survives. */
function usesLines(file: string): { ref: string; tail: string; line: number }[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .flatMap((text, index) => {
      const match = USES_LINE.exec(text);
      return match ? [{ ref: match[1], tail: match[2], line: index + 1 }] : [];
    });
}

describe('GitHub Actions are pinned to full-length commit SHAs', () => {
  it('the scan reads the workflows it guards', () => {
    const files = workflowFiles();
    expect(
      files.length,
      'no workflow files found — the guard would pass vacuously'
    ).toBeGreaterThan(0);

    const refs = files.flatMap(usesFromYaml);
    expect(refs.length, 'no `uses:` found at all').toBeGreaterThan(0);

    const actions = refs.filter((ref) => !ref.startsWith('./'));
    for (const action of MUST_FIND) {
      expect(
        actions.some((ref) => ref.startsWith(`${action}@`)),
        `expected to find ${action} among the workflow actions; the scan is blind`
      ).toBe(true);
    }
  });

  it('the line scan and the YAML parse see the same refs', () => {
    // Two independent readers of the same fact: if a `uses:` is written in a
    // shape the line regex misses (quoted, folded), the counts diverge and this
    // fails rather than the tag slipping through unseen.
    for (const file of workflowFiles()) {
      const fromYaml = usesFromYaml(file).sort();
      const fromLines = usesLines(file)
        .map((entry) => entry.ref)
        .sort();
      expect(
        fromLines,
        `${file}: the line scan and the YAML parse disagree on the actions present`
      ).toEqual(fromYaml);
    }
  });

  it('pins every third-party Action to a 40-hex commit SHA', () => {
    const offenders: string[] = [];
    for (const file of workflowFiles()) {
      for (const { ref, line } of usesLines(file)) {
        if (ref.startsWith('./')) continue; // local reusable workflow
        const at = ref.lastIndexOf('@');
        const action = at === -1 ? ref : ref.slice(0, at);
        const revision = at === -1 ? '' : ref.slice(at + 1);
        if (!SHA_REF.test(revision)) {
          offenders.push(`${file}:${line} ${action}@${revision || '<none>'}`);
        }
      }
    }
    expect(
      offenders,
      `these Actions are not pinned to a full-length commit SHA (a tag is movable):\n${offenders.join('\n')}`
    ).toEqual([]);
  });

  it('keeps the version comment Dependabot reads to move a pin', () => {
    const missing: string[] = [];
    for (const file of workflowFiles()) {
      for (const { ref, tail, line } of usesLines(file)) {
        if (ref.startsWith('./')) continue;
        if (!/#\s*v\d/.test(tail)) {
          missing.push(`${file}:${line} ${ref}`);
        }
      }
    }
    expect(
      missing,
      `these pins carry no "# vX" comment; Dependabot needs it to know which release to update to:\n${missing.join('\n')}`
    ).toEqual([]);
  });

  it('the check fires on the tag form it exists to catch', () => {
    // A guard that cannot fail on the defect is not a guard: assert the
    // detection on the shape it forbids.
    const tagRef = 'actions/checkout@v7';
    const at = tagRef.lastIndexOf('@');
    expect(SHA_REF.test(tagRef.slice(at + 1))).toBe(false);
    expect(SHA_REF.test('3d3c42e5aac5ba805825da76410c181273ba90b1')).toBe(true);
    expect(/#\s*v\d/.test(' # v7')).toBe(true);
  });
});
