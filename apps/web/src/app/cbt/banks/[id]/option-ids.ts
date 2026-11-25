const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function trimmedId(id: unknown): string {
  return typeof id === "string" ? id.trim() : "";
}

/** The id to show for an option: its trimmed stored id, or its letter by position. */
export function optionIdOf(id: unknown, index: number): string {
  return trimmedId(id) || String.fromCharCode(65 + index);
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
 * Trim every stored id, keep the first occurrence of each, and give later
 * duplicates and empty ids an id no stored option or answer key owns.
 *
 * Reserving every non-empty stored id first is what keeps the key in place: a
 * blank option that appears before the keyed one must not take the key's id.
 */
export function uniqueOptionIds<T extends { id: string }>(
  options: readonly T[],
  answerKey?: unknown,
): T[] {
  const stored = options.map((option) => trimmedId(option.id));
  const key = answerKeyIdOf(answerKey);
  const reserved = [
    ...stored.filter((id): id is string => id !== ""),
    ...(key ? [key] : []),
  ];
  const used = new Set<string>();
  return options.map((option, index) => {
    const id = stored[index];
    if (id && !used.has(id)) {
      used.add(id);
      return { ...option, id };
    }
    const replacement = nextOptionId([...used], reserved);
    used.add(replacement);
    return { ...option, id: replacement };
  });
}
