import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

vi.mock('../../../lib/prisma', () => {
  const mockPrisma = {
    invoice: { findUnique: vi.fn(), update: vi.fn() },
    payment: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    studentParent: { findUnique: vi.fn() },
    journalEntry: { create: vi.fn() },
    $transaction: vi.fn(),
  };
  mockPrisma.$transaction.mockImplementation((callback: any) => callback(mockPrisma));
  return { prisma: mockPrisma };
});

vi.mock('../../notifications/notifications.service', () => ({
  createNotification: vi.fn().mockResolvedValue({}),
}));

vi.mock('../accounting-config.service', () => ({
  ACCOUNT_MAPPING_KEYS: { BANK: 'BANK', CASH: 'CASH' },
  getAccountOrFallback: vi.fn().mockResolvedValue({ id: 'acc-bank' }),
}));

import { prisma } from '../../../lib/prisma';
import { submitPaymentProof, verifyPayment } from '../finance.service';

const mocked = prisma as any;

const parentUser = { sub: 'parent-1', role: 'PARENT', unitId: null };
const tuStaff = { sub: 'staff-1', role: 'STAFF', unitId: 'unit-1' };
const unitAdmin = { sub: 'admin-1', role: 'UNIT_ADMIN', unitId: 'unit-1' };
const otherUnitAdmin = { sub: 'admin-2', role: 'UNIT_ADMIN', unitId: 'unit-2' };

const baseInvoice = {
  id: 'inv-1',
  status: 'PENDING',
  amount: new Prisma.Decimal(500000),
  paidAmount: new Prisma.Decimal(0),
  invoiceNumber: 'INV-001',
  student: {
    id: 'student-1',
    userId: 'student-user-1',
    unitId: 'unit-1',
    user: { id: 'student-user-1', name: 'Santri A' },
  },
  paymentType: { id: 'pt-1', name: 'SPP', accountId: 'acc-revenue', unitId: 'unit-1' },
};

function paymentInStatus(status: string, extra: Record<string, unknown> = {}) {
  return {
    id: 'pay-1',
    invoiceId: 'inv-1',
    amount: new Prisma.Decimal(500000),
    method: 'BANK_TRANSFER',
    verificationStatus: status,
    tuVerifiedById: null,
    invoice: baseInvoice,
    ...extra,
  };
}

describe('submitPaymentProof', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.invoice.findUnique.mockResolvedValue(baseInvoice);
    mocked.payment.create.mockResolvedValue({ id: 'pay-1' });
  });

  it('rejects a parent without a link to the student', async () => {
    mocked.studentParent.findUnique.mockResolvedValue(null);

    await expect(
      submitPaymentProof(
        {
          invoiceId: 'inv-1',
          amount: 500000,
          method: 'BANK_TRANSFER' as any,
          proofUrl: 'https://files.example/proof.jpg',
        },
        parentUser
      )
    ).rejects.toThrow(/Access denied/);
    expect(mocked.payment.create).not.toHaveBeenCalled();
  });

  it('creates a PENDING_VERIFICATION payment without touching the invoice', async () => {
    mocked.studentParent.findUnique.mockResolvedValue({ id: 'link-1' });

    await submitPaymentProof(
      {
        invoiceId: 'inv-1',
        amount: 500000,
        method: 'BANK_TRANSFER' as any,
        proofUrl: 'https://files.example/proof.jpg',
      },
      parentUser
    );

    expect(mocked.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          verificationStatus: 'PENDING_VERIFICATION',
          proofUrl: 'https://files.example/proof.jpg',
        }),
      })
    );
    expect(mocked.invoice.update).not.toHaveBeenCalled();
    expect(mocked.journalEntry.create).not.toHaveBeenCalled();
  });

  it('rejects amounts above the remaining balance', async () => {
    mocked.studentParent.findUnique.mockResolvedValue({ id: 'link-1' });

    await expect(
      submitPaymentProof(
        {
          invoiceId: 'inv-1',
          amount: 600000,
          method: 'BANK_TRANSFER' as any,
          proofUrl: 'https://files.example/proof.jpg',
        },
        parentUser
      )
    ).rejects.toThrow(/remaining/);
  });
});

