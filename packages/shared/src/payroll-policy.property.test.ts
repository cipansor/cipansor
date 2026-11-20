import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  BENDAHARA_ROLE_CODES,
  GOVERNANCE_ROLE_CODES,
  PAYROLL_ACTIONS,
  PAYROLL_APPROVER_ROLE_CODES,
  PAYROLL_COMPONENT_MANAGER_ROLE_CODES,
  PAYROLL_READER_ROLE_CODES,
  PAYROLL_STATUS_VALUES,
  decidePayroll,
  payrollButtons,
  type PayrollAction,
  type PayrollActor,
  type PayrollPeriodFacts,
  type PayrollStatus,
} from "@cipansor/shared";

/**
 * Properties 11 and 12 of the phase-2 specification (#990, PR-04): the payroll
 * rules are one pure function, so they can be checked over every actor, action
 * and period instead of only the examples in the route tests.
 */

const OTHER_WRITE_ROLES = [
  "SUPER_ADMIN",
  "SDIT_ADMIN",
  "SDIT_KEPALA_SEKOLAH",
  "SDIT_TATA_USAHA",
  "SDIT_GURU",
  "YAYASAN_PEMBINA",
  "YAYASAN_SEKRETARIS",
  "YAYASAN_ANGGOTA",
  "YAYASAN_PENGAWAS",
] as const;

const ALL_ROLE_CODES = [
  ...new Set([
    ...PAYROLL_READER_ROLE_CODES,
    ...PAYROLL_APPROVER_ROLE_CODES,
    ...PAYROLL_COMPONENT_MANAGER_ROLE_CODES,
    ...BENDAHARA_ROLE_CODES,
    ...GOVERNANCE_ROLE_CODES,
    ...OTHER_WRITE_ROLES,
  ]),
] as const;

const UNITS = ["unit-a", "unit-b"] as const;

const actorArb: fc.Arbitrary<PayrollActor> = fc.record({
  sub: fc.constantFrom("user-1", "user-2"),
  roleCode: fc.constantFrom(...ALL_ROLE_CODES),
  unitId: fc.constantFrom(...UNITS, null),
});

const statusArb = fc.constantFrom<PayrollStatus>(...PAYROLL_STATUS_VALUES);
const actionArb = fc.constantFrom<PayrollAction>(...PAYROLL_ACTIONS);

const periodArb: fc.Arbitrary<PayrollPeriodFacts> = fc.record({
  unitId: fc.constantFrom(...UNITS),
  status: statusArb,
  createdById: fc.constantFrom("user-1", "user-2"),
  slipCount: fc.constantFrom(0, 1, 3),
});

const isUnitTreasurer = (roleCode: string) =>
  BENDAHARA_ROLE_CODES.includes(roleCode);
const isApprover = (roleCode: string) =>
  PAYROLL_APPROVER_ROLE_CODES.includes(roleCode);
const isComponentManager = (roleCode: string) =>
  PAYROLL_COMPONENT_MANAGER_ROLE_CODES.includes(roleCode);

