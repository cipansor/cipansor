import { describe, it, expect } from 'vitest';
import { PayrollStatus, RoleCode } from '@prisma/client';
import {
  BENDAHARA_ROLE_CODES,
  GOVERNANCE_ROLE_CODES,
  PAYROLL_APPROVER_ROLE_CODES,
  PAYROLL_COMPONENT_MANAGER_ROLE_CODES,
  PAYROLL_READER_ROLE_CODES,
  PAYROLL_STATUS_VALUES,
  PAYROLL_ACTIONS,
  payrollButtons,
  type PayrollActor,
} from '@cipansor/shared';

/**
 * The web cannot import @prisma/client, so `payroll-policy.ts` repeats the
 * `PayrollStatus` vocabulary and the role lists. This is what keeps the copies
 * honest (#990): a status added to the database must be added to the policy,
 * and a role code in a payroll list must exist.
 */

describe('the shared payroll contract matches the database', () => {
  it('payroll statuses', () => {
    expect([...PAYROLL_STATUS_VALUES].sort()).toEqual(Object.values(PayrollStatus).sort());
  });

  it('every role code in the payroll lists exists', () => {
    const known = new Set<string>(Object.values(RoleCode));
    for (const code of [
      ...PAYROLL_READER_ROLE_CODES,
      ...PAYROLL_APPROVER_ROLE_CODES,
      ...PAYROLL_COMPONENT_MANAGER_ROLE_CODES,
    ]) {
      expect(known.has(code), code).toBe(true);
    }
  });

  it('readers are Super_Admin, the organs and the unit treasurers — nobody else', () => {
    expect(PAYROLL_READER_ROLE_CODES).toContain('SUPER_ADMIN');
    for (const code of GOVERNANCE_ROLE_CODES) expect(PAYROLL_READER_ROLE_CODES).toContain(code);
    for (const code of BENDAHARA_ROLE_CODES) expect(PAYROLL_READER_ROLE_CODES).toContain(code);
    // Admin_Unit, Kepala_Unit, TU_Unit and Guru are not readers (R1.14).
    for (const code of ['SDIT_ADMIN', 'SDIT_KEPALA', 'SDIT_TATA_USAHA', 'SDIT_GURU']) {
      expect(PAYROLL_READER_ROLE_CODES).not.toContain(code);
    }
  });

  it('the approvers are the two organs the owner named, and no treasurer', () => {
    expect([...PAYROLL_APPROVER_ROLE_CODES].sort()).toEqual(['YAYASAN_BENDAHARA', 'YAYASAN_KETUA']);
    for (const code of BENDAHARA_ROLE_CODES) {
      expect(PAYROLL_APPROVER_ROLE_CODES).not.toContain(code);
    }
  });

  it('only Bendahara_Yayasan writes components — the yayasan is the employer', () => {
    expect([...PAYROLL_COMPONENT_MANAGER_ROLE_CODES]).toEqual(['YAYASAN_BENDAHARA']);
  });
});

describe('payrollButtons — the portal draws only what the API would accept', () => {
  const treasurer: PayrollActor = {
    sub: 'u-treasurer',
    roleCode: 'SDIT_BENDAHARA',
    unitId: 'unit-sd',
  };
  const yayasanBendahara: PayrollActor = {
    sub: 'u-yayasan',
    roleCode: 'YAYASAN_BENDAHARA',
    unitId: null,
  };

  const draft = {
    unitId: 'unit-sd',
    status: 'DRAFT' as const,
    createdById: 'u-treasurer',
    approvedById: null,
    slipCount: 2,
  };
  const approved = {
    ...draft,
    status: 'APPROVED' as const,
    approvedById: 'u-yayasan',
  };
  const paid = { ...approved, status: 'PAID' as const };

  /** The buttons that act on one period — the ones that change with its state. */
  const periodButtons = (actor: PayrollActor, period: Parameters<typeof payrollButtons>[1]) =>
    payrollButtons(actor, period).filter(
      (a) => a !== 'SALARY_WRITE' && a !== 'PERIOD_CREATE' && a !== 'COMPONENT_WRITE'
    );

  it('lists each action once, and only actions the policy declares', () => {
    const buttons = payrollButtons(treasurer, draft);
    expect(new Set(buttons).size).toBe(buttons.length);
    for (const action of buttons) expect(PAYROLL_ACTIONS).toContain(action);
  });

  it('a treasurer drafts its own DRAFT period and approves nothing', () => {
    const buttons = periodButtons(treasurer, draft);
    expect(buttons).toEqual(
      expect.arrayContaining(['PERIOD_UPDATE', 'GENERATE', 'CANCEL', 'DELETE'])
    );
    expect(buttons).not.toContain('APPROVE');
    expect(buttons).not.toContain('PAY');
    expect(buttons).not.toContain('COMPONENT_WRITE');
  });

  it('a treasurer can pay an APPROVED period but not edit, cancel or delete it', () => {
    expect(periodButtons(treasurer, approved)).toEqual(['PAY']);
  });

  it('a PAID period offers no period action — not even cancel', () => {
    expect(periodButtons(treasurer, paid)).toEqual([]);
  });

  it('Bendahara_Yayasan approves a DRAFT period and never pays', () => {
    const buttons = periodButtons(yayasanBendahara, draft);
    expect(buttons).toContain('APPROVE');
    // Cancelling a DRAFT period is the drafter's act, not the approver's (R1.31).
    expect(buttons).not.toContain('CANCEL');
    expect(buttons).not.toContain('PAY');
    // Components carry no period, so the button is offered regardless of one.
    expect(payrollButtons(yayasanBendahara, draft)).toContain('COMPONENT_WRITE');
  });

  it('Bendahara_Yayasan cancels an APPROVED period and still never pays', () => {
    const buttons = periodButtons(yayasanBendahara, approved);
    expect(buttons).toEqual(['CANCEL']);
  });

  it('the creator of a period is offered no APPROVE button for it', () => {
    const ownPeriod = { ...draft, createdById: yayasanBendahara.sub };
    expect(periodButtons(yayasanBendahara, ownPeriod)).not.toContain('APPROVE');
  });

  it('the approver is offered no PAY button, even when it also holds a unit treasurer role', () => {
    const dualRole: PayrollActor = {
      sub: 'u-yayasan',
      roleCode: 'SDIT_BENDAHARA',
      unitId: 'unit-sd',
    };
    expect(periodButtons(dualRole, approved)).not.toContain('PAY');
  });

  it('another unit’s period offers a treasurer no period action', () => {
    const elsewhere = { ...draft, unitId: 'unit-smp' };
    expect(periodButtons(treasurer, elsewhere)).toEqual([]);
  });
});
