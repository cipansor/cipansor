import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Every action button on the Muhadatsah list must do something.
 *
 * The page shipped with six inert controls — Jadwalkan, Eye, Edit, Trash and
 * Pilih, plus a language dropdown pinned to one value — so the whole module
 * could only be used by typing URLs. A button without a handler renders and
 * looks clickable, and no other test notices. This reads the source and fails
 * on any `<Button>` that has neither `onClick`, nor `asChild` (rendering a
 * link), nor `type="submit"`.
 */
const SOURCE = fs.readFileSync(path.join(__dirname, "page.tsx"), "utf8");

/** Opening `<Button …>` tags, with `>` inside `{…}` expressions kept out. */
function buttonTags(source: string): string[] {
  const tags: string[] = [];
  const marker = "<Button";
  for (
    let start = source.indexOf(marker);
    start !== -1;
    start = source.indexOf(marker, start + marker.length)
  ) {
    let depth = 0;
    let end = start + marker.length;
    for (; end < source.length; end++) {
      const char = source[end];
      if (char === "{") depth++;
      else if (char === "}") depth--;
      else if (char === ">" && depth === 0) break;
    }
    tags.push(source.slice(start, end + 1));
  }
  return tags;
}

describe("muhadatsah list page", () => {
  it("has no button without an action", () => {
    const buttons = buttonTags(SOURCE);
    expect(buttons.length).toBeGreaterThan(0);

    const dead = buttons.filter(
      (button) => !/onClick|asChild|type="submit"/.test(button),
    );
    expect(dead).toEqual([]);
  });

  it("keeps the action handlers it needs", () => {
    expect(SOURCE.match(/onClick/g)?.length ?? 0).toBeGreaterThan(2);
    expect(SOURCE).toContain("useDeleteMuhadatsah");
    expect(SOURCE).toMatch(
      /useMatchPartners\(\s*undefined,\s*partnerLanguage,?\s*\)/,
    );
  });
});
