import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';

/**
 * One Node major, declared five times — and they must agree.
 *
 * `@types/node` is the anchor: it is published per Node major, so its major is
 * the version the code is type-checked against. If a build runs on an older
 * Node than the types describe, `build:strict` stops being evidence that the
 * code runs in production — an API added in a later major type-checks and then
 * throws at runtime. This happened: the runtime sat on Node 22 while
 * `@types/node` was 26 (#787).
 *
 * The declarations the version must match:
 *   - `@types/node` in both apps (the anchor);
 *   - `NODE_VERSION` in every workflow that sets it (CI, E2E, load tests);
 *   - `FROM node:<major>-alpine` in both Dockerfiles (staging + production);
 *   - `engines.node` in the root `package.json` (pnpm warns off-version);
 *   - `.nvmrc` (what a contributor's shell switches to).
 *
 * The guard exists so the majors cannot drift apart again: a bump touches five
 * files, and one left behind is invisible in a diff a reviewer skims.
 */

const ROOT = resolve(__dirname, '..', '..', '..', '..');
const APPS = ['apps/api/package.json', 'apps/web/package.json'];
const DOCKERFILES = ['apps/api/Dockerfile', 'apps/web/Dockerfile'];

function readJson(rel: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(ROOT, rel), 'utf8'));
}

/** The major of a version-ish string, tolerating a leading range operator. */
function major(version: string): number {
  const match = /(\d+)/.exec(version);
  expect(match, `no major in "${version}"`).not.toBeNull();
  return Number(match?.[1]);
}

function typesNodeMajor(rel: string): number {
  const deps = readJson(rel).devDependencies as Record<string, string> | undefined;
  const version = deps?.['@types/node'];
  expect(version, `@types/node is not a devDependency of ${rel}`).toBeTruthy();
  return major(String(version));
}

function workflowNodeMajors(): { file: string; major: number }[] {
  const dir = resolve(ROOT, '.github', 'workflows');
  return readdirSync(dir)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .flatMap((name) => {
      const doc = parse(readFileSync(resolve(dir, name), 'utf8')) as {
        env?: { NODE_VERSION?: string | number };
        jobs?: Record<string, { env?: { NODE_VERSION?: string | number } }>;
      };
      // NODE_VERSION may sit at the workflow level or on a single job; a
      // declaration the scan cannot see is one that can drift unseen.
      const declared: (string | number)[] = [];
      if (doc?.env?.NODE_VERSION !== undefined) declared.push(doc.env.NODE_VERSION);
      for (const job of Object.values(doc?.jobs ?? {})) {
        if (job?.env?.NODE_VERSION !== undefined) declared.push(job.env.NODE_VERSION);
      }
      return declared.map((value) => ({
        file: `workflows/${name}`,
        major: major(String(value)),
      }));
    });
}

function dockerfileNodeMajor(rel: string): number {
  const text = readFileSync(resolve(ROOT, rel), 'utf8');
  const match = /^FROM\s+node:(\d+)/m.exec(text);
  expect(match, `no "FROM node:<major>" in ${rel}`).not.toBeNull();
  return Number(match?.[1]);
}

describe('one Node major across every declaration', () => {
  const expected = typesNodeMajor(APPS[0]);

  it('the scan reads the declarations it guards', () => {
    expect(
      workflowNodeMajors().length,
      'no workflow declares NODE_VERSION — the guard would pass vacuously'
    ).toBeGreaterThan(0);
    expect(DOCKERFILES.map(dockerfileNodeMajor)).toHaveLength(DOCKERFILES.length);
  });

  it('@types/node agrees in both apps', () => {
    for (const app of APPS) {
      expect(typesNodeMajor(app), `${app} @types/node`).toBe(expected);
    }
  });

  it('every workflow sets NODE_VERSION to the same major', () => {
    for (const { file, major: found } of workflowNodeMajors()) {
      expect(found, `${file} NODE_VERSION`).toBe(expected);
    }
  });

  it('both Dockerfiles build on the same major', () => {
    for (const file of DOCKERFILES) {
      expect(dockerfileNodeMajor(file), `${file} FROM node`).toBe(expected);
    }
  });

  it('installs Corepack from npm where the Node major no longer bundles it', () => {
    // Corepack left the Node distribution in Node 25. Measured against the
    // release tarballs: v22.20.0 ships 60 corepack files, v26.13.0 ships none.
    // A Dockerfile on such a major that calls `corepack` must install it first,
    // or the build dies with "corepack: not found".
    for (const file of DOCKERFILES) {
      const text = readFileSync(resolve(ROOT, file), 'utf8');
      if (!/\bcorepack\b/.test(text) || dockerfileNodeMajor(file) < 25) continue;
      expect(
        /npm install -g corepack@/.test(text),
        `${file} runs corepack on Node ${dockerfileNodeMajor(file)}, which does not bundle it — install it from npm first`
      ).toBe(true);
    }
  });

  it('the root package.json engines.node pins the same major', () => {
    const engines = readJson('package.json').engines as { node?: string } | undefined;
    const node = engines?.node;
    expect(node, 'engines.node is not declared').toBeTruthy();
    expect(major(String(node)), 'engines.node').toBe(expected);
  });

  it('.nvmrc names the same major', () => {
    const nvmrc = readFileSync(resolve(ROOT, '.nvmrc'), 'utf8').trim();
    expect(major(nvmrc), '.nvmrc').toBe(expected);
  });
});
