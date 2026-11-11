import { describe, it, expect, vi, beforeEach } from 'vitest';

// The Profil Yayasan form (`/foundation`) saves through `PUT /foundation/:id`.
// Its date input gives a calendar day, which the API refused until the schema
// took `YYYY-MM-DD`; and a field the user emptied was dropped by the form, so
// the old value stayed while the page said "berhasil". An emptied field now
// arrives as `null` and clears the column.
vi.mock('@/lib/prisma', () => ({
  prisma: { foundation: { update: vi.fn() } },
}));

import { prisma } from '@/lib/prisma';
import { updateFoundationSchema } from '../foundation.schema';
import { updateFoundation } from '../foundation.service';

const updated = () => vi.mocked(prisma.foundation.update).mock.calls[0][0].data;

beforeEach(() => vi.clearAllMocks());

describe('PUT /foundation/:id — the profile form', () => {
  it('accepts the calendar day the date picker gives', () => {
    expect(updateFoundationSchema.safeParse({ foundingDate: '1998-07-01' }).success).toBe(true);
    expect(
      updateFoundationSchema.safeParse({ foundingDate: '1998-07-01T00:00:00.000Z' }).success
    ).toBe(true);
    expect(updateFoundationSchema.safeParse({ foundingDate: '01/07/1998' }).success).toBe(false);
  });

  it('clears an emptied optional field instead of keeping the old value', async () => {
    const body = updateFoundationSchema.parse({
      name: 'Yayasan Pesantren Cipansor',
      website: null,
      email: null,
      foundingDate: null,
      vision: null,
    });
    await updateFoundation('yayasan-1', body);
    expect(updated()).toMatchObject({
      name: 'Yayasan Pesantren Cipansor',
      website: null,
      email: null,
      foundingDate: null,
      vision: null,
    });
  });

  it('keeps a field the request leaves out', async () => {
    await updateFoundation('yayasan-1', updateFoundationSchema.parse({ phone: '0265-123' }));
    expect(updated()).toEqual({ phone: '0265-123', foundingDate: undefined });
  });

  it('stores a calendar day as that day', async () => {
    await updateFoundation(
      'yayasan-1',
      updateFoundationSchema.parse({ foundingDate: '1998-07-01' })
    );
    expect((updated().foundingDate as Date).toISOString()).toBe('1998-07-01T00:00:00.000Z');
  });

  it('does not let the required fields be cleared', () => {
    expect(updateFoundationSchema.safeParse({ name: null }).success).toBe(false);
    expect(updateFoundationSchema.safeParse({ address: null }).success).toBe(false);
  });

  it('still checks the format of what is sent', () => {
    expect(updateFoundationSchema.safeParse({ email: 'bukan-surel' }).success).toBe(false);
    expect(updateFoundationSchema.safeParse({ website: 'cipansor' }).success).toBe(false);
  });
});
