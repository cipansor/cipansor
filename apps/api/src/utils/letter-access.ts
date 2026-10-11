import { Prisma, LetterStatus, LetterDirection, LetterNature, RoleCode } from '@prisma/client';
import { LETTER_UNIT_SCOPE_ROLES } from '@cipansor/shared';
import { prisma } from '@/lib/prisma';
import { Errors } from '@/middleware/error';
import { isFoundationScopedRole } from './resolve-unit-id';

/**
 * Who may read a letter.
 *
 * `GET /correspondence/letters/:id` had no authorisation at all: any
 * authenticated account could fetch any letter by id, read its body and follow
 * its `fileUrl` — including letters marked CONFIDENTIAL or
 * STRICTLY_CONFIDENTIAL. Every wali murid and every santri has a login, so the
 * exposed set was not hypothetical.
 *
 * The obvious repair — "same unit may read" — is wrong here, and measurably
 * so: every parent and student row in production carries a `unit_id`, so that
 * rule would have handed a school's confidential correspondence to its own
 * parents. Unit membership is not a job description.
 *
 * So access is granted on two grounds instead:
 *
 *   1. Being *in the letter's chain* — its author, an assigned reviewer, a
 *      recipient, or either end of a disposition. This is what makes routing
 *      work across units: the ketua yayasan disposes a letter to the SMP IT
 *      headmaster, and that disposition is itself the grant.
 *
 *   2. Holding a role whose remit is correspondence, listed below. These are
 *      the people who must see a unit's letter book as a whole rather than
 *      only the items addressed to them personally.
 */

/**
 * Roles that handle a unit's correspondence as part of the job: the office
 * that registers and files letters, and the head who signs them.
 *
 * The list now lives in `@cipansor/shared` (`LETTER_UNIT_SCOPE_ROLES`) so the
 * API guard here and the E-Office "Edit Naskah Surat" UI toggle read the same
 * source and can never drift apart again. It is re-exported for any existing
 * importer of this module.
 */
export { LETTER_UNIT_SCOPE_ROLES } from '@cipansor/shared';

export type LetterActor = {
  id: string;
  role?: string | null;
  roleCode?: string | null;
  unitId?: string | null;
};

/** True when the actor may browse a whole unit's letters, not just their own. */
export function handlesUnitCorrespondence(actor: LetterActor): boolean {
  return !!actor.roleCode && LETTER_UNIT_SCOPE_ROLES.includes(actor.roleCode);
}

/**
 * Klasifikasi yang menuntut akses lebih ketat daripada akses biasa sebuah
 * unit. Inilah yang SKKAAD maksud dengan *"semakin tinggi tingkat klasifikasi
 * informasinya, semakin ketat pula dalam pengaturan aksesnya"* (Perka ANRI
 * 7/2016 Pasal 5 huruf c; rumusan yang sama diulang Peraturan ANRI 5/2021
 * Pasal 106). Untuk klasifikasi ini, akses tidak lagi diberikan karena "satu
 * unit", melainkan karena benar-benar ada di dalam rantai naskahnya.
 */
const RESTRICTED_NATURES: LetterNature[] = [
  LetterNature.CONFIDENTIAL,
  LetterNature.STRICTLY_CONFIDENTIAL,
];

/**
 * Jabatan yang selalu boleh membuka naskah rahasia.
 *
 * Naskah berklasifikasi tinggi tetap harus sampai ke organ pengawasan dan ke
 * penanggung jawab tertinggi — tanpa jalan itu, "Rahasia" hanya berarti "tidak
 * ada yang dapat memutuskan". Inilah sel yang setara dengan pengaturan akses
 * pada SKKAAD: kewenangan, bukan sekadar keanggotaan unit.
 */
const NATURE_OVERRIDE_ROLES: readonly string[] = [
  RoleCode.SUPER_ADMIN,
  RoleCode.YAYASAN_PEMBINA,
  RoleCode.YAYASAN_PENGAWAS,
  RoleCode.YAYASAN_KETUA,
  RoleCode.YAYASAN_SEKRETARIS,
];

