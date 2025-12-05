import { useEffect, useRef, useCallback } from "react";

/**
 * Hook that flushes pending saves when the app goes to background.
 * 
 * This is critical for mobile where iOS aggressively kills background JS.
 * When the user switches apps or locks the phone, we immediately flush
 * any debounced saves to prevent data loss.
 * 
 * @param flushFn - Function to flush pending saves (e.g., flushAll from useDebouncedSave)
 */
export function useVisibilityFlush(flushFn: () => void) {
  const flushRef = useRef(flushFn);
  
  // Keep ref updated with latest flush function
  useEffect(() => {
    flushRef.current = flushFn;
  }, [flushFn]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        // App going to background - flush immediately
        flushRef.current();
      }
    };

    // Also handle page unload/close
    const handleBeforeUnload = () => {
      flushRef.current();
    };

    // iOS-specific: handle page hide event (more reliable than visibilitychange on iOS)
    const handlePageHide = () => {
      flushRef.current();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, []);
}

/**
 * Hook that provides a flush function and automatically flushes on visibility change.
 * Use this when you need to both trigger flushes manually and auto-flush on background.
 * 
 * @param saveFn - The save function to flush to
 * @returns A manual flush trigger
 */
export function useAutoFlush(
  pendingData: Map<string, unknown>,
  saveFn: (key: string, data: unknown) => void
) {
  const flushAll = useCallback(() => {
    pendingData.forEach((data, key) => {
      saveFn(key, data);
    });
    pendingData.clear();
  }, [pendingData, saveFn]);

  useVisibilityFlush(flushAll);

  return flushAll;
}
