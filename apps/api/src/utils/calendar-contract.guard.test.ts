import { describe, it, expect } from 'vitest';
import { EventType } from '@prisma/client';
import { EVENT_TYPES, EventType as SharedEventType } from '@cipansor/shared';

/**
 * The calendar's category list lives in @cipansor/shared and is read by both
 * apps (#1155).
 *
 * It exists because the web kept its own list: seven values that offered an
 * `EXAM` the model had no room for and lacked the `CEREMONY` the model does
 * store. A "Ujian" agenda was answered 400 by the API and an "Upacara" one
 * rendered with an empty badge. Prisma is the source of truth for DB enums
 * (AGENTS.md rule 2), so this pins the shared list to it in both directions:
 * neither a value Prisma lacks nor one the model gained may go unnoticed.
 */
describe('EVENT_TYPES mirrors the Prisma EventType enum', () => {
  it('names exactly the values Prisma declares, in the same order', () => {
    expect([...EVENT_TYPES]).toEqual(Object.values(EventType));
  });

  it('agrees with the shared EventType enum it types', () => {
    expect(Object.keys(SharedEventType)).toEqual([...EVENT_TYPES]);
  });
});