/** True when a letter of this nature must be restricted beyond ordinary scope. */
export function isRestrictedNature(nature: LetterNature): boolean {
  return RESTRICTED_NATURES.includes(nature);
}

/** True when the actor's office lets it open a restricted letter regardless. */
export function hasNatureOverride(actor: LetterActor): boolean {
  return !!actor.roleCode && NATURE_OVERRIDE_ROLES.includes(actor.roleCode);
}

/**
 * Enough of a letter to decide whether `actor` is genuinely part of it.
 *
 * `isPrimaryRecipient` excludes tembusan (CC): a copy recipient is informed,
 * not responsible, and a naskah that is Rahasia is exactly the one whose
 * circulation should stop at the people who must act on it.
 */
type NatureChain = {
  nature?: LetterNature | null;
  createdById?: string;
  reviewers?: { reviewerId: string }[];
  recipients?: { userId: string | null }[];
  dispositions?: { senderId: string; recipientId: string }[];
};

/**
 * True when `actor` is inside the letter's own chain.
 *
 * `includeCc` decides whether a tembusan recipient counts. Ordinary access
 * counts it (a CC row grants read access to the delivered copy); a restricted
 * one does not.
 */
function isInLetterChain(
  actor: LetterActor,
  letter: NatureChain,
  { includeCc }: { includeCc: boolean } = { includeCc: true }
): boolean {
  if (letter.createdById && letter.createdById === actor.id) return true;
  if (letter.reviewers?.some((r) => r.reviewerId === actor.id)) return true;
  if (
    letter.recipients?.some((r) => r.userId === actor.id && (includeCc || !('isCC' in r && r.isCC)))
  ) {
    return true;
  }
  if (letter.dispositions?.some((d) => d.senderId === actor.id || d.recipientId === actor.id)) {
    return true;
  }
  return false;
}

/**
 * True when the caller may pick which unit to look at (and so may pass
 * `?unitId=`). Everyone else is confined to what the scope clause allows.
 *
 * Foundation roles have no `unitId` of their own, which is why the previous
 * controller answered them with 403 "User has no unit assigned": the sekretaris
 * and ketua yayasan could not open the letter list that their own routing
 * workflow depends on.
 *
 * Deliberately `isFoundationScopedRole`, not `seesAllUnits`. The two differ by
 * the cross-unit service roles (pustakawan, perawat, keamanan, musyrif, ustadz,
 * laboran, and the Pesantren office): `seesAllUnits` is *broad enough for
 * shared services* — a librarian sees every santri — but a letter book is not a
 * shared service. Widening it there gave those accounts the whole yayasan's
 * correspondence, unclassified letters included, and let them pass `?unitId=` to
 * read another school's agenda. It is the same distinction `admissions.access.ts`
 * draws for SPMB: the foundation board reads across units; service staff do not.
 */
export function choosesUnit(actor: LetterActor): boolean {
  return isFoundationScopedRole(actor.roleCode);
}

/**
 * The `where` fragment that limits a letter listing to what `actor` may see.
 *
 * This is the list-shaped half of assertLetterAccess, and it has to agree with
 * it: filtering the list by `unitId` alone would have shown every parent and
 * every santri their school's entire letter book, because those accounts all
 * carry a `unit_id`. Anyone who is not foundation-level and does not handle
 * correspondence sees only letters they are actually part of.
 */
