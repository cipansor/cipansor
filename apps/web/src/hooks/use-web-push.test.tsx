import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const subscribePush = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const unsubscribePush = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const pushStatus = vi.hoisted(() => vi.fn().mockResolvedValue(true));
// The server's VAPID public key now comes from the API, not a build variable.
const pushConfig = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ publicKey: "B".repeat(87) }),
);
vi.mock("@/lib/notifications-api", () => ({
  notificationsApi: {
    subscribePush,
    unsubscribePush,
    pushStatus,
    pushConfig,
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// `useAuthStore`'s rehydration and the hook's reconcile effect both call
// `authApi.me()`. Left real, that request hits whatever is on localhost:3000's
// API — a live dev server answering 401 for the anonymous test session clears
// the user this suite sets, and the status query then never enables. Pin it so
// the test is hermetic regardless of a running API.
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    authApi: {
      ...actual.authApi,
      me: vi.fn().mockResolvedValue({
        data: {
          data: { id: "user-1", name: "Test", email: "t@example.com" },
        },
      }),
    },
  };
});

import { useWebPush } from "./use-web-push";
import { useAuthStore } from "@/stores/auth";
import {
  clearDeliberatePushOff,
  pushOwner,
  setPushOwner,
} from "@/lib/push-cache";

// Server calls now go through React Query, so every render needs a client. The
// settings page and the shell share one client in the app, so the tests do too
// when they need to reproduce that.
function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function wrapperWith(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

function renderWebPush(client = makeClient()) {
  return renderHook(() => useWebPush(), { wrapper: wrapperWith(client) });
}

const subscription = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc",
  toJSON: () => ({
    endpoint: "https://fcm.googleapis.com/fcm/send/abc",
    expirationTime: null,
    keys: { p256dh: "p", auth: "a" },
  }),
  unsubscribe: vi.fn().mockResolvedValue(true),
};

function installPushEnv(opts: {
  permission?: NotificationPermission;
  existing?: typeof subscription | null;
}) {
  const subscribe = vi.fn().mockResolvedValue(subscription);
  const getSubscription = vi.fn().mockResolvedValue(opts.existing ?? null);
  const registration = {
    pushManager: { subscribe, getSubscription },
  };
  Object.defineProperty(window.navigator, "serviceWorker", {
    value: {
      ready: Promise.resolve(registration),
      getRegistration: vi.fn().mockResolvedValue(registration),
    },
    configurable: true,
  });
  Object.defineProperty(window, "PushManager", {
    value: class {},
    configurable: true,
  });
  Object.defineProperty(window, "Notification", {
    value: {
      permission: opts.permission ?? "default",
      requestPermission: vi
        .fn()
        .mockResolvedValue(opts.permission ?? "granted"),
    },
    configurable: true,
  });
  return { subscribe, getSubscription };
}

describe("useWebPush", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // `clearAllMocks` keeps each mock's implementation, so a test that changed
    // one (a rejection, a `false` status) would leak into the next. Restore the
    // defaults explicitly.
    subscribePush.mockResolvedValue(undefined);
    unsubscribePush.mockResolvedValue(undefined);
    pushStatus.mockResolvedValue(true);
    pushConfig.mockResolvedValue({ publicKey: "B".repeat(87) });
    subscription.unsubscribe.mockResolvedValue(true);
    // This browser's subscription was turned on by the signed-in account.
    localStorage.clear();
    setPushOwner("user-1");
    // The deliberate-off set is module-level, so it outlives a test file; clear
    // it or the "does not re-register" test's marker leaks into the next run.
    clearDeliberatePushOff();
    // A signed-in user is required: push rows are per-account, so the hook only
    // probes the server when it knows who the account is.
    useAuthStore.setState({
      user: { id: "user-1", name: "Test", email: "t@example.com" } as never,
      isAuthenticated: true,
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("reports the live per-device state on mount", async () => {
    installPushEnv({ existing: subscription });
    const { result } = renderWebPush();
    await waitFor(() => expect(result.current.state).toBe("subscribed"));
  });

  it("reports unsubscribed when no subscription exists", async () => {
    installPushEnv({ existing: null });
    const { result } = renderWebPush();
    await waitFor(() => expect(result.current.state).toBe("unsubscribed"));
  });

  it("enables: requests permission, subscribes, and posts to the API", async () => {
    const { subscribe } = installPushEnv({ existing: null });
    const { result } = renderWebPush();
    await waitFor(() => expect(result.current.state).toBe("unsubscribed"));

    await act(async () => {
      await result.current.enable();
    });

    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(subscribePush).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: "https://fcm.googleapis.com/fcm/send/abc",
      }),
    );
    expect(result.current.state).toBe("subscribed");
  });

  it("does not subscribe when permission is denied", async () => {
    const { subscribe } = installPushEnv({ existing: null });
    const { result } = renderWebPush();
    await waitFor(() => expect(result.current.state).toBe("unsubscribed"));

    Object.defineProperty(window.Notification, "requestPermission", {
      // A real browser also flips `Notification.permission` to "denied" and
      // never asks again; the hook reads that, so the mock must too.
      value: vi.fn().mockImplementation(() => {
        Object.defineProperty(window.Notification, "permission", {
          value: "denied",
          configurable: true,
        });
        return Promise.resolve("denied");
      }),
      configurable: true,
    });
    await act(async () => {
      await result.current.enable();
    });

    expect(subscribe).not.toHaveBeenCalled();
    expect(subscribePush).not.toHaveBeenCalled();
    expect(result.current.state).toBe("denied");
  });

  it("disables: deletes the endpoint server-side, then unsubscribes locally", async () => {
    installPushEnv({ existing: subscription });
    const { result } = renderWebPush();
    await waitFor(() => expect(result.current.state).toBe("subscribed"));

    await act(async () => {
      await result.current.disable();
    });

    expect(unsubscribePush).toHaveBeenCalledWith(
      "https://fcm.googleapis.com/fcm/send/abc",
    );
    expect(subscription.unsubscribe).toHaveBeenCalled();
    // The server row must be gone before the browser drops the endpoint, or a
    // failed API call could never be retried (the endpoint is lost).
    const apiCallOrder = unsubscribePush.mock.invocationCallOrder[0];
    const browserCallOrder =
      subscription.unsubscribe.mock.invocationCallOrder[0];
    expect(apiCallOrder).toBeLessThan(browserCallOrder);
    expect(result.current.state).toBe("unsubscribed");
  });

  it("keeps the browser subscription usable when the server delete fails", async () => {
    installPushEnv({ existing: subscription });
    unsubscribePush.mockRejectedValueOnce(new Error("network"));
    const { result } = renderWebPush();
    await waitFor(() => expect(result.current.state).toBe("subscribed"));

    await act(async () => {
      await result.current.disable();
    });

    // The endpoint is still in the browser, so the next attempt can retry.
    expect(subscription.unsubscribe).not.toHaveBeenCalled();
    expect(result.current.state).toBe("subscribed");
  });

  it("repairs a missing server row on mount instead of lying 'subscribed'", async () => {
    // Browser holds a subscription, but the API has no row for it (a failed
    // registration, or a logout-time purge). The device is not actually
    // reachable, so the hook must re-register rather than show "Aktif".
    installPushEnv({ existing: subscription });
    pushStatus.mockResolvedValueOnce(false);
    const { result } = renderWebPush();

    await waitFor(() => expect(result.current.state).toBe("subscribed"));
    expect(pushStatus).toHaveBeenCalledWith(
      "https://fcm.googleapis.com/fcm/send/abc",
    );
    expect(subscribePush).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: "https://fcm.googleapis.com/fcm/send/abc",
      }),
    );
  });

  it("guides an iPhone user to install instead of calling the browser unsupported", () => {
    // iOS Safari exposes no PushManager until the PWA is on the Home Screen.
    // Reporting "unsupported" hides the one step that makes push work.
    delete (window as unknown as { PushManager?: unknown }).PushManager;
    Object.defineProperty(window.navigator, "userAgent", {
      value:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      configurable: true,
    });
    window.matchMedia = vi.fn().mockReturnValue({ matches: false });

    const { result } = renderWebPush();
    expect(result.current.state).toBe("needs-install");
  });

  it("reports unsupported for a non-iOS browser with no push API", () => {
    delete (window as unknown as { PushManager?: unknown }).PushManager;
    Object.defineProperty(window.navigator, "userAgent", {
      value:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      configurable: true,
    });

    const { result } = renderWebPush();
    expect(result.current.state).toBe("unsupported");
  });

  it("does not re-register an endpoint after the user deliberately disabled it", async () => {
    // The settings page and the shell mount two instances against one client.
    // Disabling from the settings instance must not be undone by the shell's
    // reconciliation, which still holds the former PushSubscription.
    installPushEnv({ existing: subscription });
    const client = makeClient();
    const settings = renderHook(() => useWebPush(), {
      wrapper: wrapperWith(client),
    });
    const shell = renderHook(() => useWebPush(), {
      wrapper: wrapperWith(client),
    });

    await waitFor(() =>
      expect(settings.result.current.state).toBe("subscribed"),
    );
    await waitFor(() => expect(shell.result.current.state).toBe("subscribed"));

    await act(async () => {
      await settings.result.current.disable();
    });
    expect(settings.result.current.state).toBe("unsubscribed");

    // Give the shell's reconciliation effect a chance to (wrongly) fire.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(subscribePush).not.toHaveBeenCalled();
    expect(shell.result.current.state).toBe("unsubscribed");
  });

  it("drops its live subscription when another tab turns push off", async () => {
    // A live tab, not a pre-seeded marker: the shell is already mounted and
    // showing "Aktif" when the user clicks "Matikan" in the other tab. The off
    // broadcast must drop the subscription this tab holds, or the retained
    // `PushSubscription` keeps `state` at "subscribed" and the repair effect
    // re-creates the row.
    installPushEnv({ existing: subscription });
    pushStatus.mockResolvedValue(true);
    const { result } = renderWebPush();
    await waitFor(() => expect(result.current.state).toBe("subscribed"));

    await act(async () => {
      const otherTab = new BroadcastChannel("cipansor-push");
      otherTab.postMessage({
        type: "push-off",
        endpoint: "https://fcm.googleapis.com/fcm/send/abc",
      });
      await new Promise((r) => setTimeout(r, 30));
      otherTab.close();
    });

    expect(result.current.state).toBe("unsubscribed");
    expect(subscribePush).not.toHaveBeenCalled();
  });

  it("recovers when another tab turns push back on", async () => {
    // Off then on in tab A. Tab B cleared its subscription on the off, and the
    // on broadcast must make it re-read the shared `pushManager` — otherwise it
    // keeps showing "Belum aktif di perangkat ini" while push is back on.
    const { getSubscription } = installPushEnv({ existing: subscription });
    pushStatus.mockResolvedValue(true);
    const { result } = renderWebPush();
    await waitFor(() => expect(result.current.state).toBe("subscribed"));

    await act(async () => {
      const otherTab = new BroadcastChannel("cipansor-push");
      otherTab.postMessage({
        type: "push-off",
        endpoint: "https://fcm.googleapis.com/fcm/send/abc",
      });
      await new Promise((r) => setTimeout(r, 30));
      otherTab.close();
    });
    expect(result.current.state).toBe("unsubscribed");

    // Tab A re-subscribed; the browser subscription is shared, so this tab can
    // read it back.
    getSubscription.mockResolvedValue(subscription);
    await act(async () => {
      const otherTab = new BroadcastChannel("cipansor-push");
      otherTab.postMessage({
        type: "push-on",
        endpoint: "https://fcm.googleapis.com/fcm/send/abc",
      });
      await new Promise((r) => setTimeout(r, 30));
      otherTab.close();
    });

    await waitFor(() => expect(result.current.state).toBe("subscribed"));
  });

  it("stops retrying a failed repair instead of looping", async () => {
    // The status says "no row", but the repair API is down. React Query flips
    // isPending back to false on failure; the old effect depended on it and
    // re-fired the same failed request on every render.
    installPushEnv({ existing: subscription });
    pushStatus.mockResolvedValue(false);
    subscribePush.mockRejectedValue(new Error("unavailable"));
    renderWebPush();

    await waitFor(() => expect(subscribePush).toHaveBeenCalledTimes(1));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(subscribePush).toHaveBeenCalledTimes(1);
  });

  it("does not hand one account's subscription to the next person who signs in", async () => {
    // A shared device: user-1 turned push on, then user-2 signs in. user-2 never
    // pressed "Aktifkan"; registering the browser's subscription for them would
    // be push on someone else's consent. The subscription is dropped instead.
    installPushEnv({ existing: subscription });
    useAuthStore.setState({
      user: { id: "user-2", name: "Other", email: "o@example.com" } as never,
      isAuthenticated: true,
    });
    const { result } = renderWebPush();

    await waitFor(() => expect(result.current.state).toBe("unsubscribed"));
    expect(subscription.unsubscribe).toHaveBeenCalled();
    expect(subscribePush).not.toHaveBeenCalled();
    expect(pushOwner()).toBeNull();
  });

  it("drops a subscription nobody is recorded as owning", async () => {
    installPushEnv({ existing: subscription });
    localStorage.clear();
    pushStatus.mockResolvedValue(false);
    const { result } = renderWebPush();

    await waitFor(() => expect(result.current.state).toBe("unsubscribed"));
    expect(subscribePush).not.toHaveBeenCalled();
  });

  it("records the account that turned push on", async () => {
    installPushEnv({ existing: null });
    localStorage.clear();
    const { result } = renderWebPush();
    await waitFor(() => expect(result.current.state).toBe("unsubscribed"));

    await act(async () => {
      await result.current.enable();
    });
    expect(pushOwner()).toBe("user-1");
    expect(result.current.state).toBe("subscribed");
  });

  it("replaces an endpoint the server still holds for another account", async () => {
    // user-1 never signed out here, so the server row is theirs (409). The
    // browser gets a subscription of its own; the old endpoint dies with it.
    const { subscribe } = installPushEnv({ existing: subscription });
    localStorage.clear();
    const conflict = Object.assign(new Error("conflict"), {
      isAxiosError: true,
      response: { status: 409 },
    });
    subscribePush.mockRejectedValueOnce(conflict);
    useAuthStore.setState({
      user: { id: "user-2", name: "Other", email: "o@example.com" } as never,
      isAuthenticated: true,
    });
    const { result } = renderWebPush();
    await waitFor(() => expect(result.current.state).toBe("unsubscribed"));
    subscription.unsubscribe.mockClear();

    await act(async () => {
      await result.current.enable();
    });

    expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalled();
    expect(subscribePush).toHaveBeenCalledTimes(2);
    expect(pushOwner()).toBe("user-2");
  });

  it("reports push unavailable when the server has no key", async () => {
    installPushEnv({ existing: null });
    pushConfig.mockResolvedValue({ publicKey: null });
    const { result } = renderWebPush();
    await waitFor(() => expect(result.current.state).toBe("unconfigured"));
  });
});
