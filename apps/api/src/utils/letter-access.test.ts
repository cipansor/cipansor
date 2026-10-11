import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RoleCode, LetterNature } from '@prisma/client';
import { mayEditLetter, LETTER_UNIT_SCOPE_ROLES } from '@cipansor/shared';

vi.mock('@/lib/prisma', () => ({
  prisma: { letter: { findUnique: vi.fn() } },
}));

import { prisma } from '@/lib/prisma';
import {
  assertLetterAccess,
  letterScopeWhere,
  handlesUnitCorrespondence,
  choosesUnit,
} from './letter-access';

/**
 * `GET /correspondence/letters/:id` had no authorisation whatsoever, so these
 * tests are about the specific people who could read a confidential letter
 * before, not about the abstract rule.
 */

const SMP = 'unit-smp';

/** A letter belonging to SMP IT with nobody attached to it. */
function bareLetter(overrides: Record<string, unknown> = {}) {
  return {
    id: 'letter-1',
    unitId: SMP,
    createdById: 'tu-smp',
    nature: LetterNature.PUBLIC,
    reviewers: [],
    recipients: [],
    dispositions: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(prisma.letter.findUnique).mockReset();
});

describe('assertLetterAccess', () => {
  it('refuses a parent of the same unit', async () => {
    vi.mocked(prisma.letter.findUnique).mockResolvedValue(bareLetter() as never);

    // Every parent and student in production carries a unit_id, which is why
    // "same unit may read" would have been the wrong repair.
    await expect(
      assertLetterAccess(
        { id: 'wali-1', roleCode: RoleCode.SMPIT_ORANG_TUA, unitId: SMP },
        'letter-1'
      )
    ).rejects.toThrow(/tidak memiliki akses/i);
  });

  it('refuses a student of the same unit', async () => {
    vi.mocked(prisma.letter.findUnique).mockResolvedValue(bareLetter() as never);

    await expect(
      assertLetterAccess(
        { id: 'santri-1', roleCode: RoleCode.SMPIT_SISWA, unitId: SMP },
        'letter-1'
      )
    ).rejects.toThrow(/tidak memiliki akses/i);
  });

  it('allows the unit tata usaha', async () => {
    vi.mocked(prisma.letter.findUnique).mockResolvedValue(bareLetter() as never);

    await expect(
      assertLetterAccess(
        { id: 'tu-2', roleCode: RoleCode.SMPIT_TATA_USAHA, unitId: SMP },
        'letter-1'
      )
    ).resolves.toBeTruthy();
  });

  it('refuses tata usaha of a different unit', async () => {
    vi.mocked(prisma.letter.findUnique).mockResolvedValue(bareLetter() as never);

    await expect(
      assertLetterAccess(
        { id: 'tu-sd', roleCode: RoleCode.SDIT_TATA_USAHA, unitId: 'unit-sd' },
        'letter-1'
      )
    ).rejects.toThrow(/tidak memiliki akses/i);
  });

  // The yayasan board has no unitId at all — the old controller answered them
  // with 403 and broke the routing chain this module exists for.
  it('allows the yayasan sekretaris despite having no unit', async () => {
    vi.mocked(prisma.letter.findUnique).mockResolvedValue(bareLetter() as never);

    await expect(
      assertLetterAccess(
        { id: 'sekretaris', roleCode: RoleCode.YAYASAN_SEKRETARIS, unitId: null },
        'letter-1'
      )
    ).resolves.toBeTruthy();
  });

  // A disposition is what carries a letter across unit boundaries, so it has
  // to be a grant of access in its own right.
  it('allows a disposition recipient from another unit', async () => {
    vi.mocked(prisma.letter.findUnique).mockResolvedValue(
      bareLetter({
        dispositions: [{ senderId: 'ketua', recipientId: 'kepsek-smp' }],
      }) as never
    );

    await expect(
      assertLetterAccess(
        { id: 'kepsek-smp', roleCode: RoleCode.SDIT_GURU, unitId: 'unit-sd' },
        'letter-1'
      )
    ).resolves.toBeTruthy();
  });

  it('allows an assigned reviewer', async () => {
    vi.mocked(prisma.letter.findUnique).mockResolvedValue(
      bareLetter({ reviewers: [{ reviewerId: 'guru-1' }] }) as never
    );

    await expect(
      assertLetterAccess(
        { id: 'guru-1', roleCode: RoleCode.SDIT_GURU, unitId: 'unit-sd' },
        'letter-1'
      )
    ).resolves.toBeTruthy();
  });

  it('allows the author', async () => {
    vi.mocked(prisma.letter.findUnique).mockResolvedValue(bareLetter() as never);

    await expect(
      assertLetterAccess(
        { id: 'tu-smp', roleCode: RoleCode.SDIT_GURU, unitId: 'unit-sd' },
        'letter-1'
      )
    ).resolves.toBeTruthy();
  });

  it('reports a missing letter as not found', async () => {
    vi.mocked(prisma.letter.findUnique).mockResolvedValue(null as never);

    await expect(
      assertLetterAccess({ id: 'x', roleCode: RoleCode.SUPER_ADMIN }, 'nope')
    ).rejects.toThrow(/not found/i);
  });
});

