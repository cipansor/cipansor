import { describe, it, expect } from "vitest";
import { leaveProfileId, leaveProfileRef, type Employee } from "./use-hr";

/**
 * A leave is filed against a Staff (or Teacher) profile id, never the user id
 * the directory normalizes into `Employee.id`. These two helpers are the one
 * place that mapping lives, and the Ajukan Cuti form reads both — so a wrong
 * id here is a 404 "Staff not found" on every submission (#1061).
 */

const employee = (overrides: Partial<Employee> = {}): Employee =>
  ({
    id: "user-1",
    unitId: "unit-1",
    fullName: "Budi",
    email: "budi@example.test",
    position: "Guru",
    employeeType: "PERMANENT",
    status: "ACTIVE",
    ...overrides,
  }) as Employee;

describe("leaveProfileId", () => {
  it("returns the staff profile id", () => {
    expect(
      leaveProfileId(employee({ staffId: "staff-1", teacherId: "teacher-1" })),
    ).toBe("staff-1");
  });

  it("is null for a teacher with no Staff row, so the form drops them", () => {
    // A teacher id is not a substitute: the API resolves a `teacherId` through
    // the teacher's linked staff row and rejects one that has none — the same
    // condition that leaves `staffId` empty here.
    expect(leaveProfileId(employee({ teacherId: "teacher-1" }))).toBeNull();
  });

  it("is null for an employee with no profile, so the form can drop them", () => {
    expect(leaveProfileId(employee())).toBeNull();
  });

  it("never returns the user id", () => {
    expect(leaveProfileId(employee({ id: "user-9" }))).not.toBe("user-9");
  });
});

describe("leaveProfileRef", () => {
  it("sends a staff profile id as staffId", () => {
    expect(
      leaveProfileRef(employee({ staffId: "staff-1", teacherId: "teacher-1" })),
    ).toEqual({ staffId: "staff-1" });
  });

  it("sends nothing for a teacher with no Staff row", () => {
    expect(leaveProfileRef(employee({ teacherId: "teacher-1" }))).toEqual({});
  });

  it("sends neither key for an employee with no profile", () => {
    expect(leaveProfileRef(employee())).toEqual({});
  });
});
