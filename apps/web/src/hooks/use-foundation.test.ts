import { describe, it, expect } from "vitest";
import { foundationProfilePayload } from "./use-foundation";

const form = {
  name: "Yayasan Pesantren Cipansor",
  legalName: "Yayasan Pesantren Cipansor",
  address: "Jl. Cipansor No. 1",
  taxId: "",
  phone: " 0265-123 ",
  email: "",
  website: "",
  vision: "Visi",
  mission: "",
  foundingDate: "",
};

describe("foundationProfilePayload — the Profil Yayasan form", () => {
  it("sends an emptied optional field as null so the API clears it", () => {
    expect(foundationProfilePayload(form)).toEqual({
      name: "Yayasan Pesantren Cipansor",
      legalName: "Yayasan Pesantren Cipansor",
      address: "Jl. Cipansor No. 1",
      taxId: null,
      phone: "0265-123",
      email: null,
      website: null,
      vision: "Visi",
      mission: null,
      foundingDate: null,
    });
  });

  it("sends an emptied required field as typed, for the API to refuse", () => {
    expect(foundationProfilePayload({ ...form, name: "  " }).name).toBe("");
  });

  it("keeps the date the picker gives", () => {
    expect(
      foundationProfilePayload({ ...form, foundingDate: "1998-07-01" })
        .foundingDate,
    ).toBe("1998-07-01");
  });
});
