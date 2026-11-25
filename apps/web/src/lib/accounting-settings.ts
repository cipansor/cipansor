export type AccountMappings = Record<string, string | null>;

/**
 * Only the mappings the operator actually changed. The settings form loads a
 * stored PPh 21 id even when its account is currently unusable; sending every
 * loaded value back would turn that untouched row into a `null` delete.
 */
export function changedAccountMappings(
  initial: AccountMappings,
  current: AccountMappings,
  touched: ReadonlySet<string>,
): AccountMappings {
  const changes: AccountMappings = {};

  for (const key of touched) {
    if ((initial[key] ?? null) !== (current[key] ?? null)) {
      changes[key] = current[key] ?? null;
    }
  }

  return changes;
}
