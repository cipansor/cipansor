import { describe, it, expect } from 'vitest';
import { MealType } from '@prisma/client';
import { MEAL_TYPE_VALUES } from '@cipansor/shared';

/**
 * The menu contract lives in @cipansor/shared and is read by both the API and
 * the web (#1081). Its `MEAL_TYPE_VALUES` mirrors the Prisma `MealType` enum;
 * if the two drift, a form that offers a meal type the model rejects answers
 * 500 exactly as the Edit form did. Prisma is the source of truth for DB enums
 * (AGENTS.md rule 2), so this pins the shared list to it in both directions:
 * neither a value Prisma lacks nor one the model gained may go unnoticed.
 */
describe('MEAL_TYPE_VALUES mirrors the Prisma MealType enum', () => {
  it('names exactly the values Prisma declares, in the same order', () => {
    expect([...MEAL_TYPE_VALUES]).toEqual(Object.values(MealType));
  });
});
