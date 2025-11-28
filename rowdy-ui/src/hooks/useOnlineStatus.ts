import { useState, useEffect, useCallback } from "react";

/**
 * Hook to track online/offline status.
 * Returns current status and provides utilities for offline-aware operations.
 */
export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(() => 
    typeof navigator !== "undefined" ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return isOnline;
}

/**
 * Hook to track online status with additional metadata.
 * Useful for showing "back online" messages and tracking offline duration.
 */
export function useOnlineStatusWithHistory() {
  const [isOnline, setIsOnline] = useState(() => 
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const [wasOffline, setWasOffline] = useState(false);
  const [offlineSince, setOfflineSince] = useState<Date | null>(null);

  // Clear the "was offline" flag after showing a message
  const clearWasOffline = useCallback(() => {
    setWasOffline(false);
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      if (offlineSince) {
        setWasOffline(true);
        setOfflineSince(null);
        // Auto-clear "back online" message after 3 seconds
        setTimeout(() => setWasOffline(false), 3000);
      }
    };

    const handleOffline = () => {
      setIsOnline(false);
      setOfflineSince(new Date());
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [offlineSince]);

  return { isOnline, wasOffline, offlineSince, clearWasOffline };
}

// =============================================================================
// Utility functions for offline-aware operations
// =============================================================================

/**
 * Check if a Firestore error is due to being offline.
 * Firestore queues writes when offline, so these aren't real failures.
 */
export function isOfflineError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  const rawCode = (error as { code?: string | number }).code;
  const code = typeof rawCode === "string" ? rawCode.toLowerCase() : "";
  
  return (
    code === "unavailable" ||
    code === "failed-precondition" ||
    msg.includes("offline") ||
    msg.includes("network") ||
    msg.includes("failed to fetch") ||
    msg.includes("client is offline")
  );
}

/**
 * Determines the appropriate user message for a Firestore write error.
 * Returns null if the error should be silently ignored (queued for later).
 */
export function getWriteErrorMessage(error: unknown): string | null {
  if (isOfflineError(error)) {
    // Firestore queued the write - not a real error
    return null;
  }
  
  if (error instanceof Error) {
    const code = (error as { code?: string }).code || "";
    
    if (code === "permission-denied") {
      return "Permission denied. Please log in to save scores.";
    }
    if (code === "not-found") {
      return "Match not found. It may have been deleted.";
    }
    
    return "Failed to save. Please try again.";
  }
  
  return "An unexpected error occurred.";
}
