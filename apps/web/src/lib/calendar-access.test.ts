import { describe, expect, it } from "vitest";
import {
  canModifyCalendarEvent,
  type CalendarAccessUser,
  type CalendarEventAccess,
} from "./calendar-access";

const user = (overrides: Partial<CalendarAccessUser>): CalendarAccessUser => ({
  id: "user-1",
  role: "TEACHER",
  unitId: "unit-sdit",
  userRoles: [
    {
      isPrimary: true,
      role: { code: "SDIT_KEPALA_SEKOLAH" },
      unit: { id: "unit-sdit" },
    },
  ],
  ...overrides,
});

const event = (
  overrides: Partial<CalendarEventAccess>,
): CalendarEventAccess => ({
  createdById: "someone-else",
  unitId: "unit-sdit",
  ...overrides,
});

describe("canModifyCalendarEvent", () => {
  it("lets a kepala sekolah delete their own agenda", () => {
    expect(
      canModifyCalendarEvent(user({}), event({ createdById: "user-1" })),
    ).toBe(true);
  });

  it("does not offer a kepala sekolah someone else's unit agenda", () => {
    expect(canModifyCalendarEvent(user({}), event({}))).toBe(false);
  });

  it("lets a unit admin delete any agenda in their unit", () => {
    expect(
      canModifyCalendarEvent(
        user({
          role: "UNIT_ADMIN",
          userRoles: [
            {
              isPrimary: true,
              role: { code: "SDIT_ADMIN" },
              unit: { id: "unit-sdit" },
            },
          ],
        }),
        event({ unitId: "unit-sdit" }),
      ),
    ).toBe(true);
  });

  it("keeps a unit admin out of another unit's agenda", () => {
    expect(
      canModifyCalendarEvent(
        user({
          role: "UNIT_ADMIN",
          userRoles: [
            {
              isPrimary: true,
              role: { code: "SDIT_ADMIN" },
              unit: { id: "unit-sdit" },
            },
          ],
        }),
        event({ unitId: "unit-smpit" }),
      ),
    ).toBe(false);
  });

  it("lets a super admin touch any agenda", () => {
    expect(
      canModifyCalendarEvent(
        user({
          role: "SUPER_ADMIN",
          userRoles: [
            {
              isPrimary: true,
              role: { code: "SUPER_ADMIN" },
              unit: null,
            },
          ],
        }),
        event({ unitId: "unit-smpit" }),
      ),
    ).toBe(true);
  });

  it("keeps an ordinary teacher to their own agenda", () => {
    const teacher = user({
      role: "TEACHER",
      userRoles: [
        {
          isPrimary: true,
          role: { code: "SDIT_GURU" },
          unit: { id: "unit-sdit" },
        },
      ],
    });
    expect(
      canModifyCalendarEvent(teacher, event({ createdById: "user-1" })),
    ).toBe(true);
    expect(canModifyCalendarEvent(teacher, event({}))).toBe(false);
  });
});
