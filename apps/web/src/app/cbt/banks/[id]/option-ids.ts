const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** The first unused option id: A…Z, then OPT27, OPT28, … */
export function nextOptionId(ids: readonly string[]): string {
  const used = new Set(ids);
  for (const letter of LETTERS) {
    if (!used.has(letter)) return letter;
  }
  let n = ids.length + 1;
  while (used.has(`OPT${n}`)) n += 1;
  return `OPT${n}`;
}

/**
 * Keep the first occurrence of each id and re-letter later duplicates, so the
 * answer key that names the first one still points at the same option.
 */
export function uniqueOptionIds<T extends { id: string }>(
  options: readonly T[],
): T[] {
  const used = new Set<string>();
  return options.map((option) => {
    if (!used.has(option.id)) {
      used.add(option.id);
      return option;
    }
    const id = nextOptionId([...used]);
    used.add(id);
    return { ...option, id };
  });
}
