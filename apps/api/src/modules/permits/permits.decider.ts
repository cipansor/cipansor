import { PermitDecider, UnitType } from '@prisma/client';
import {
  PARENT_ROLE_CODES,
  PERMIT_HEAD_AFTER_DAYS,
  PESANTREN_LEADER_ROLE_CODES,
  PRINCIPAL_ROLE_CODES,
  type PermitDecision,
  type PermitMentorKind,
  type PermitRoute,
} from '@cipansor/shared';
import type { ScopeActor } from '@/utils/student-scope';
import { wibDayOf } from '@/utils/wib';

/**
 * Who decides a permit — pure rules over what the service loads (no Prisma
 * here). The reasons are in @cipansor/shared `schemas/permits.ts`.
 */

/** What the rules need to know about the learner. */
export interface Guardianship {
  unitId: string;
  unitType: UnitType;
  /** Has an active kamar: a santri mukim, whose mentor is the musyrif. */
  boarder: boolean;
  /** The musyrif of their kamar or asrama (a boarder), else their wali kelas. */
  mentors: Person[];
  /** A boarder's koordinator asrama; empty for a day pupil. */
  coordinators: Person[];
}

export interface Person {
  id: string;
  name: string;
}

export interface DecidablePermit {
  status: string;
  type: string;
  offCampus: boolean;
  startDate: Date;
  endDate: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The calendar days in WIB a period touches: Friday 13:00 → Sunday 17:00 is 3. */
export function calendarDays(start: Date, end: Date): number {
  const first = Math.floor(wibDayStartMs(start) / DAY_MS);
  const last = Math.floor(wibDayStartMs(end) / DAY_MS);
  return last - first + 1;
}

/** The WIB midnight a moment falls after, as a UTC epoch — for day counting. */
const wibDayStartMs = (moment: Date): number => Date.parse(`${wibDayOf(moment)}T00:00:00.000Z`);

/**
 * A boarder going home, or off the pondok overnight — izin pulang or
 * bermalam, which a pondok's kepala asrama decides (2026-09-27). A few hours
 * out, or sick in the UKS, is not.
 */
export function goesHome(
  permit: Pick<DecidablePermit, 'type' | 'offCampus' | 'startDate' | 'endDate'>,
  g: Guardianship
): boolean {
  if (!g.boarder || !permit.offCampus) return false;
  return permit.type === 'PULANG' || calendarDays(permit.startDate, permit.endDate) > 1;
}

/** Who decides this permit below the unit head, and as what. */
export function mentorsFor(
  permit: Pick<DecidablePermit, 'type' | 'offCampus' | 'startDate' | 'endDate'>,
  g: Guardianship
): { kind: PermitMentorKind; people: Person[] } {
  if (goesHome(permit, g)) return { kind: 'KOORDINATOR', people: g.coordinators };
  return g.boarder
    ? { kind: 'MUSYRIF', people: g.mentors }
    : { kind: 'WALI_KELAS', people: g.mentors };
}

export function routeOf(permit: DecidablePermit, g: Guardianship): PermitRoute {
  if (calendarDays(permit.startDate, permit.endDate) > PERMIT_HEAD_AFTER_DAYS) return 'LONG';
  return mentorsFor(permit, g).people.length ? 'MENTOR' : 'NO_MENTOR';
}

const CAPACITY: Record<PermitMentorKind, PermitDecider> = {
  MUSYRIF: PermitDecider.MUSYRIF,
  KOORDINATOR: PermitDecider.KOORDINATOR_ASRAMA,
  WALI_KELAS: PermitDecider.WALI_KELAS,
};

/**
 * The head's capacity over this learner, or null: the kepala sekolah of the
 * learner's own unit; the Pimpinan Pesantren over boarders and Takhosus
 * santri — the asrama and the pesantren programme are theirs, the schools'
 * day pupils are not.
 */
export function headCapacity(actor: ScopeActor, g: Guardianship): PermitDecider | null {
  const code = actor.roleCode ?? '';
  if (PRINCIPAL_ROLE_CODES.includes(code) && actor.unitId === g.unitId) {
    return PermitDecider.KEPALA_SEKOLAH;
  }
  if (
    PESANTREN_LEADER_ROLE_CODES.includes(code) &&
    (g.boarder || g.unitType === UnitType.PESANTREN)
  ) {
    return PermitDecider.PIMPINAN_PESANTREN;
  }
  return null;
}

export interface DecisionFor extends PermitDecision {
  /** The capacity the caller would decide in, when `canDecide`. */
  capacity: PermitDecider | null;
}

/**
 * What the caller may do with this permit. The mentor decides what is routed
 * to the mentor; a head decides what is routed to the head, and may take over
 * what is routed to the mentor — the covering case for a mentor who is away.
 * A mentor never decides long leave: that is exactly what goes up.
 */
export function decisionFor(
  permit: DecidablePermit,
  g: Guardianship,
  actor: ScopeActor
): DecisionFor {
  const route = routeOf(permit, g);
  const { kind: mentorKind, people: mentors } = mentorsFor(permit, g);
  const base = { route, mentorKind, mentors } as const;
  const none = { ...base, canDecide: false, asTakeover: false, capacity: null };
  if (permit.status !== 'PENDING') return none;

  if (route === 'MENTOR' && mentors.some((m) => m.id === actor.sub)) {
    return { ...base, canDecide: true, asTakeover: false, capacity: CAPACITY[mentorKind] };
  }
  const head = headCapacity(actor, g);
  if (head) {
    return { ...base, canDecide: true, asTakeover: route === 'MENTOR', capacity: head };
  }
  return none;
}

const MENTOR_LABEL: Record<PermitMentorKind, string> = {
  MUSYRIF: 'musyrif',
  KOORDINATOR: 'koordinator asrama',
  WALI_KELAS: 'wali kelas',
};

/** Why this caller may not decide it, in words for the refusal. */
export function whoDecides(d: PermitDecision): string {
  if (d.route === 'LONG') {
    return `Izin lebih dari ${PERMIT_HEAD_AFTER_DAYS} hari diputuskan oleh kepala unit`;
  }
  if (d.route === 'NO_MENTOR' && d.mentorKind === 'KOORDINATOR') {
    return 'Asrama santri ini belum punya koordinator tercatat; izin pulang atau menginap diputuskan oleh Pimpinan Pesantren atau kepala unit';
  }
  if (d.route === 'NO_MENTOR') {
    return `Santri ini belum punya ${MENTOR_LABEL[d.mentorKind]} tercatat; izinnya diputuskan oleh kepala unit`;
  }
  const names = d.mentors.map((m) => m.name).join(', ');
  return `Izin ini diputuskan oleh ${MENTOR_LABEL[d.mentorKind]} santri (${names})`;
}

/**
 * Who opens a permit's doctor's note (decided 2026-09-28,
 * decisions/pemutus-izin-santri.md): whoever decides it — its mentor today
 * (the koordinator asrama for a boarder going home), or the one who did
 * decide it — the unit head, and the santri's wali. The caller has already
 * passed the permit's scope, so a wali here is this learner's wali. Anyone
 * else who sees the permit sees only that a note is attached.
 */
export function mayOpenNote(
  permit: Pick<DecidablePermit, 'type' | 'offCampus' | 'startDate' | 'endDate'> & {
    approvedBy: { id: string } | null;
  },
  g: Guardianship,
  actor: ScopeActor
): boolean {
  if (mentorsFor(permit, g).people.some((m) => m.id === actor.sub)) return true;
  if (permit.approvedBy?.id === actor.sub) return true;
  if (headCapacity(actor, g)) return true;
  return PARENT_ROLE_CODES.includes(actor.roleCode ?? '');
}
