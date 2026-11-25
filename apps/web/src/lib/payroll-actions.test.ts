import { describe, expect, it } from "vitest";
import { periodActionsFor, type PayrollActionsUser } from "./payroll-actions";

const APPROVER: PayrollActionsUser = {
  id: "user-approver",
  unitId: null,
  userRoles: [
    {
      isPrimary: true,
      role: { code: "YAYASAN_BENDAHARA" },
      unit: null,
    },
  ],
};

const TREASURER: PayrollActionsUser = {
  id: "user-treasurer",
  unitId: "unit-sd",
  userRoles: [
    {
      isPrimary: true,
      role: { code: "SDIT_BENDAHARA" },
      unit: { id: "unit-sd" },
    },
  ],
};

const DRAFT = {
  unitId: "unit-sd",
  status: "DRAFT" as const,
  createdById: "user-creator",
  approvedById: null,
};

describe("periodActionsFor", () => {
  it("does not offer Setujui for an empty draft", () => {
    expect(periodActionsFor(APPROVER, DRAFT)).not.toContain("APPROVE");
  });

  it("offers Setujui once the draft has a slip", () => {
    expect(
      periodActionsFor(APPROVER, { ...DRAFT, _count: { payrolls: 1 } }),
    ).toContain("APPROVE");
  });

  it("maps the API's _count.payrolls into the policy's slip count", () => {
    expect(
      periodActionsFor(APPROVER, {
        ...DRAFT,
        slipCount: undefined,
        _count: { payrolls: 3 },
        totalEmployees: 0,
      }),
    ).toContain("APPROVE");
  });

  it("never offers Setujui to the account that created the period", () => {
    expect(
      periodActionsFor(
        { ...APPROVER, id: "user-creator" },
        { ...DRAFT, _count: { payrolls: 2 } },
      ),
    ).not.toContain("APPROVE");
  });

  it("gives the unit treasurer Generate and Batalkan, never Setujui", () => {
    const actions = periodActionsFor(TREASURER, {
      ...DRAFT,
      _count: { payrolls: 2 },
    });
    expect(actions).toContain("GENERATE");
    expect(actions).toContain("CANCEL");
    expect(actions).not.toContain("APPROVE");
  });

  it("does not offer Tandai Dibayar to the account that approved the period", () => {
    const actions = periodActionsFor(
      { ...TREASURER, id: "user-approver" },
      {
        unitId: "unit-sd",
        status: "APPROVED",
        createdById: "user-creator",
        approvedById: "user-approver",
      },
    );
    expect(actions).not.toContain("PAY");
  });

  it("treats the legacy CALCULATED status as DRAFT, as the API does", () => {
    expect(
      periodActionsFor(APPROVER, {
        ...DRAFT,
        status: "CALCULATED",
        _count: { payrolls: 1 },
      }),
    ).toContain("APPROVE");
  });
});
