import { describe, expect, it } from "vitest";
import {
  firstParamValue,
  mergeResolved,
  matchesDynamicPattern,
  rowHasValue,
  staleCarriedPatterns,
  unaccountedPatterns,
  walkList,
} from "./dynamic-routes";

describe("mergeResolved", () => {
  it("carries a pattern's previous URL when this run resolved nothing", () => {
    // The regression Devin flagged: the previous map held a working URL for
    // /counseling/[id], this run's list call returned no row, and the old
    // resolver wrote the file without it — dropping the page from the sweep.
    const { merged, dropped, carried } = mergeResolved(
      ["/counseling/[id]", "/inventory/[id]"],
      { "/inventory/[id]": "/inventory/new-id" },
      { "/counseling/[id]": "/counseling/old-id" },
    );
    expect(merged).toEqual({
      "/counseling/[id]": "/counseling/old-id",
      "/inventory/[id]": "/inventory/new-id",
    });
    expect(dropped).toEqual([]);
    expect(carried).toEqual(["/counseling/[id]"]);
  });

  it("prefers the fresh URL over the previous one", () => {
    const { merged, resolved, carried } = mergeResolved(
      ["/inventory/[id]"],
      { "/inventory/[id]": "/inventory/new-id" },
      { "/inventory/[id]": "/inventory/old-id" },
    );
    expect(merged["/inventory/[id]"]).toBe("/inventory/new-id");
    expect(resolved).toEqual(["/inventory/[id]"]);
    expect(carried).toEqual([]);
  });

  it("reports a pattern that neither run could resolve", () => {
    const { merged, dropped } = mergeResolved(
      ["/research/themes/[id]"],
      {},
      {},
    );
    expect(merged).toEqual({});
    expect(dropped).toEqual(["/research/themes/[id]"]);
  });

  it("drops a pattern that no longer exists in the app", () => {
    const { merged } = mergeResolved(
      ["/still-here/[id]"],
      {},
      { "/removed/[id]": "/removed/x", "/still-here/[id]": "/still-here/x" },
    );
    expect(merged).toEqual({ "/still-here/[id]": "/still-here/x" });
  });

  it("marks a carried URL stale when its id no longer exists", () => {
    // The reseed case: the list answered with no rows, so the id the previous
    // map holds is dead and the carried URL would 404.
    const { merged, carried, stale } = mergeResolved(
      ["/counseling/[id]"],
      {},
      { "/counseling/[id]": "/counseling/old-id" },
      new Set(["old-id"]),
    );
    expect(merged["/counseling/[id]"]).toBe("/counseling/old-id");
    expect(carried).toEqual(["/counseling/[id]"]);
    expect(stale).toEqual(["/counseling/[id]"]);
  });

  it("leaves a carried URL alone when its id is not known dead", () => {
    // The transient-failure case: the list never answered, so we know nothing
    // about the id and must not call the entry stale.
    const { carried, stale } = mergeResolved(
      ["/counseling/[id]"],
      {},
      { "/counseling/[id]": "/counseling/live-id" },
      new Set(["some-other-dead-id"]),
    );
    expect(carried).toEqual(["/counseling/[id]"]);
    expect(stale).toEqual([]);
  });
});

describe("firstParamValue", () => {
  it("gives the first parameter's value from a matching URL", () => {
    expect(firstParamValue("/counseling/abc", "/counseling/[id]")).toBe("abc");
    expect(
      firstParamValue("/counseling/abc/edit", "/counseling/[id]/edit"),
    ).toBe("abc");
    expect(
      firstParamValue(
        "/dormitories/d-1/rooms/r-1",
        "/dormitories/[id]/rooms/[roomId]",
      ),
    ).toBe("d-1");
  });

  it("ignores a query string on the URL", () => {
    expect(
      firstParamValue("/counseling/abc?tab=notes", "/counseling/[id]"),
    ).toBe("abc");
  });

  it("returns null when the URL is not an instance of the pattern", () => {
    expect(firstParamValue("/inventory/abc", "/counseling/[id]")).toBe(null);
    expect(firstParamValue("/counseling/abc/edit", "/counseling/[id]")).toBe(
      null,
    );
  });
});

