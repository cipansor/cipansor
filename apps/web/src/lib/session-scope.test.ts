import { describe, it, expect } from "vitest";
import {
  overseesAllUnits,
  sessionRoleCode,
  sessionUnitId,
  type SessionScopeUser,
} from "./session-scope";

const user = (overrides: Partial<SessionScopeUser>): SessionScopeUser => ({
  role: "UNIT_ADMIN",
  unitId: "profile-sdit",
  unit: { id: "profile-sdit" },
  userRoles: [],
  ...overrides,
});

describe("sessionUnitId — the active assignment, not the profile", () => {
  it("uses the assignment's unit when it differs from the profile", () => {
    const admin = user({
      userRoles: [
        {
          isPrimary: true,
          role: { code: "SMPIT_ADMIN" },
          unit: { id: "unit-smpit" },
        },
      ],
    });

    expect(sessionUnitId(admin)).toBe("unit-smpit");
    expect(overseesAllUnits(admin)).toBe(false);
  });

  it("falls back to the profile unit when the assignment names none", () => {
    const teacher = user({
      role: "TEACHER",
      userRoles: [{ isPrimary: true, role: { code: "SDIT_GURU" }, unit: null }],
    });

    expect(sessionUnitId(teacher)).toBe("profile-sdit");
  });

  it("gives a foundation role no unit even when a profile unit exists", () => {
    const ketua = user({
      userRoles: [
        { isPrimary: true, role: { code: "YAYASAN_KETUA" }, unit: null },
      ],
    });

    expect(sessionRoleCode(ketua)).toBe("YAYASAN_KETUA");
    expect(sessionUnitId(ketua)).toBeUndefined();
    expect(overseesAllUnits(ketua)).toBe(true);
  });

  it("follows the primary assignment, not the first stale one", () => {
    const switched = user({
      userRoles: [
        {
          isPrimary: false,
          role: { code: "SDIT_GURU" },
          unit: { id: "unit-sdit" },
        },
        {
          isPrimary: true,
          role: { code: "SMPIT_ADMIN" },
          unit: { id: "unit-smpit" },
        },
      ],
    });

    expect(sessionUnitId(switched)).toBe("unit-smpit");
  });
});
