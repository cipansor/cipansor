/**
 * The type change and the tariff activation read the same business-unit row.
 * Without a row lock each can read the old type before the other commits, and
 * both commit: an active tariff on a unit that is no longer LAUNDRY, which
 * transaction creation then refuses. These cases run the real services against
 * PostgreSQL and hold the competing write in an uncommitted transaction, which
 * a Prisma mock cannot reproduce. Opt-in via RUN_DB_TESTS=1.
 */
import { describe, it, expect, vi } from "vitest";
import { Client } from "pg";
import { prisma } from "@/lib/prisma";
import { businessUnitService } from "@/modules/business-unit/business-unit.service";
import { pricingService } from "@/modules/laundry/laundry.service";

const describeDb = process.env.RUN_DB_TESTS ? describe : describe.skip;
vi.setConfig({ testTimeout: 30_000 });

const CONNECTION = process.env.DATABASE_URL;

async function fixture() {
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const unit = await prisma.unit.create({
    data: {
      name: `Lock Test ${stamp}`,
      type: "SMP_IT",
      address: "test",
    },
  });
  const businessUnit = await prisma.businessUnit.create({
    data: {
      unitId: unit.id,
      name: `Lock Test ${stamp}`,
      code: `LOCK-${stamp}`,
      type: "LAUNDRY",
    },
  });
  const pricing = await prisma.laundryPricing.create({
    data: {
      unitId: unit.id,
      businessUnitId: businessUnit.id,
      name: `Lock Tier ${stamp}`,
      pricePerKg: 6000,
      minWeight: 1,
      processDays: 2,
      isActive: false,
    },
  });
  return { unit, businessUnit, pricing };
}

async function cleanup({
  unit,
  businessUnit,
  pricing,
}: Awaited<ReturnType<typeof fixture>>) {
  await prisma.laundryPricing.deleteMany({ where: { id: pricing.id } });
  await prisma.businessUnit.deleteMany({ where: { id: businessUnit.id } });
  await prisma.unit.deleteMany({ where: { id: unit.id } });
}

describeDb("Laundry — tariff activation and a business-unit type change serialise", () => {
  it("waits for an in-flight type change before activating a tariff", async () => {
    const data = await fixture();
    const competing = new Client({ connectionString: CONNECTION });
    await competing.connect();
    try {
      await competing.query("BEGIN");
      await competing.query(
        "UPDATE business_units SET type = 'CANTEEN' WHERE id = $1",
        [data.businessUnit.id],
      );
      await competing.query(
        "SELECT id FROM business_units WHERE id = $1 FOR UPDATE",
        [data.businessUnit.id],
      );

      const activation = pricingService.update(
        data.pricing.id,
        data.unit.id,
        { isActive: true } as never,
      );
      await new Promise((resolve) => setTimeout(resolve, 250));
      await competing.query("COMMIT");

      await expect(activation).rejects.toMatchObject({
        statusCode: 400,
        message: expect.stringContaining("Unit usaha laundry tidak ditemukan"),
      });
      const stored = await prisma.laundryPricing.findUniqueOrThrow({
        where: { id: data.pricing.id },
      });
      expect(stored.isActive).toBe(false);
    } finally {
      await competing.query("ROLLBACK").catch(() => undefined);
      await competing.end();
      await cleanup(data);
    }
  });

  it("waits for an in-flight tariff activation before changing the type", async () => {
    const data = await fixture();
    const competing = new Client({ connectionString: CONNECTION });
    await competing.connect();
    try {
      await competing.query("BEGIN");
      await competing.query(
        "UPDATE laundry_pricings SET is_active = true WHERE id = $1",
        [data.pricing.id],
      );
      await competing.query(
        "SELECT id FROM business_units WHERE id = $1 FOR UPDATE",
        [data.businessUnit.id],
      );

      const change = businessUnitService.update(
        data.businessUnit.id,
        data.unit.id,
        { type: "CANTEEN" } as never,
      );
      await new Promise((resolve) => setTimeout(resolve, 250));
      await competing.query("COMMIT");

      await expect(change).rejects.toMatchObject({
        statusCode: 409,
        message: expect.stringContaining("tarif laundry aktif"),
      });
      const stored = await prisma.businessUnit.findUniqueOrThrow({
        where: { id: data.businessUnit.id },
      });
      expect(stored.type).toBe("LAUNDRY");
    } finally {
      await competing.query("ROLLBACK").catch(() => undefined);
      await competing.end();
      await cleanup(data);
    }
  });
});