export function letterScopeWhere(actor: LetterActor): Prisma.LetterWhereInput {
  if (isFoundationScopedRole(actor.roleCode)) return {};

  const notRestricted: Prisma.LetterWhereInput = { nature: { notIn: RESTRICTED_NATURES } };

  if (handlesUnitCorrespondence(actor) && actor.unitId) {
    // The office sees its whole unit's letter book — but a classified item in
    // it only if it is genuinely inside that letter's chain. A letter assigned
    // to this actor from *another* unit (a disposition or a review) must also
    // appear: `assertLetterAccess` already opens its direct URL, so leaving it
    // out of the list made the two disagree — the row was reachable by URL but
    // absent from the book, and the CSV matched the list. Composed as
    // "(own-unit AND not-restricted) OR in-chain": a classified letter outside
    // the chain stays hidden.
    return {
      OR: [
        {
          AND: [
            { unitId: actor.unitId },
            { OR: [notRestricted, chainWhere(actor, { includeCc: false })] },
          ],
        },
        chainWhere(actor, { includeCc: false }),
      ],
    };
  }

  // Everyone else sees only letters they are part of. A tembusan (CC) counts
  // for an ordinary letter — the copy is delivered and readable — but not for
  // a restricted one, whose circulation stops at those who must act.
  return {
    OR: [
      chainWhere(actor, { includeCc: false }),
      {
        AND: [{ recipients: { some: { userId: actor.id, isCC: true } } }, notRestricted],
      },
    ],
  };
}

/**
 * The `where` fragment for "letters this actor is inside the chain of".
 *
 * `includeCc` decides whether a tembusan recipient counts. Shared by both
 * branches of `letterScopeWhere` so a restricted letter is reachable in exactly
 * the same way however its reader is scoped.
 */
function chainWhere(
  actor: LetterActor,
  { includeCc }: { includeCc: boolean }
): Prisma.LetterWhereInput {
  const or: Prisma.LetterWhereInput[] = [
    { createdById: actor.id },
    { reviewers: { some: { reviewerId: actor.id } } },
    // Penerima utama saja saat `includeCc` false: sebuah naskah Rahasia yang
    // diteruskan lewat tembusan tetap tidak boleh terbuka bagi penerimanya.
    { recipients: { some: { userId: actor.id, isCC: false } } },
    {
      dispositions: {
        some: { OR: [{ senderId: actor.id }, { recipientId: actor.id }] },
      },
    },
  ];
  if (includeCc) or.push({ recipients: { some: { userId: actor.id, isCC: true } } });
  return { OR: or };
}

type ChainCheck = {
  id: string;
  unitId: string;
  createdById: string;
  nature: LetterNature;
  // Carried because every caller that checks access then needs to decide what
  // may happen next, and the workflow rules turn on exactly these two. Cheaper
  // to select two more columns here than to read the row twice.
  status: LetterStatus;
  direction: LetterDirection;
  reviewers: { reviewerId: string }[];
  recipients: { userId: string | null; isCC: boolean }[];
  dispositions: { senderId: string; recipientId: string }[];
};

/**
 * Throws unless `actor` may see `letterId`. Returns the letter's identifying
 * row so callers that already needed it do not fetch twice.
 */
export async function assertLetterAccess(
  actor: LetterActor,
  letterId: string
): Promise<ChainCheck> {
  const letter = await prisma.letter.findUnique({
    where: { id: letterId },
    select: {
      id: true,
      unitId: true,
      createdById: true,
      nature: true,
      status: true,
      direction: true,
      reviewers: { select: { reviewerId: true } },
      recipients: { select: { userId: true, isCC: true } },
      dispositions: { select: { senderId: true, recipientId: true } },
    },
  });

  if (!letter) throw Errors.notFound('Letter not found');

  if (isFoundationScopedRole(actor.roleCode)) return letter;

  const restricted = isRestrictedNature(letter.nature);
  const inChain = isInLetterChain(actor, letter, { includeCc: !restricted });

  if (inChain) return letter;

  // Only a letter that is not classified may be read by the unit office as a
  // whole. A Rahasia naskah does not open because its unit owns the desk that
  // files it — the same rule `letterScopeWhere` applies to the list, enforced
  // here for the direct fetch.
  if (!restricted && handlesUnitCorrespondence(actor) && actor.unitId === letter.unitId) {
    return letter;
  }

  if (restricted && hasNatureOverride(actor)) return letter;

  // Same message for "not yours" and "does not exist" would be friendlier to
  // an attacker probing ids; the letter's existence is not itself sensitive
  // here, but its contents are, so the distinction stays cheap and honest.
  throw Errors.forbidden('Anda tidak memiliki akses ke surat ini');
}
