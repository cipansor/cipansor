import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Dynamic route pages must treat `params` as a Promise.
 *
 * Next 16 hands a dynamic segment's `params` to a page as a Promise. Reading
 * `params.id` directly yields `undefined`, and because every detail hook is
 * `enabled: !!id` the request never fires — the page sits on its loading state
 * and then renders its "not found" branch. That is how the whole E-Office
 * letter detail (paraf, penanda tangan, TTE) came to show "Surat tidak
 * ditemukan." for every letter: the id was never resolved, on every page that
 * had not been migrated from the Next 15 synchronous signature.
 *
 * Accepted reads, all reactive in Next 16:
 *   - `params: Promise<{ id: string }>` + `use(params)` (client component)
 *   - `params: Promise<{ id: string }>` + `await params` (server component)
 *   - `useParams()` (either)
 *
 * Rejected: `params: { id: string }`, or a bare `params.id` read.
 */

const APP = path.resolve(__dirname, "../app");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name === "page.tsx") out.push(p);
  }
  return out;
}

/** A page is dynamic when any ancestor directory is a `[segment]`. */
function dynamicSegments(file: string): string[] {
  return path
    .relative(APP, file)
    .split(path.sep)
    .filter((s) => /^\[.*\]$/.test(s))
    .map((s) => s.replace(/^\[(\.\.\.)?|\]$/g, ""));
}

/** True when the file unwraps the params Promise (or uses useParams). */
function unwrapsParams(src: string): boolean {
  return (
    /\buseParams\s*\(/.test(src) ||
    /\buse\(\s*params/.test(src) ||
    /\bawait\s+params\b/.test(src)
  );
}

describe("Next 16 dynamic params", () => {
  const pages = walk(APP).filter((f) => dynamicSegments(f).length > 0);

  it("finds dynamic pages to check", () => {
    expect(pages.length).toBeGreaterThan(0);
  });

  for (const file of pages) {
    const rel = path.relative(APP, file);
    const src = fs.readFileSync(file, "utf8");
    const segments = dynamicSegments(file);

    it(`${rel} resolves params as a Promise`, () => {
      // `useParams()` is the other supported read — a plain object, no Promise.
      if (/\buseParams\s*\(/.test(src)) return;

      // A page receives the segment only by destructuring the `params` prop
      // (`{ params }` or `{ params, }`). An axios call's `params: { … }` config
      // is not a prop and must not be mistaken for one.
      const destructuresParams = /\{\s*params\s*[,}]/.test(src);

      if (!unwrapsParams(src)) {
        expect(
          destructuresParams,
          `${rel} takes a \`params\` prop but never unwraps it with use(params) / await params`,
        ).toBe(false);

        // A bare property read of a dynamic segment on the params prop.
        for (const seg of segments) {
          expect(
            new RegExp(`params\\.${seg}\\b`).test(src),
            `${rel} reads \`params.${seg}\` without unwrapping the Promise`,
          ).toBe(false);
        }
      }

      // If it unwraps, the prop must be typed as a Promise (not the Next 15
      // synchronous object) so TypeScript agrees with the runtime.
      if (destructuresParams && unwrapsParams(src)) {
        expect(
          /params\s*:\s*Promise\s*</.test(src) ||
            /\buseParams\s*\(/.test(src) ||
            /interface\s+\w*Props[\s\S]*?params\s*:\s*Promise/.test(src),
          `${rel} unwraps params but does not type the prop as Promise<{ … }>`,
        ).toBe(true);
      }
    });
  }
});
