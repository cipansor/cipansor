import { describe, expect, it } from "vitest";
import { changedAccountMappings } from "./accounting-settings";

const TAX = "ACCOUNT_MAPPING_TAX_PAYABLE";
const CASH = "ACCOUNT_MAPPING_CASH";

describe("changedAccountMappings", () => {
  it("leaves an untouched invalid PPh 21 mapping out of a cash-only save", () => {
    const initial = { [TAX]: "acc-invalid", [CASH]: "acc-old-cash" };
    const current = { ...initial, [CASH]: "acc-new-cash" };

    expect(changedAccountMappings(initial, current, new Set([CASH]))).toEqual({
      [CASH]: "acc-new-cash",
    });
  });

  it("sends null only when the operator clears a mapping", () => {
    const initial = { [TAX]: "acc-pph21" };
    const current = { [TAX]: null };

    expect(changedAccountMappings(initial, current, new Set([TAX]))).toEqual({
      [TAX]: null,
    });
  });

  it("omits a touched field changed back to its loaded value", () => {
    const initial = { [CASH]: "acc-cash" };
    const current = { [CASH]: "acc-cash" };

    expect(changedAccountMappings(initial, current, new Set([CASH]))).toEqual(
      {},
    );
  });
});
