import { describe, expect, it } from 'vitest';
import { LAUNDRY_STATUS_VALUES } from '@cipansor/shared';
import {
  UpdatePricingSchema,
  UpdateStatusSchema,
  ListTransactionsQuerySchema,
  CreateTransactionSchema,
  CreatePricingSchema,
} from '../laundry.schema';

describe('laundry update schemas (Zod 4 partial-overwrite regression)', () => {
  describe('UpdatePricingSchema', () => {
    it('does not leak minWeight/processDays/isExpress/isActive defaults when only name is sent', () => {
      const parsed = UpdatePricingSchema.parse({ name: 'Paket Cuci' });
      expect(parsed).toEqual({ name: 'Paket Cuci' });
    });

    it('parses an empty object to only the keys actually sent', () => {
      expect(UpdatePricingSchema.parse({})).toEqual({});
    });

    it('keeps explicitly provided defaulted fields', () => {
      const parsed = UpdatePricingSchema.parse({ minWeight: 3, isExpress: true });
      expect(parsed).toEqual({ minWeight: 3, isExpress: true });
    });

    it('still validates provided values on defaulted fields', () => {
      expect(UpdatePricingSchema.safeParse({ processDays: 0 }).success).toBe(false);
    });
  });

  // #989 (PR-03) review: the API's status validation must accept exactly the
  // shared list the Portal reads, so a status the Portal offers can never be a
  // 400 at the API. A status the shared list does not name is rejected.
  describe('CreatePricingSchema', () => {
    it('accepts a laundry business unit, or no link at all', () => {
      const base = { name: 'Setrika', pricePerKg: 5000 };
      expect(
        CreatePricingSchema.safeParse({
          ...base,
          businessUnitId: '00000000-0000-4000-8000-000000000001',
        }).success
      ).toBe(true);
      expect(CreatePricingSchema.safeParse({ ...base, businessUnitId: null }).success).toBe(true);
    });

    it('rejects a businessUnitId that is not a UUID', () => {
      expect(
        CreatePricingSchema.safeParse({
          name: 'Setrika',
          pricePerKg: 5000,
          businessUnitId: 'bu-1',
        }).success
      ).toBe(false);
    });
  });

  describe('CreateTransactionSchema', () => {
    it('drops a client-supplied businessUnitId; the tier chooses the unit', () => {
      const parsed = CreateTransactionSchema.parse({
        studentId: '00000000-0000-4000-8000-000000000001',
        pricingId: '00000000-0000-4000-8000-000000000002',
        weight: 2,
        paymentMethod: 'CASH',
        businessUnitId: '00000000-0000-4000-8000-000000000003',
      });
      expect(parsed).not.toHaveProperty('businessUnitId');
    });
  });

  describe('status validation shares one definition with the Portal', () => {
    it('accepts every status in LAUNDRY_STATUS_VALUES', () => {
      for (const status of LAUNDRY_STATUS_VALUES) {
        expect(UpdateStatusSchema.safeParse({ status }).success, status).toBe(true);
        expect(ListTransactionsQuerySchema.safeParse({ status }).success, status).toBe(true);
      }
    });

    it('rejects a status outside LAUNDRY_STATUS_VALUES', () => {
      expect(UpdateStatusSchema.safeParse({ status: 'PACKING' }).success).toBe(false);
      expect(ListTransactionsQuerySchema.safeParse({ status: 'PACKING' }).success).toBe(false);
    });
  });
});
