import { describe, it, expect, vi } from 'vitest';
import { z, ZodObject } from 'zod';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/redis', () => ({ redis: {} }));

import { app } from '../app';
import { VALIDATED_SCHEMA } from '../middleware/validate';

/**
 * A schema handed to `validate()` must describe the body itself, not a
 * `{ body: … }` wrapper.
 *
 * `validate()` parses `req.body` directly (`req.body = schema.parse(req.body)`),
 * so a schema written as `z.object({ body: z.object({ … }) })` makes Zod look
 * for `req.body.body` — undefined — and answers every write with
 * `400 VALIDATION_ERROR` ("body: expected object, received undefined"). That
 * is exactly what happened to Portofolio, Resepsi and Anggaran (#749): the
 * three modules were unusable for months and no test noticed, because the
 * schemas were only exercised through the routes and every route test used a
 * mock that never ran the middleware.
 *
 * This guard walks the real router — the same tree `web-api-contract.guard`
 * dispatches — and reads the schema each `validate*` middleware was built
 * from (tagged with `VALIDATED_SCHEMA`). A wrapped schema is the signature
 * `{ body: ZodObject }` (or `params`/`query`): a single top-level key whose
 * name is one of those and whose value is an object schema.
 */

type Layer = {
  route?: { path: string | string[]; stack: Array<{ handle: unknown }> };
  handle?: { stack?: Layer[]; [VALIDATED_SCHEMA]?: unknown };
  path?: string;
};

const rootStack = (app as unknown as { router: { stack: Layer[] } }).router.stack;

/** Every `validate*` schema reachable in the router, with its route path. */
function collect(
  stack: Layer[],
  path: string,
  out: Array<{ path: string; schema: unknown }> = []
): Array<{ path: string; schema: unknown }> {
  for (const layer of stack) {
    if (layer.route) {
      const routePath = ([] as string[]).concat(layer.route.path).join('|');
      for (const sub of layer.route.stack) {
        const schema = (sub.handle as { [VALIDATED_SCHEMA]?: unknown } | undefined)?.[
          VALIDATED_SCHEMA
        ];
        if (schema) out.push({ path: `${path}${routePath}`, schema });
      }
    } else if (layer.handle?.stack) {
      const prefix = layer.path ?? '';
      collect(layer.handle.stack, `${path}${prefix}`, out);
    }
  }
  return out;
}

/** Peel `optional`/`nullable`/`default` wrappers to reach the schema they hold. */
function unwrap(schema: unknown): unknown {
  let s = schema as { def?: { type?: string; innerType?: unknown }; unwrap?: () => unknown };
  // ZodOptional/ZodNullable/ZodDefault each expose `unwrap()`; `.refine()` keeps
  // the object type, so it needs no peeling.
  let guard = 0;
  while (s && typeof s.unwrap === 'function' && guard++ < 10) {
    const inner = s.unwrap();
    if (inner === s) break;
    s = inner as typeof s;
  }
  return s;
}

/** The single top-level key name when a schema is a `{ body|params|query: ZodObject }` wrapper. */
function wrapperKey(schema: unknown): string | null {
  const s = unwrap(schema);
  if (!(s instanceof ZodObject)) return null;
  const keys = Object.keys(s.shape);
  if (keys.length !== 1) return null;
  const [key] = keys;
  if (key !== 'body' && key !== 'params' && key !== 'query') return null;
  return (s.shape as Record<string, unknown>)[key] instanceof ZodObject ? key : null;
}

const SCHEMAS = collect(rootStack, '');

describe('validate() schemas describe the body, not a wrapper', () => {
  it('the router really carries validate() schemas (the walk is not silently empty)', () => {
    expect(SCHEMAS.length).toBeGreaterThan(100);
  });

  it('no validate() schema wraps its fields in { body | params | query }', () => {
    const wrapped = SCHEMAS.map(({ path, schema }) => ({ path, key: wrapperKey(schema) })).filter(
      (r): r is { path: string; key: string } => r.key !== null
    );
    expect(
      wrapped,
      `Schemas that wrap their fields in { ${wrapped.map((w) => w.key).join(', ')} } — ` +
        `validate() parses req.body directly, so these answer 400 on every write. ` +
        `Remove the wrapper: ${wrapped.map((w) => w.path).join(', ')}`
    ).toEqual([]);
  });

  it('flags a wrapped schema when it sees one (the check has teeth)', () => {
    const wrapped = z.object({ body: z.object({ a: z.string() }) });
    expect(wrapperKey(wrapped)).toBe('body');
    expect(wrapperKey(z.object({ a: z.string() }))).toBeNull();
    // A body that legitimately carries a field called `query` among others is fine.
    expect(
      wrapperKey(z.object({ query: z.object({ a: z.string() }), page: z.number() }))
    ).toBeNull();
    // The wrapper is still caught when it is wrapped in optional/nullable/refine.
    expect(wrapperKey(wrapped.optional())).toBe('body');
    expect(wrapperKey(wrapped.nullable())).toBe('body');
    expect(wrapperKey(wrapped.refine(() => true))).toBe('body');
    expect(wrapperKey(wrapped.optional().refine(() => true))).toBe('body');
  });
});