describe('letterScopeWhere', () => {
  it('does not filter for the yayasan board', () => {
    expect(
      letterScopeWhere({ id: 'ketua', roleCode: RoleCode.YAYASAN_KETUA, unitId: null })
    ).toEqual({});
  });

  it('filters tata usaha to their own unit, but not its classified letters', () => {
    const where = letterScopeWhere({
      id: 'tu',
      roleCode: RoleCode.SMPIT_TATA_USAHA,
      unitId: SMP,
    });

    // Two branches: the unit's own book, and anything assigned to this actor
    // from elsewhere (a disposition or a review).
    const or = where.OR as Array<Record<string, unknown>>;
    expect(or).toHaveLength(2);

    // The unit clause is still there…
    const ownUnit = or[0].AND as Array<Record<string, unknown>>;
    expect(ownUnit[0]).toEqual({ unitId: SMP });
    // …but a Rahasia / Sangat Rahasia naskah in that unit only appears when the
    // office is genuinely inside its chain, so the classification is a real
    // access boundary and not just a printed marking.
    const natureOrChain = (ownUnit[1] as { OR: unknown[] }).OR;
    expect(JSON.stringify(natureOrChain)).toContain('CONFIDENTIAL');
    expect(JSON.stringify(natureOrChain)).toContain('STRICTLY_CONFIDENTIAL');

    // The second branch is the chain itself: a letter assigned to this actor
    // from another unit must appear, because `assertLetterAccess` already opens
    // its direct URL — the list and the direct read have to agree.
    const chain = (or[1] as { OR: unknown[] }).OR;
    expect(chain).toHaveLength(4);
    expect(JSON.stringify(chain)).toContain('dispositions');
  });

  // The list-shaped version of the same hole: scoping a parent by unitId would
  // have listed the whole school's letter book to them.
  it('confines a parent to letters they are part of, not to their unit', () => {
    const where = letterScopeWhere({
      id: 'wali-1',
      roleCode: RoleCode.SMPIT_ORANG_TUA,
      unitId: SMP,
    });

    expect(where.unitId).toBeUndefined();
    // The chain, plus the CC-carve-out that is denied for classified letters.
    expect(where.OR).toHaveLength(2);
    const chain = (where.OR?.[0] as { OR: unknown[] }).OR;
    expect(chain).toHaveLength(4);
  });

  it('keeps a classified letter out of a unit office’s scope', () => {
    const where = letterScopeWhere({
      id: 'tu',
      roleCode: RoleCode.SMPIT_TATA_USAHA,
      unitId: SMP,
    });

    // The restricted exclusion is a NOT-IN of both classified levels, so the
    // unit office's ordinary letter book is exactly what remains.
    expect(JSON.stringify(where)).toContain('"notIn"');
  });

  // Regression: the scope clause used `seesAllUnits`, which is broad enough for
  // shared services (a librarian sees every santri) but not for correspondence.
  // It handed every cross-unit service account — pustakawan, perawat, keamanan,
  // musyrif, ustadz, laboran — the whole yayasan's letter book, unclassified
  // letters included, and let them pass `?unitId=` to read another unit's
  // agenda. Access is by the chain, exactly as for a parent.
  it('confines a cross-unit service role to the letters they are part of', () => {
    for (const roleCode of [
      RoleCode.PUSTAKAWAN,
      RoleCode.PERAWAT,
      RoleCode.KEAMANAN,
      RoleCode.MUSYRIF,
      RoleCode.USTADZ,
      RoleCode.LABORAN,
    ]) {
      const where = letterScopeWhere({ id: 'svc-1', roleCode, unitId: SMP });
      expect(where.unitId).toBeUndefined();
      expect(where.OR).toHaveLength(2);
    }
  });
});

