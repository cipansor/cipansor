"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { WebPushSubscriptionPayload } from "@cipansor/shared";
import { notificationsApi } from "@/lib/notifications-api";
import { useAuthStore } from "@/stores/auth";
import { isAxiosError } from "axios";
import {
  clearPushOwner,
  isPushDeliberatelyOff,
  listenForPushChanges,
  markPushDeliberatelyOff,
  onPushDeliberateChange,
  pushOwner,
  pushStatusQueryKey,
  setPushOwner,
  unmarkPushDeliberatelyOff,
} from "@/lib/push-cache";

/**
 * Browser Web Push, wired end-to-end.
 *
 * Before this, the settings page had a "Push" toggle that saved a preference
 * and nothing else: no `pushManager.subscribe`, no key, no API call — the
 * service worker's `push` handler could never fire because no subscription
 * existed. This is the missing half.
 *
 * The server's VAPID public key comes from `GET /notifications/push/config`
 * at run time — not from a variable baked into the web bundle — so a key
 * installed on an environment reaches the browser without a rebuild. With no
 * key on the server, the state is "unconfigured" and nothing is asked of the
 * browser.
 *
 * A subscription belongs to the account that pressed "Aktifkan" on this
 * browser (`push-owner.ts`). The browser's permission and its
 * `PushSubscription` outlive a sign-out; without an owner, the next person to
 * sign in on a shared device was registered for push silently, on someone
 * else's consent.
 *
 * iOS only delivers Web Push to an *installed* PWA (Add to Home Screen), and
 * only in Safari — the same install path the InstallPrompt guides the user to.
 */
export type WebPushState =
  | "checking"
  | "unsupported"
  | "needs-install"
  | "unconfigured"
  | "denied"
  | "subscribed"
  | "unsubscribed";

/**
 * True on an iPhone/iPad whose Safari has no `PushManager` yet.
 *
 * iOS delivers Web Push only to a PWA the user has *added to the Home Screen*;
 * until then `window.PushManager` is simply absent. Reporting that as
 * "unsupported" tells the user their browser cannot do it, when the real answer
 * is one install away — the same trap `InstallPrompt` exists to avoid. iPadOS
 * reports a desktop UA, so the touch-point check is what catches it.
 */
function hasPushManager(): boolean {
  // Read it off a loose type: `"PushManager" in window` narrows the *false*
  // branch of `window` to `never` (the global is declared non-optional), which
  // then fails to type-check the `matchMedia` access below.
  return (
    typeof (window as unknown as { PushManager?: unknown }).PushManager !==
    "undefined"
  );
}

