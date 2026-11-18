import { describe, expect, it } from 'vitest';
import { LAUNDRY_STATUS_VALUES } from '@cipansor/shared';
import {
  UpdatePricingSchema,
  UpdateStatusSchema,
  ListTransactionsQuerySchema,
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