describe('classified letters restrict access (ANRI SKKAAD)', () => {
  it('refuses the unit office a Rahasia letter it is not part of', async () => {
    vi.mocked(prisma.letter.findUnique).mockResolvedValue(
      bareLetter({ nature: LetterNature.CONFIDENTIAL }) as never
    );

    await expect(
      assertLetterAccess(
        { id: 'tu-2', roleCode: RoleCode.SMPIT_TATA_USAHA, unitId: SMP },
        'letter-1'
      )
    ).rejects.toThrow(/tidak memiliki akses/i);
  });

  it('still admits the author of a Sangat Rahasia letter', async () => {
    vi.mocked(prisma.letter.findUnique).mockResolvedValue(
      bareLetter({
        nature: LetterNature.STRICTLY_CONFIDENTIAL,
        createdById: 'tu-smp',
      }) as never
    );

    await expect(
      assertLetterAccess(
        { id: 'tu-smp', roleCode: RoleCode.SMPIT_TATA_USAHA, unitId: SMP },
        'letter-1'
      )
    ).resolves.toBeTruthy();
  });

  // A primary addressee of a Rahasia letter is inside its chain by design: the
  // chain is what authorises the people who must act on the naskah, and the
  // addressee is the first of them. This test pins that so the behaviour is a
  // decision on the record, not an accident (see the design note in
  // letter-access.ts: `isPrimaryRecipient` excludes tembusan, not the addressee).
  it('admits the primary recipient of a Rahasia letter (in-chain by design)', async () => {
    vi.mocked(prisma.letter.findUnique).mockResolvedValue(
      bareLetter({
        nature: LetterNature.CONFIDENTIAL,
        recipients: [{ userId: 'kepsek-smp', isCC: false }],
      }) as never
    );

    await expect(
      assertLetterAccess(
        { id: 'kepsek-smp', roleCode: RoleCode.SMPIT_KEPALA_SEKOLAH, unitId: SMP },
        'letter-1'
      )
    ).resolves.toBeTruthy();
  });

  it('refuses a tembusan recipient of a Rahasia letter', async () => {
    vi.mocked(prisma.letter.findUnique).mockResolvedValue(
      bareLetter({
        nature: LetterNature.CONFIDENTIAL,
        recipients: [{ userId: 'cc-1', isCC: true }],
      }) as never
    );

    await expect(
      assertLetterAccess(
        { id: 'cc-1', roleCode: RoleCode.SDIT_GURU, unitId: 'unit-sd' },
        'letter-1'
      )
    ).rejects.toThrow(/tidak memiliki akses/i);
  });

  it('admits the yayasan pengawas to a classified letter (oversight)', async () => {
    vi.mocked(prisma.letter.findUnique).mockResolvedValue(
      bareLetter({ nature: LetterNature.CONFIDENTIAL }) as never
    );

    await expect(
      assertLetterAccess(
        { id: 'pengawas', roleCode: RoleCode.YAYASAN_PENGAWAS, unitId: null },
        'letter-1'
      )
    ).resolves.toBeTruthy();
  });

  it('still allows an ordinary letter to the unit office', async () => {
    vi.mocked(prisma.letter.findUnique).mockResolvedValue(
      bareLetter({ nature: LetterNature.LIMITED }) as never
    );

    await expect(
      assertLetterAccess(
        { id: 'tu-2', roleCode: RoleCode.SMPIT_TATA_USAHA, unitId: SMP },
        'letter-1'
      )
    ).resolves.toBeTruthy();
  });

  // Regression: assertLetterAccess returned any letter for a `seesAllUnits`
  // actor, so a cross-unit service role could fetch a school's ordinary letter
  // by id. It now opens only to the foundation board, or to a chain member.
  it('refuses a cross-unit service role a letter it is not part of', async () => {
    vi.mocked(prisma.letter.findUnique).mockResolvedValue(
      bareLetter({ nature: LetterNature.LIMITED }) as never
    );

    await expect(
      assertLetterAccess(
        { id: 'pustakawan-1', roleCode: RoleCode.PUSTAKAWAN, unitId: SMP },
        'letter-1'
      )
    ).rejects.toThrow(/tidak memiliki akses/);
  });
});

