import type { Page } from "@playwright/test";

interface ReactQueryClient {
  refetchQueries: (filters: {
    queryKey: unknown[];
    exact: boolean;
  }) => Promise<void>;
}

/**
 * Refetch one query in the running page.
 *
 * The app keeps its QueryClient private, and the production bundle used by E2E
 * has no devtools, so there is no public handle. Walk React's fiber tree from
 * the root to the `QueryClientProvider` prop that holds the client.
 */
export async function refetchQuery(
  page: Page,
  queryKey: unknown[],
): Promise<void> {
  const refetched = await page.evaluate(async (key) => {
    interface Fiber {
      memoizedProps?: { client?: ReactQueryClient };
      child?: Fiber;
      sibling?: Fiber;
    }

    const seen = new Set<Fiber>();
    const findClient = (fiber?: Fiber): ReactQueryClient | null => {
      if (!fiber || seen.has(fiber)) return null;
      seen.add(fiber);
      const client = fiber.memoizedProps?.client;
      if (typeof client?.refetchQueries === "function") return client;
      return findClient(fiber.child) ?? findClient(fiber.sibling);
    };

    for (const node of [document.body, document.documentElement]) {
      const fiberKey = Object.keys(node).find((name) =>
        name.startsWith("__reactFiber$"),
      );
      if (!fiberKey) continue;
      const client = findClient(
        (node as unknown as Record<string, Fiber>)[fiberKey],
      );
      if (!client) continue;
      await client.refetchQueries({ queryKey: key, exact: true });
      return true;
    }
    return false;
  }, queryKey);

  if (!refetched) throw new Error("QueryClient not found in the page");
  // Give React a frame to render the refetched detail into the mounted form.
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(null))),
      ),
  );
}
