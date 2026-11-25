const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** The id to show for an option: its trimmed stored id, or its letter by position. */
export function optionIdOf(id: unknown, index: number): string {
  const trimmed = typeof id === "string" ? id.trim() : "";
  return trimmed || String.fromCharCode(65 + index);
}

/** The answer key's id, trimmed; accepts a bare id or the `{ id }` shape. */
export function answerKeyIdOf(answerKey: unknown): string | null {
  const value =
    typeof answerKey === "string"
      ? answerKey
      : answerKey && typeof answerKey === "object" && "id" in answerKey
        ? (answerKey as { id?: unknown }).id
        : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

/** The first unused option id: A…Z, then OPT27, OPT28, … */
export function nextOptionId(
  ids: readonly string[],
  reserved: readonly string[] = [],
): string {
  const used = new Set([...ids, ...reserved]);
  for (const letter of LETTERS) {
    if (!used.has(letter)) return letter;
  }
  let n = used.size + 1;
  while (used.has(`OPT${n}`)) n += 1;
  return `OPT${n}`;
}

/**
 * Keep the first occurrence of each id and re-letter later duplicates, so the
 * answer key that names the first one still points at the same option.
 *
 * A replacement must not take an id that another option already owns: for
 * `A/A/B`, re-lettering the second A to B would move a key that names the
 * third option. Reserve every original id and fill from what is left.
 */
export function uniqueOptionIds<T extends { id: string }>(
  options: readonly T[],
): T[] {
  const reserved = options.map((option) => option.id);
  const used = new Set<string>();
  return options.map((option) => {
    if (!used.has(option.id)) {
      used.add(option.id);
      return option;
    }
    const id = nextOptionId([...used], reserved);
    used.add(id);
    return { ...option, id };
  });
}