describe('role helpers', () => {
  it('treats correspondence roles and the board differently', () => {
    expect(handlesUnitCorrespondence({ id: 'a', roleCode: RoleCode.SMPIT_TATA_USAHA })).toBe(true);
    expect(handlesUnitCorrespondence({ id: 'b', roleCode: RoleCode.SMPIT_ORANG_TUA })).toBe(false);
    expect(choosesUnit({ id: 'c', roleCode: RoleCode.YAYASAN_KETUA })).toBe(true);
    expect(choosesUnit({ id: 'd', roleCode: RoleCode.SMPIT_TATA_USAHA })).toBe(false);
  });

  // Regression: `choosesUnit` was `seesAllUnits`, so a cross-unit service role
  // could pass `?unitId=` and read any unit's letter book. Only the foundation
  // board (and super admin) may choose a unit here.
  it('does not let a cross-unit service role choose a unit', () => {
    for (const roleCode of [
      RoleCode.PUSTAKAWAN,
      RoleCode.PERAWAT,
      RoleCode.KEAMANAN,
      RoleCode.MUSYRIF,
      RoleCode.USTADZ,
      RoleCode.LABORAN,
      RoleCode.PESANTREN_TATA_USAHA,
    ]) {
      expect(choosesUnit({ id: 'svc-1', roleCode, unitId: SMP })).toBe(false);
    }
  });
});

describe('mayEditLetter (shared single source with the API updateLetter guard)', () => {
  it('allows every LETTER_UNIT_SCOPE_ROLES member', () => {
    // The old UI showed the edit button only for SUPER_ADMIN / SDIT_ADMIN,
    // leaving tata usaha & kepala sekolah of every unit unable to edit a
    // naskah the backend allowed them to change.
    expect(mayEditLetter(RoleCode.SDIT_KEPALA_SEKOLAH)).toBe(true);
    expect(mayEditLetter(RoleCode.SMPIT_KEPALA_SEKOLAH)).toBe(true);
    expect(mayEditLetter(RoleCode.TKQ_TATA_USAHA)).toBe(true);
    expect(mayEditLetter(RoleCode.SMPIT_TATA_USAHA)).toBe(true);
    expect(mayEditLetter(RoleCode.PESANTREN_TATA_USAHA)).toBe(true);
    expect(mayEditLetter(RoleCode.SDIT_ADMIN)).toBe(true);
    expect(mayEditLetter(RoleCode.TKQ_ADMIN)).toBe(true);

    for (const code of LETTER_UNIT_SCOPE_ROLES) {
      expect(mayEditLetter(code)).toBe(true);
    }
  });

  it('allows the executive foundation roles the API treats as editors', () => {
    expect(mayEditLetter(RoleCode.SUPER_ADMIN)).toBe(true);
    expect(mayEditLetter(RoleCode.YAYASAN_KETUA)).toBe(true);
    expect(mayEditLetter(RoleCode.YAYASAN_SEKRETARIS)).toBe(true);
  });

  it('rejects non-correspondence roles and missing role codes', () => {
    expect(mayEditLetter(RoleCode.SMPIT_ORANG_TUA)).toBe(false);
    expect(mayEditLetter(RoleCode.SMPIT_SISWA)).toBe(false);
    expect(mayEditLetter(undefined)).toBe(false);
    expect(mayEditLetter(null)).toBe(false);
  });
});
