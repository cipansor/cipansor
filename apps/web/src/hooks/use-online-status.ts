"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface UseOnlineStatusReturn {
  /**
   * Whether the browser is currently online
   */
  isOnline: boolean;
  /**
   * Whether we've successfully reached the API server
   */
  isApiReachable: boolean;
  /**
   * Last time the connection was checked
   */
  lastChecked: Date | null;
  /**
   * Manually trigger a connection check
   */
  checkConnection: () => Promise<boolean>;
}

interface UseOnlineStatusOptions {
  /**
   * URL to ping for API reachability check
   */
  pingUrl?: string;
  /**
   * Interval in ms to check connection (0 to disable)
   */
  checkInterval?: number;
  /**
   * Callback when going online
   */
  onOnline?: () => void;
  /**
   * Callback when going offline
   */
  onOffline?: () => void;
}

/**
 * Hook to track online/offline status and API reachability
 *
 * @example
 * ```tsx
 * function App() {
 *   const { isOnline, isApiReachable } = useOnlineStatus({
 *     pingUrl: '/ping',
 *     onOffline: () => toast.error('Koneksi terputus'),
 *     onOnline: () => toast.success('Koneksi kembali'),
 *   });
 *
 *   if (!isOnline) {
 *     return <OfflineBanner />;
 *   }
 * }
 * ```
 */
export function useOnlineStatus(
  options: UseOnlineStatusOptions = {},
): UseOnlineStatusReturn {
  const {
    pingUrl,
    checkInterval = 30000, // 30 seconds
    onOnline,
    onOffline,
  } = options;

  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  const [isApiReachable, setIsApiReachable] = useState(true);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const previousOnlineRef = useRef(isOnline);
  const onOnlineRef = useRef(onOnline);
  const onOfflineRef = useRef(onOffline);

  // Update refs in useEffect to avoid updating during render
  useEffect(() => {
    onOnlineRef.current = onOnline;
    onOfflineRef.current = onOffline;
  }, [onOnline, onOffline]);

  // Check API reachability
  const checkConnection = useCallback(async (): Promise<boolean> => {
    if (!pingUrl) {
      setLastChecked(new Date());
      return isOnline;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(pingUrl, {
        method: "HEAD",
        signal: controller.signal,
        cache: "no-store",
      });

      clearTimeout(timeoutId);

      const reachable = response.ok;
      setIsApiReachable(reachable);
      setLastChecked(new Date());
      return reachable;
    } catch {
      setIsApiReachable(false);
      setLastChecked(new Date());
      return false;
    }
  }, [pingUrl, isOnline]);

  // Handle browser online/offline events
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      if (!previousOnlineRef.current) {
        onOnlineRef.current?.();
        // Check API when coming back online
        checkConnection();
      }
      previousOnlineRef.current = true;
    };

    const handleOffline = () => {
      setIsOnline(false);
      setIsApiReachable(false);
      if (previousOnlineRef.current) {
        onOfflineRef.current?.();
      }
      previousOnlineRef.current = false;
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [checkConnection]);

  // Periodic connection check
  useEffect(() => {
    if (!checkInterval || checkInterval <= 0) return;

    const intervalId = setInterval(() => {
      if (isOnline) {
        checkConnection();
      }
    }, checkInterval);

    return () => clearInterval(intervalId);
  }, [checkInterval, isOnline, checkConnection]);

  // Initial check
  useEffect(() => {
    let mounted = true;
    if (pingUrl) {
      checkConnection().then(() => {
        if (!mounted) return;
        // Do nothing else
      });
    }
    return () => {
      mounted = false;
    };
    // We intentionally ignore checkConnection dependency here to run only on mount/unmount or pingUrl change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pingUrl]);

  return {
    isOnline,
    isApiReachable,
    lastChecked,
    checkConnection,
  };
}

/** Same-origin probe used to verify a claimed offline state. */
const OFFLINE_PROBE_URL = "/ping";
/** Re-verify cadence while the browser claims to be offline. */
const OFFLINE_RECHECK_MS = 15000;

/**
 * Simple hook to check if browser is online.
 *
 * `navigator.onLine === false` is only a HINT: VPNs, proxies, some Linux
 * network managers, and automated browsers misreport it, and a missed
 * `online` event leaves it stale after a network switch. So before declaring
 * offline we verify with a real same-origin request, and while offline we
 * keep re-checking so a wrong verdict self-heals.
 */
export function useIsOnline(): boolean {
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const verifyOffline = async () => {
      if (navigator.onLine) {
        setIsOffline(false);
        return;
      }
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(OFFLINE_PROBE_URL, {
          method: "HEAD",
          cache: "no-store",
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        // Any response at all means the network works, whatever onLine says.
        if (!cancelled) setIsOffline(!res.ok);
      } catch {
        if (!cancelled) setIsOffline(true);
      }
    };

    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => void verifyOffline();

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    void verifyOffline();
    const intervalId = setInterval(
      () => void verifyOffline(),
      OFFLINE_RECHECK_MS,
    );

    return () => {
      cancelled = true;
      clearInterval(intervalId);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return !isOffline;
}
