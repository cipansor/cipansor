import { describe, it, expect } from 'vitest';
import { SimaanType } from '@prisma/client';
import { SIMAAN_TYPE_VALUES } from '@cipansor/shared';

/**
 * The simaan contract lives in @cipansor/shared and is read by both the API and
 * the web (#1024). Its `SIMAAN_TYPE_VALUES` mirrors the Prisma `SimaanType`
 * enum; when the two drifted — the API's `JUZ_AMMA`/`ONE_JUZ`/… against the
 * web's `BIN_NAZHR`/… — every simaan form was answered 400 the moment it was
 * saved. Prisma is the source of truth for DB enums (AGENTS.md rule 2), so this
 * pins the shared list to it in both directions: neither a value Prisma lacks
 * nor one the model gained may go unnoticed.
 */
describe('SIMAAN_TYPE_VALUES mirrors the Prisma SimaanType enum', () => {
  it('names exactly the values Prisma declares, in the same order', () => {
    expect([...SIMAAN_TYPE_VALUES]).toEqual(Object.values(SimaanType));
  });
});