describe("staleCarriedPatterns", () => {
  it("flags every carried URL that holds a dead id, action or not", () => {
    const merged = {
      "/counseling/[id]": "/counseling/dead",
      "/counseling/[id]/edit": "/counseling/dead/edit",
      "/inventory/[id]": "/inventory/live",
    };
    expect(
      staleCarriedPatterns(
        merged,
        ["/counseling/[id]", "/counseling/[id]/edit", "/inventory/[id]"],
        new Set(["dead"]),
      ),
    ).toEqual(["/counseling/[id]", "/counseling/[id]/edit"]);
  });

  it("flags nothing when no id is known dead", () => {
    expect(
      staleCarriedPatterns(
        { "/counseling/[id]": "/counseling/abc" },
        ["/counseling/[id]"],
        new Set(),
      ),
    ).toEqual([]);
  });
});

describe("rowHasValue", () => {
  it("matches an id field", () => {
    expect(rowHasValue({ id: "p-1", status: "PENDING" }, "p-1")).toBe(true);
  });

  it("matches a non-id field the URL parameter actually holds", () => {
    // `/hr/employees/[id]` holds a `userId`, not the staff row's `id`; a probe
    // that only read `r.id` would call the live URL gone.
    expect(rowHasValue({ id: "staff-1", userId: "user-9" }, "user-9")).toBe(
      true,
    );
    expect(
      rowHasValue(
        { id: "cert-1", certificateNumber: "OTH/09/2026" },
        "OTH/09/2026",
      ),
    ).toBe(true);
  });

  it("matches a bare string row", () => {
    expect(rowHasValue("Kedisiplinan", "Kedisiplinan")).toBe(true);
  });

  it("does not match a value the row does not carry", () => {
    expect(rowHasValue({ id: "p-1", userId: "u-1" }, "p-old")).toBe(false);
  });
});

describe("walkList", () => {
  it("keeps a saved id live when it lies past the first page", async () => {
    // The regression Devin flagged: the saved PENDING permit is on page 2, so a
    // probe that read only page 1 would have declared it gone.
    const pages: Record<number, string[]> = {
      1: ["p-new-1", "p-new-2"],
      2: ["p-old"],
    };
    const verdict = await walkList("p-old", async (page) => ({
      ids: pages[page] ?? [],
      last: page >= 2,
    }));
    expect(verdict).toBe("live");
  });

  it("declares an id gone only after reading the last page", async () => {
    const verdict = await walkList("p-old", async (page) => ({
      ids: page === 1 ? ["p-a"] : [],
      last: true,
    }));
    expect(verdict).toBe("gone");
  });

  it("is unknown when a page fails mid-walk", async () => {
    const verdict = await walkList("p-old", async (page) => {
      if (page === 1) return { ids: ["p-a"], last: false };
      return { ids: [], last: false, failed: true };
    });
    expect(verdict).toBe("unknown");
  });

  it("stops at the page cap as unknown, never gone", async () => {
    const verdict = await walkList(
      "p-old",
      async () => ({ ids: ["p-a"], last: false }),
      3,
    );
    expect(verdict).toBe("unknown");
  });
});

describe("unaccountedPatterns", () => {
  it("passes a dropped pattern the allowlist names", () => {
    expect(
      unaccountedPatterns(["/research/themes/[id]"], {
        "/research/themes/[id]": { reason: "no seeded row" },
      }),
    ).toEqual([]);
  });

  it("flags a dropped pattern the allowlist does not name", () => {
    expect(
      unaccountedPatterns(["/counseling/[id]", "/inventory/[id]"], {
        "/inventory/[id]": { reason: "no seeded row" },
      }),
    ).toEqual(["/counseling/[id]"]);
  });
});

describe("matchesDynamicPattern", () => {
  it("matches a concrete URL against its pattern", () => {
    expect(
      matchesDynamicPattern("/counseling/abc-123", "/counseling/[id]"),
    ).toBe(true);
    expect(
      matchesDynamicPattern(
        "/counseling/abc-123/edit",
        "/counseling/[id]/edit",
      ),
    ).toBe(true);
  });

  it("does not let one segment cover two", () => {
    expect(
      matchesDynamicPattern("/counseling/abc/edit", "/counseling/[id]"),
    ).toBe(false);
    expect(
      matchesDynamicPattern("/counseling/abc", "/counseling/[id]/edit"),
    ).toBe(false);
  });

  it("requires literal segments to match exactly", () => {
    expect(matchesDynamicPattern("/inventory/abc", "/counseling/[id]")).toBe(
      false,
    );
  });

  it("treats multi-param patterns positionally", () => {
    expect(
      matchesDynamicPattern(
        "/assessment/skhun/s-1/y-1",
        "/assessment/skhun/[studentId]/[academicYearId]",
      ),
    ).toBe(true);
  });
});
