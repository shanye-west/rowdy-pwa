import { useState, useEffect } from "react";

export interface NetworkStatus {
  /** Whether the browser reports being online */
  isOnline: boolean;
}

/**
 * Simple hook to track browser online/offline status.
 * 
 * Firestore handles persistence and sync automatically via persistentLocalCache.
 * This hook just tells us if we're online so we can show appropriate UI.
 */
export function useNetworkStatus(): NetworkStatus {
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

  return { isOnline };
}
