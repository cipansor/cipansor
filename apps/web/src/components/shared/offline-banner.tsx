"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { useIsOnline } from "@/hooks/use-online-status";
import { WifiOff, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface OfflineBannerProps {
  /**
   * Custom message to display
   */
  message?: string;
  /**
   * Whether to show retry button
   */
  showRetry?: boolean;
  /**
   * Retry callback
   */
  onRetry?: () => void;
  /**
   * Additional class names
   */
  className?: string;
}

/**
 * Offline Banner component
 * Shows when the user loses internet connection
 *
 * @example
 * ```tsx
 * function Layout({ children }) {
 *   return (
 *     <>
 *       <OfflineBanner />
 *       {children}
 *     </>
 *   );
 * }
 * ```
 */
export function OfflineBanner({
  message = "Anda sedang offline. Beberapa fitur mungkin tidak tersedia.",
  showRetry = true,
  onRetry,
  className,
}: OfflineBannerProps) {
  const isOnline = useIsOnline();
  const [isRetrying, setIsRetrying] = React.useState(false);

  const handleRetry = async () => {
    setIsRetrying(true);
    try {
      // Trigger a fetch to check connection
      await fetch("/ping", { method: "HEAD" }).catch(() => {});
      onRetry?.();
    } finally {
      setIsRetrying(false);
    }
  };

  if (isOnline) {
    return null;
  }

  return (
    <div
      role="alert"
      className={cn(
        "fixed top-0 left-0 right-0 z-50",
        "bg-yellow-500 text-yellow-950",
        "px-4 py-2",
        "flex items-center justify-center gap-3",
        "animate-in slide-in-from-top duration-300",
        // Informational overlay: never swallow clicks meant for the content
        // beneath it (the interactive retry button re-enables them on itself).
        "pointer-events-none",
        className,
      )}
    >
      <WifiOff className="h-4 w-4 shrink-0" />
      <span className="text-sm font-medium">{message}</span>
      {showRetry && (
        <Button
          size="sm"
          variant="secondary"
          onClick={handleRetry}
          disabled={isRetrying}
          className="h-7 px-2 pointer-events-auto"
        >
          <RefreshCw
            className={cn("h-3.5 w-3.5 mr-1", isRetrying && "animate-spin")}
          />
          Coba Lagi
        </Button>
      )}
    </div>
  );
}

interface ConnectionStatusProps {
  /**
   * API health check URL
   */
  pingUrl?: string;
  /**
   * Check interval in ms
   */
  checkInterval?: number;
}

/**
 * Connection Status indicator
 * Shows a small indicator when connection is unstable
 */
export function ConnectionStatus({
  pingUrl = "/ping",
  checkInterval = 30000,
}: ConnectionStatusProps) {
  const isOnline = useIsOnline();
  const [apiStatus, setApiStatus] = React.useState<
    "online" | "checking" | "offline"
  >("online");

  React.useEffect(() => {
    if (!isOnline) {
      setApiStatus("offline");
      return;
    }

    const checkApi = async () => {
      setApiStatus("checking");
      try {
        const response = await fetch(pingUrl, {
          method: "HEAD",
          cache: "no-store",
        });
        setApiStatus(response.ok ? "online" : "offline");
      } catch {
        setApiStatus("offline");
      }
    };

    checkApi();
    const interval = setInterval(checkApi, checkInterval);

    return () => clearInterval(interval);
  }, [isOnline, pingUrl, checkInterval]);

  if (apiStatus === "online") {
    return null;
  }

  return (
    <div
      className={cn(
        "fixed bottom-4 right-4 z-50",
        "flex items-center gap-2",
        "px-3 py-2 rounded-full shadow-lg",
        "text-xs font-medium",
        apiStatus === "checking"
          ? "bg-yellow-100 text-yellow-800"
          : "bg-red-100 text-red-800",
      )}
    >
      <span
        className={cn(
          "h-2 w-2 rounded-full",
          apiStatus === "checking"
            ? "bg-yellow-500 animate-pulse"
            : "bg-red-500",
        )}
      />
      {apiStatus === "checking"
        ? "Memeriksa koneksi..."
        : "Server tidak tersedia"}
    </div>
  );
}