// Feature: web-api-reconnect-phase-2, Property 11: Keputusan penggajian
describe("Property 11: the payroll decision table", () => {
  it("is total, and refuses in the order role → scope → creator → status", () => {
    fc.assert(
      fc.property(actorArb, actionArb, periodArb, (actor, action, period) => {
        const decision = decidePayroll(actor, action, period);

        // A refusal always names a status the API can answer with, and the
        // reason is a sentence for the person who sent the request.
        if (!decision.ok) {
          expect([403, 404, 409]).toContain(decision.status);
          expect(decision.reason.length).toBeGreaterThan(0);
        }

        // Role first: nobody outside the writer roles ever passes.
        const roleMayWrite =
          action === "COMPONENT_WRITE"
            ? isComponentManager(actor.roleCode)
            : action === "APPROVE"
              ? isApprover(actor.roleCode)
              : action === "CANCEL"
                ? isUnitTreasurer(actor.roleCode) || isApprover(actor.roleCode)
                : isUnitTreasurer(actor.roleCode);
        if (!roleMayWrite) {
          expect(decision).toMatchObject({ ok: false, status: 403 });
          return;
        }

        // Then scope: a unit treasurer only ever reaches its own unit.
        if (isUnitTreasurer(actor.roleCode) && actor.unitId !== period.unitId) {
          const actsOnPeriod =
            action !== "COMPONENT_WRITE" &&
            action !== "SALARY_WRITE" &&
            action !== "PERIOD_CREATE";
          if (actsOnPeriod) {
            expect(decision).toMatchObject({ ok: false, status: 404 });
            return;
          }
        }

        // Then the creator: no account approves what it drafted.
        if (action === "APPROVE" && actor.sub === period.createdById) {
          expect(decision).toMatchObject({ ok: false, status: 403 });
          return;
        }

        // Then the status.
        if (decision.ok) {
          switch (action) {
            case "APPROVE":
              expect(period.status).toBe("DRAFT");
              expect(period.slipCount).toBeGreaterThan(0);
              break;
            case "PAY":
              expect(period.status).toBe("APPROVED");
              break;
            case "PERIOD_UPDATE":
            case "GENERATE":
            case "ADJUST":
            case "DELETE":
              expect(period.status).toBe("DRAFT");
              break;
            case "CANCEL":
              expect(["DRAFT", "APPROVED"]).toContain(period.status);
              // A unit treasurer cancels only a DRAFT; an approver only an
              // APPROVED.
              if (isUnitTreasurer(actor.roleCode))
                expect(period.status).toBe("DRAFT");
              else expect(period.status).toBe("APPROVED");
              break;
            default:
              break;
          }
        } else {
          expect([403, 409]).toContain(decision.status);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("never lets Super_Admin or a non-approver organ write (R1.32, R1.33)", () => {
    fc.assert(
      fc.property(
        actionArb,
        periodArb,
        fc.constantFrom(...OTHER_WRITE_ROLES),
        (action, period, roleCode) => {
          const actor: PayrollActor = {
            sub: "user-x",
            roleCode,
            unitId: "unit-a",
          };
          expect(decidePayroll(actor, action, period)).toMatchObject({
            ok: false,
            status: 403,
          });
          expect(payrollButtons(actor, period)).not.toContain(action);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("never lets a PAID or CANCELLED period be cancelled or deleted", () => {
    fc.assert(
      fc.property(actorArb, periodArb, (actor, period) => {
        if (period.status !== "PAID" && period.status !== "CANCELLED") return;
        for (const action of ["CANCEL", "DELETE"] as const) {
          // The role check comes first: an account that may not attempt the
          // action at all is refused 403 whatever the status (R1.32, R1.33).
          const roleMayAttempt =
            action === "DELETE"
              ? isUnitTreasurer(actor.roleCode)
              : isUnitTreasurer(actor.roleCode) || isApprover(actor.roleCode);
          if (!roleMayAttempt) continue;
          // A treasurer asking about another unit's period learns nothing —
          // the 404 of an id that does not exist comes before the status.
          if (isUnitTreasurer(actor.roleCode) && actor.unitId !== period.unitId)
            continue;
          const decision = decidePayroll(actor, action, period);
          expect(
            decision,
            `${action} ${period.status} by ${actor.roleCode}`,
          ).toMatchObject({
            ok: false,
            status: 409,
          });
        }
      }),
      { numRuns: 200 },
    );
  });

  it("lets a period travel DRAFT → APPROVED → PAID and no further", () => {
    // The diagram of §4.1, walked as an order: each step is allowed only from
    // the status before it, and nothing moves a PAID period.
    fc.assert(
      fc.property(actorArb, periodArb, (actor, period) => {
        const path: PayrollAction[] = [
          "PERIOD_UPDATE",
          "GENERATE",
          "ADJUST",
          "APPROVE",
          "PAY",
        ];
        const stepStatus: Record<string, PayrollStatus> = {
          PERIOD_UPDATE: "DRAFT",
          GENERATE: "DRAFT",
          ADJUST: "DRAFT",
          APPROVE: "DRAFT",
          PAY: "APPROVED",
        };
        for (const action of path) {
          const decision = decidePayroll(actor, action, {
            ...period,
            status: stepStatus[action],
          });
          const allowedByRole =
            isUnitTreasurer(actor.roleCode) && action !== "APPROVE";
          const allowedByApprover =
            action === "APPROVE" && isApprover(actor.roleCode);
          const inScope =
            !isUnitTreasurer(actor.roleCode) || actor.unitId === period.unitId;
          const notCreator =
            action !== "APPROVE" || actor.sub !== period.createdById;
          const enoughSlips = action !== "APPROVE" || period.slipCount > 0;
          const expected =
            (allowedByRole || allowedByApprover) &&
            inScope &&
            notCreator &&
            enoughSlips;
          expect(decision.ok, `${action} by ${actor.roleCode}`).toBe(expected);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("draws a button exactly when its action is allowed", () => {
    fc.assert(
      fc.property(actorArb, periodArb, (actor, period) => {
        const buttons = payrollButtons(actor, period);
        for (const action of PAYROLL_ACTIONS) {
          expect(buttons.includes(action)).toBe(
            decidePayroll(actor, action, period).ok,
          );
        }
      }),
      { numRuns: 200 },
    );
  });
});

// Feature: web-api-reconnect-phase-2, Property 12: Penyetuju bukan pembuat
describe("Property 12: the approver is never the creator", () => {
  it("refuses every approval by the period creator, whatever the role or status", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...PAYROLL_APPROVER_ROLE_CODES),
        fc.constantFrom(...UNITS, null),
        statusArb,
        fc.constantFrom(0, 1, 5),
        (roleCode, unitId, status, slipCount) => {
          const creator = "user-creator";
          const actor: PayrollActor = { sub: creator, roleCode, unitId };
          const period: PayrollPeriodFacts = {
            unitId: "unit-a",
            status,
            createdById: creator,
            slipCount,
          };
          expect(decidePayroll(actor, "APPROVE", period)).toMatchObject({
            ok: false,
            status: 403,
          });
          expect(payrollButtons(actor, period)).not.toContain("APPROVE");
        },
      ),
      { numRuns: 200 },
    );
  });

  it("allows another approver to approve the same period", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...PAYROLL_APPROVER_ROLE_CODES),
        fc.integer({ min: 1, max: 5 }),
        (roleCode, slipCount) => {
          const actor: PayrollActor = {
            sub: "user-approver",
            roleCode,
            unitId: null,
          };
          const period: PayrollPeriodFacts = {
            unitId: "unit-a",
            status: "DRAFT",
            createdById: "user-creator",
            slipCount,
          };
          expect(decidePayroll(actor, "APPROVE", period)).toEqual({ ok: true });
        },
      ),
      { numRuns: 100 },
    );
  });
});
