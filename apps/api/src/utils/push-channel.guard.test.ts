import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';

/**
 * The web keeps itself fresh by polling, and there is no push channel — no
 * Socket.IO, no WebSocket, no server-sent events. Decided on 2026-09-28
 * (decision `realtime-polling` in the project memory) after the Socket.IO server
 * that used to live in `lib/realtime.ts` turned out to have no client: the web
 * provider was never mounted, it sent the wrong token, and the event names on
 * the two sides never matched.
 *
 * A push channel is a second authorisation path next to REST, and a
 * long-lived connection that outlives its token. This guard does not forbid
 * one; it makes adding one a visible decision. Going red here means: read the
 * decision, meet its conditions, and change this test in the same PR.
 */

const REPO = resolve(__dirname, '..', '..', '..', '..');
const read = (p: string) => readFileSync(join(REPO, p), 'utf8');

const PUSH_PACKAGES = ['socket.io', 'socket.io-client', 'ws', 'engine.io', 'engine.io-client'];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

// Written out rather than built from PUSH_PACKAGES, so no escaping is involved;
// the last test below keeps the two in step.
const IMPORTS_PUSH =
  /(from\s+|require\(\s*|import\(\s*)['"](socket\.io|socket\.io-client|ws|engine\.io|engine\.io-client)['"]/;

describe('no push channel without a decision', () => {
  it.each(['apps/api/package.json', 'apps/web/package.json', 'package.json'])(
    '%s depends on no push-channel package',
    (file) => {
      const pkg = JSON.parse(read(file));
      // Direct dependencies only: `overrides` in pnpm-workspace.yaml pins
      // versions of transitive packages (tooling pulls in `ws`) and opens no
      // channel of ours.
      const deps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.optionalDependencies,
      };
      const found = Object.keys(deps).filter((name) =>
        PUSH_PACKAGES.some((p) => name === p || name.startsWith(`${p}-`))
      );
      expect(found).toEqual([]);
    }
  );

  it.each(['apps/api/src', 'apps/web/src'])('no file under %s imports one', (dir) => {
    const offenders = sourceFiles(join(REPO, dir))
      .filter((file) => file !== __filename) // its own examples, below
      .filter((file) => IMPORTS_PUSH.test(readFileSync(file, 'utf8')))
      .map((file) => relative(REPO, file));
    expect(offenders).toEqual([]);
  });

  it('the web opens no EventSource', () => {
    const offenders = sourceFiles(join(REPO, 'apps/web/src'))
      .filter((file) => /new\s+EventSource\s*\(/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(REPO, file));
    expect(offenders).toEqual([]);
  });

  it('the proxy in front of the API forwards no /socket.io/ path', () => {
    expect(read('deploy/azure/nginx/nginx.conf')).not.toMatch(/location[^{]*\/socket\.io/);
  });

  it('the pattern would catch the import this repository used to have', () => {
    for (const name of PUSH_PACKAGES) {
      expect(IMPORTS_PUSH.test(`import x from '${name}';`)).toBe(true);
    }
    expect(IMPORTS_PUSH.test("import { Server } from 'socket.io';")).toBe(true);
    expect(IMPORTS_PUSH.test('import { io, Socket } from "socket.io-client";')).toBe(true);
    expect(IMPORTS_PUSH.test("import { WebSocketServer } from 'ws';")).toBe(true);
    expect(IMPORTS_PUSH.test("import { wsHelper } from '@/lib/ws-helper';")).toBe(false);
  });
});