function isIosNotInstalled(): boolean {
  if (typeof window === "undefined" || hasPushManager()) return false;
  const ua = navigator.userAgent;
  const ios =
    /iPad|iPhone|iPod/.test(ua) ||
    (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
  if (!ios) return false;
  return !(
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

/** The push API returns base64url; subscribe() wants the raw bytes. */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  // Back it with a plain ArrayBuffer: `PushManager.subscribe` wants a
  // BufferSource, and a bare `new Uint8Array(n)` is only `ArrayBufferLike`.
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  if (!("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return null;
  return registration.pushManager.getSubscription();
}

/**
 * The worker that will answer `pushManager`, or null if none is coming.
 *
 * `navigator.serviceWorker.ready` never settles when no worker will ever
 * register — `ServiceWorkerRegister` deliberately skips registration under
 * `pnpm dev` and browser automation — so awaiting it directly left the
 * "Aktifkan" button spinning forever. Poll `getRegistration()` for a bounded
 * time instead: return the moment a worker exists, or null once the budget is
 * spent. The worker registers on `load`, so a short poll also covers the race
 * where the button is clicked before registration has finished.
 */
const READY_TIMEOUT_MS = 10_000;
const READY_POLL_MS = 200;

async function activeRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return existing;

  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration) return registration;
  }
  return null;
}

/**
 * Read and control this browser's push subscription.
 *
 * `state` is derived on mount from the live subscription *and* the server row,
 * so the toggle shows the truth for *this* device even though `pushEnabled` in
 * preferences is per-user.
 *
 * Server calls go through React Query (status query + subscribe/unsubscribe
 * mutations), per the web data-layer rule; the browser's own `pushManager` is
 * not server data and is read/written directly. The mount effect reconciles a
 * browser subscription that the server has no row for — a registration that
 * failed after `subscribe()` succeeded, a logout-time purge, or a rotated
 * endpoint — so the device is reachable again on the next visit. That
 * reconciliation is also what `useWebPushReconcile` runs on every authenticated
 * page, not just this settings screen.
 */
export function useWebPush() {
  const queryClient = useQueryClient();
  // `undefined` = still reading the browser's subscription; `null` = none.
  const [browserSubscription, setBrowserSubscription] = useState<
    PushSubscription | null | undefined
  >(undefined);

  // The signed-in account. Push rows are per-user, so a cached status for one
  // account must never be read for another: the key includes the user id, and
  // logout drops these queries outright (see `forgetPushStatus`). Without this,
  // logging out and straight back in reused a still-fresh `true` for the same
  // endpoint — the server row was gone but the card showed "Aktif" and
  // reconciliation never restored it.
  //
  // Declared before the effects below, which read it.
  const userId = useAuthStore((state) => state.user?.id ?? null);

  // `Notification` does not exist during SSR; resolve support on the client.
  const supported =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;

  // The server's VAPID public key, null when it does not send push. One read
  // per session is enough: a key changes only with a redeploy.
  const configQuery = useQuery({
    queryKey: ["web-push-config"],
    queryFn: () => notificationsApi.pushConfig(),
    enabled: supported && !!userId,
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
  const publicKey = configQuery.data?.publicKey ?? null;

  useEffect(() => {
    // `browserSubscription` starts null, so an unsupported browser needs no
    // reset — writing it here would only be a cascading render.
    if (!supported) return;
    let cancelled = false;
    currentSubscription()
      .then((sub) => {
        if (!cancelled) setBrowserSubscription(sub);
      })
      .catch(() => {
        if (!cancelled) setBrowserSubscription(null);
      });
    return () => {
      cancelled = true;
    };
  }, [supported]);

  // Hear about a deliberate push change made in another tab, so this tab's
  // reconciliation does not re-register an endpoint the user just turned off
  // elsewhere. Idempotent, so the settings page and the shell may both call it.
  useEffect(() => {
    listenForPushChanges();
  }, []);

  // React to a deliberate push change made anywhere — the settings page turning
  // push off in *this* tab, or another tab doing either. The marker is what the
  // repair effect reads; the subscription state is what the card shows.
  //
  // Off: drop the subscription this tab still holds. Without it the retained
  // `PushSubscription` keeps `state` at "subscribed" and leaves the repair
  // effect a live subscription to work from, so the row the user just deleted
  // comes straight back.
  //
  // On: re-read the live subscription and refresh the status. The other tab
  // subscribed through the *shared* `pushManager`, but this tab's copy was
  // cleared by the earlier off, so without re-reading it keeps showing "Belum
  // aktif di perangkat ini" while push is in fact back on. The read is guarded
  // so a later off cannot be undone by a slow one: it only adopts an endpoint
  // that is still not deliberately off, and drops the result if this tab has
  // unmounted.
  useEffect(() => {
    let cancelled = false;
    const stop = onPushDeliberateChange((changedEndpoint, off) => {
      if (off) {
        setBrowserSubscription((current) =>
          current?.endpoint === changedEndpoint ? null : current,
        );
        return;
      }
      currentSubscription()
        .then((sub) => {
          if (cancelled) return;
          // A subsequent off may have arrived while this read was in flight;
          // honour it rather than resurrecting what the user turned off.
          if (!sub || isPushDeliberatelyOff(sub.endpoint)) return;
          setBrowserSubscription(sub);
          // The server row was just written by the other tab; refresh this
          // account's status so the card flips to "Aktif" without a remount.
          queryClient.invalidateQueries({
            queryKey: pushStatusQueryKey(userId, sub.endpoint),
          });
        })
        .catch(() => undefined);
    });
    return () => {
      cancelled = true;
      stop();
    };
  }, [queryClient, userId]);

  const endpoint = browserSubscription?.endpoint ?? null;

  // Does the API hold a row for this browser's endpoint? Distinct from "the
  // browser has a subscription" — the two disagree after a failed registration
  // or a logout-time purge, and claiming "Aktif" then leaves the device
  // silently unable to receive anything.
  const statusQuery = useQuery({
    queryKey: pushStatusQueryKey(userId, endpoint),
    queryFn: () => notificationsApi.pushStatus(endpoint as string),
    enabled: supported && !!publicKey && !!endpoint && !!userId,
    retry: false,
  });

  const registerMutation = useMutation({
    mutationFn: (sub: PushSubscription) =>
      notificationsApi.subscribePush(
        sub.toJSON() as WebPushSubscriptionPayload,
      ),
    retry: false,
    // Reconciliation runs silently on every authenticated page, so a failed
    // repair must not raise the global error toast the QueryProvider attaches
    // to every mutation. The `enable()` path toasts for itself.
    meta: { silentError: true },
    // Write the status straight back: the server now has this endpoint, so the
    // toggle flips to "Aktif" at once instead of after a refetch round-trip.
    onSuccess: (_data, sub) =>
      queryClient.setQueryData(pushStatusQueryKey(userId, sub.endpoint), true),
  });

  const unregisterMutation = useMutation({
    // Delete the server row *first*, while we still hold the endpoint. Doing it
    // the other way round loses the endpoint the moment `unsubscribe()`
    // succeeds, so a failed API call could never be retried and the row would
    // linger, still pushing to this device (CWE-200).
    mutationFn: async (sub: PushSubscription) => {
      await notificationsApi.unsubscribePush(sub.endpoint);
      const unsubscribed = await sub.unsubscribe();
      // `unsubscribe()` resolves false if the browser still holds the
      // subscription; don't report success we did not achieve.
      if (!unsubscribed) throw new Error("Browser refused to unsubscribe");
    },
    retry: false,
    // The explicit "Matikan" click toasts for itself; the shell's automatic
    // reconciliation must stay silent.
    meta: { silentError: true },
    onSuccess: (_data, sub) => {
      setBrowserSubscription(null);
      // One deliberate, this-browser unsubscribe — not a stale server row.
      // Record it so every other `useWebPush` instance (the shell) can tell the
      // difference and refuses to re-register the endpoint we just removed.
      markPushDeliberatelyOff(sub.endpoint);
      queryClient.setQueryData(pushStatusQueryKey(userId, sub.endpoint), false);
    },
  });

  // Reconcile a browser subscription the server has no row for — a registration
  // that failed after `subscribe()` succeeded, or a logout-time purge. Silent by
  // design, and bounded: it runs once per mount for a given endpoint, so a
  // failing repair cannot loop. React Query flips `isPending` back to false when
  // the mutation rejects; the old effect depended on that flag, so the same
  // failed request fired again and again on every authenticated page.
  const { mutate: reconcile } = registerMutation;
  const registered = statusQuery.data;
  const attemptedRef = useRef<{
    endpoint: string;
    userId: string | null;
  } | null>(null);
  useEffect(() => {
    if (!browserSubscription || !userId) return;
    // Someone else turned push on in this browser (or nobody we know of): the
    // subscription is theirs, not this account's. Drop it from the browser —
    // which also cuts off any row the previous person left behind, since the
    // push service answers 410 for it from now on — and let this person decide.
    if (pushOwner() !== userId) {
      const foreign = browserSubscription;
      setBrowserSubscription(null);
      clearPushOwner();
      foreign.unsubscribe().catch(() => undefined);
      return;
    }
    const { endpoint: currentEndpoint } = browserSubscription;
    // A deliberate unsubscribe must win over a stale status: never repair it.
    if (isPushDeliberatelyOff(currentEndpoint)) return;
    if (registered !== false) return;
    const attempted = attemptedRef.current;
    if (
      attempted?.endpoint === currentEndpoint &&
      attempted.userId === userId
    ) {
      return;
    }
    attemptedRef.current = { endpoint: currentEndpoint, userId };
    reconcile(browserSubscription);
  }, [browserSubscription, userId, registered, reconcile]);

  const [busy, setBusy] = useState(false);
  // Read once on the client, then refreshed by `enable()`. `Notification` does
  // not exist during SSR, and the value can change when the user answers the
  // permission prompt — which is a state change React must see to re-render.
  const [permission, setPermission] = useState<NotificationPermission | null>(
    typeof window !== "undefined" && "Notification" in window
      ? Notification.permission
      : null,
  );

  let state: WebPushState;
  if (!supported) {
    // On iOS the missing piece is the install, not the browser. Say so instead
    // of a flat "not supported" that hides the one step that fixes it.
    state = isIosNotInstalled() ? "needs-install" : "unsupported";
  } else if (configQuery.isPending && !!userId) {
    state = "checking";
  } else if (!publicKey) {
    state = "unconfigured";
  } else if (permission === "denied") {
    state = "denied";
  } else if (browserSubscription && registered === true) {
    state = "subscribed";
  } else {
    state = "unsubscribed";
  }

  const enable = useCallback(async () => {
    if (!supported || !publicKey || !userId) {
      toast.error("Notifikasi push belum tersedia di perangkat ini.");
      return;
    }
    setBusy(true);
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== "granted") {
        toast.error(
          "Izin notifikasi ditolak. Aktifkan lewat pengaturan browser.",
        );
        return;
      }
      // Bounded wait: if no worker registers (dev/automation), say so rather
      // than spin forever on `serviceWorker.ready`.
      const registration = await activeRegistration();
      if (!registration) {
        toast.error("Notifikasi push belum siap di perangkat ini.");
        return;
      }
      const fresh = () =>
        registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
      let subscription =
        (await registration.pushManager.getSubscription()) ?? (await fresh());
      // This account said yes. Recorded before the subscription is adopted, so
      // the owner check never mistakes it for someone else's.
      setPushOwner(userId);
      // A fresh, deliberate subscribe clears any earlier "turned off" marker so
      // reconciliation is free to keep the row alive again.
      unmarkPushDeliberatelyOff(subscription.endpoint);
      setBrowserSubscription(subscription);
      try {
        await registerMutation.mutateAsync(subscription);
      } catch (error) {
        // 409: the server still holds this endpoint for another account (they
        // never signed out here). Replace it with a subscription of our own;
        // the old endpoint stops working, and its row goes with it.
        if (!(isAxiosError(error) && error.response?.status === 409)) {
          throw error;
        }
        await subscription.unsubscribe();
        subscription = await fresh();
        unmarkPushDeliberatelyOff(subscription.endpoint);
        setBrowserSubscription(subscription);
        await registerMutation.mutateAsync(subscription);
      }
      toast.success("Notifikasi push aktif di perangkat ini.");
    } catch {
      // Deliberately leaves the browser subscription in place: the reconcile on
      // the next mount retries the registration instead of stranding it.
      toast.error("Gagal mengaktifkan notifikasi push.");
    } finally {
      setBusy(false);
    }
  }, [supported, publicKey, userId, registerMutation]);

  const disable = useCallback(async () => {
    setBusy(true);
    try {
      const subscription = browserSubscription ?? (await currentSubscription());
      if (subscription) await unregisterMutation.mutateAsync(subscription);
      clearPushOwner();
      toast.success("Notifikasi push dimatikan.");
    } catch {
      toast.error("Gagal mematikan notifikasi push.");
    } finally {
      setBusy(false);
    }
  }, [browserSubscription, unregisterMutation]);

  return {
    state,
    supported,
    busy: busy || registerMutation.isPending,
    enable,
    disable,
  };
}

/**
 * Reconcile this device's push row on ordinary app entry.
 *
 * A browser subscription can go stale with no page open: a logout clears the
 * row, and the push service can rotate the endpoint behind a
 * `pushsubscriptionchange`. `useWebPush` repairs both, but it used to mount
 * only on the notification settings page, so a device could sit logged in with
 * a valid subscription and no server row — receiving nothing — until someone
 * happened to open that screen. Mounting this on the authenticated shell runs
 * the same reconciliation on every page. It renders nothing and never toasts.
 */
export function useWebPushReconcile(): void {
  useWebPush();
}
