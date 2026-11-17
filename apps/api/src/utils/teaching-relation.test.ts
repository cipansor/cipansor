import { describe, it, expect } from 'vitest';
import {
  mayWriteGradeVia,
  mayWriteReportCardVia,
  teachingRelationsFromState,
  type TeachingState,
} from './teaching-relation';

const empty: TeachingState = {
  subject: new Set(),
  halaqoh: new Set(),
  musyrif: new Set(),
  homeroom: new Set(),
};

describe('teaching-relation (pure core)', () => {
  it('maps each state set to its relation', () => {
    const relations = teachingRelationsFromState({
      ...empty,
      subject: new Set(['a']),
      halaqoh: new Set(['b']),
      musyrif: new Set(['c']),
      homeroom: new Set(['d']),
    });
    expect(relations.get('a')).toEqual(new Set(['SUBJECT']));
    expect(relations.get('b')).toEqual(new Set(['HALAQOH']));
    expect(relations.get('c')).toEqual(new Set(['MUSYRIF']));
    expect(relations.get('d')).toEqual(new Set(['HOMEROOM']));
  });

  it('merges the relations a santri has more than one of', () => {
    const relations = teachingRelationsFromState({
      ...empty,
      subject: new Set(['a']),
      homeroom: new Set(['a']),
    });
    expect(relations.get('a')).toEqual(new Set(['SUBJECT', 'HOMEROOM']));
  });

  it('leaves a santri with no relation out of the map', () => {
    expect(teachingRelationsFromState(empty).size).toBe(0);
  });

  it('a homeroom relation alone writes a report card but never a grade', () => {
    const homeroom = new Set(['HOMEROOM'] as const);
    expect(mayWriteReportCardVia(homeroom)).toBe(true);
    expect(mayWriteGradeVia(homeroom)).toBe(false);
  });

  it('subject, halaqoh or musyrif writes a grade', () => {
    expect(mayWriteGradeVia(new Set(['SUBJECT']))).toBe(true);
    expect(mayWriteGradeVia(new Set(['HALAQOH']))).toBe(true);
    expect(mayWriteGradeVia(new Set(['MUSYRIF']))).toBe(true);
    expect(mayWriteGradeVia(new Set())).toBe(false);
  });
});
