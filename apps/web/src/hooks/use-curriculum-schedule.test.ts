import { describe, it, expect } from "vitest";
import {
  fromApiSchedule,
  toApiSchedule,
  toScheduleList,
} from "./use-curriculum";

const row = {
  id: "s-1",
  classId: "c-1",
  subjectId: "m-1",
  teacherId: "t-1",
  unitId: "u-1",
  academicYearId: "y-1",
  startTime: "07:00",
  endTime: "08:30",
  isActive: true,
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-01T00:00:00Z",
};

describe("schedule rows to and from the API", () => {
  it("reads the day from dayOfWeek and the teacher's name from its user", () => {
    const schedule = fromApiSchedule({
      ...row,
      dayOfWeek: "MONDAY",
      teacher: { id: "t-1", user: { name: "Ustadz Hasan" } },
    });
    expect(schedule.day).toBe("MONDAY");
    expect(schedule.teacher).toEqual({ id: "t-1", name: "Ustadz Hasan" });
    expect(schedule).not.toHaveProperty("dayOfWeek");
  });

  it("leaves a row without a teacher without one", () => {
    expect(fromApiSchedule({ ...row, dayOfWeek: "FRIDAY" })).not.toHaveProperty(
      "teacher",
    );
  });

  it("writes the day as dayOfWeek, with the unit, and drops the relations", () => {
    expect(
      toApiSchedule({
        classId: "c-1",
        unitId: "u-1",
        day: "TUESDAY",
        teacher: { id: "t-1", name: "Ustadz Hasan" },
        class: { id: "c-1", name: "7A" },
      }),
    ).toEqual({ classId: "c-1", unitId: "u-1", dayOfWeek: "TUESDAY" });
  });
});

/**
 * The list payload must be an array to map. A `data` that is not one used to
 * throw `data.map is not a function`, blanking the whole schedule page.
 */
describe("mapping a schedule list response", () => {
  it("maps the rows of an array payload", () => {
    expect(
      toScheduleList([{ ...row, dayOfWeek: "MONDAY" }]).map((s) => s.day),
    ).toEqual(["MONDAY"]);
  });

  it("returns no rows when the payload is not an array", () => {
    expect(toScheduleList(undefined)).toEqual([]);
    expect(toScheduleList(null)).toEqual([]);
    expect(toScheduleList({ message: "boom" })).toEqual([]);
    expect(toScheduleList("nope")).toEqual([]);
  });
});
