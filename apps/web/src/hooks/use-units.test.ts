import { describe, it, expect } from "vitest";
import { defaultSantriUnitId, type Unit } from "./use-units";

/**
 * The unit a per-unit board opens on. The pesantren's staff belong to the
 * pesantren unit, which holds none of the schools' santri; their board must
 * not open on an empty ranking.
 */

const unit = (id: string, students: number): Unit => ({
  id,
  name: id,
  type: "SMP_IT",
  createdAt: "",
  updatedAt: "",
  _count: { users: 0, students, classes: 0 },
});

describe("defaultSantriUnitId", () => {
  const units = [unit("pesantren", 0), unit("sd", 12), unit("smp", 30)];

  it("opens on the reader's own unit when it has santri", () => {
    expect(defaultSantriUnitId(units, "smp")).toBe("smp");
  });

  it("opens on the first unit with santri when the reader's has none", () => {
    expect(defaultSantriUnitId(units, "pesantren")).toBe("sd");
  });

  it("falls back to the reader's unit, then the first, when none has santri", () => {
    const empty = [unit("a", 0), unit("b", 0)];
    expect(defaultSantriUnitId(empty, "b")).toBe("b");
    expect(defaultSantriUnitId(empty, null)).toBe("a");
    expect(defaultSantriUnitId([], "b")).toBeUndefined();
    expect(defaultSantriUnitId(undefined, "b")).toBeUndefined();
  });
});