describe('verifyPayment state machine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.payment.update.mockImplementation(({ data }: any) =>
      Promise.resolve({ ...paymentInStatus('X'), ...data })
    );
    // Post-commit notification lookup
    mocked.payment.findUnique.mockResolvedValue({
      ...paymentInStatus('FINAL_APPROVED'),
      invoice: {
        ...baseInvoice,
        student: { userId: 'student-user-1', parents: [{ parentId: 'parent-1' }] },
      },
      rejectionReason: null,
    });
  });

  it('TU approves a pending payment', async () => {
    mocked.payment.findUnique.mockResolvedValueOnce(paymentInStatus('PENDING_VERIFICATION'));

    await verifyPayment('pay-1', 'TU_APPROVE', tuStaff);

    expect(mocked.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          verificationStatus: 'TU_APPROVED',
          tuVerifiedById: 'staff-1',
        }),
      })
    );
    expect(mocked.invoice.update).not.toHaveBeenCalled();
  });

  it('refuses FINAL_APPROVE straight from PENDING (no step skipping)', async () => {
    mocked.payment.findUnique.mockResolvedValueOnce(paymentInStatus('PENDING_VERIFICATION'));

    await expect(verifyPayment('pay-1', 'FINAL_APPROVE', unitAdmin)).rejects.toThrow(
      /Cannot final-approve/
    );
  });

  it('enforces separation of duties on final approval', async () => {
    mocked.payment.findUnique.mockResolvedValueOnce(
      paymentInStatus('TU_APPROVED', { tuVerifiedById: 'admin-1' })
    );

    await expect(verifyPayment('pay-1', 'FINAL_APPROVE', unitAdmin)).rejects.toThrow(
      /Separation of duties/
    );
  });

  it('final approval posts invoice + double-entry ledger exactly once', async () => {
    mocked.payment.findUnique.mockResolvedValueOnce(
      paymentInStatus('TU_APPROVED', { tuVerifiedById: 'staff-1' })
    );

    await verifyPayment('pay-1', 'FINAL_APPROVE', unitAdmin);

    expect(mocked.invoice.update).toHaveBeenCalledTimes(1);
    expect(mocked.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PAID' }),
      })
    );
    expect(mocked.journalEntry.create).toHaveBeenCalledTimes(2);
    expect(mocked.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          verificationStatus: 'FINAL_APPROVED',
          finalVerifiedById: 'admin-1',
        }),
      })
    );
  });

  it('is idempotent: re-approving a FINAL_APPROVED payment is refused', async () => {
    mocked.payment.findUnique.mockResolvedValueOnce(paymentInStatus('FINAL_APPROVED'));

    await expect(verifyPayment('pay-1', 'FINAL_APPROVE', unitAdmin)).rejects.toThrow(
      /Cannot final-approve/
    );
    expect(mocked.invoice.update).not.toHaveBeenCalled();
    expect(mocked.journalEntry.create).not.toHaveBeenCalled();
  });

  it('scopes verification to the verifier unit', async () => {
    mocked.payment.findUnique.mockResolvedValueOnce(paymentInStatus('PENDING_VERIFICATION'));

    await expect(verifyPayment('pay-1', 'TU_APPROVE', otherUnitAdmin)).rejects.toThrow(
      /another unit/
    );
  });

  it('santri yang sudah pindah unit: tagihan unit lamanya diverifikasi & dibukukan di unit TAGIHAN', async () => {
    // Santri kini di unit-2; SPP-nya terbit dari jenis bayar unit-1.
    const tagihanLama = { ...baseInvoice, student: { ...baseInvoice.student, unitId: 'unit-2' } };
    mocked.payment.findUnique.mockResolvedValueOnce(
      paymentInStatus('TU_APPROVED', { tuVerifiedById: 'staff-1', invoice: tagihanLama })
    );
    const { getAccountOrFallback } = await import('../accounting-config.service');

    await verifyPayment('pay-1', 'FINAL_APPROVE', unitAdmin);

    expect(getAccountOrFallback).toHaveBeenCalledWith('unit-1', 'BANK', '1102', 'Bank');
    expect(mocked.journalEntry.create).toHaveBeenCalledTimes(2);
    for (const [arg] of mocked.journalEntry.create.mock.calls) {
      expect(arg.data.unitId).toBe('unit-1');
    }
  });

  it('admin unit santri SEKARANG tidak memverifikasi tagihan unit lamanya', async () => {
    const tagihanLama = { ...baseInvoice, student: { ...baseInvoice.student, unitId: 'unit-2' } };
    mocked.payment.findUnique.mockResolvedValueOnce(
      paymentInStatus('PENDING_VERIFICATION', { invoice: tagihanLama })
    );

    await expect(verifyPayment('pay-1', 'TU_APPROVE', otherUnitAdmin)).rejects.toThrow(
      /another unit/
    );
    expect(mocked.payment.update).not.toHaveBeenCalled();
  });

  it('bendahara yayasan (tanpa unit) bisa memverifikasi antrean yang memang ditampilkan kepadanya', async () => {
    mocked.payment.findUnique.mockResolvedValueOnce(paymentInStatus('PENDING_VERIFICATION'));

    await verifyPayment('pay-1', 'TU_APPROVE', {
      sub: 'bendahara-yayasan',
      role: 'UNIT_ADMIN',
      roleCode: 'YAYASAN_BENDAHARA',
      unitId: null,
    });

    expect(mocked.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ verificationStatus: 'TU_APPROVED' }),
      })
    );
  });

  it('rejects with a reason', async () => {
    mocked.payment.findUnique.mockResolvedValueOnce(paymentInStatus('PENDING_VERIFICATION'));

    await verifyPayment('pay-1', 'REJECT', tuStaff, 'Bukti buram');

    expect(mocked.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          verificationStatus: 'REJECTED',
          rejectionReason: 'Bukti buram',
        }),
      })
    );
    expect(mocked.invoice.update).not.toHaveBeenCalled();
  });
});
