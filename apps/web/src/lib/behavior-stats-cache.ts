import type { QueryClient } from "@tanstack/react-query";

/**
 * A santri's behaviour tab caches its two summaries under
 * `["students", id, "behavior-stats"]`. Recording, changing or deleting a
 * violation or a reward refreshes every such entry, so the tab does not show
 * the old totals for the next minute.
 */
export function invalidateBehaviorStats(queryClient: QueryClient) {
  queryClient.invalidateQueries({
    queryKey: ["students"],
    predicate: (query) => query.queryKey[2] === "behavior-stats",
  });
}
