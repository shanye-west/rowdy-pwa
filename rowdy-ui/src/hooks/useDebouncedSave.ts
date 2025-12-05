import { useCallback, useRef, useEffect, useState } from "react";

// Browser-compatible timeout type
type TimeoutId = ReturnType<typeof setTimeout>;

/** Save status for UI feedback */
export type SaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

/**
 * A hook that provides debounced save functionality per unique key.
 * Each key (e.g., hole number) has its own debounce timer, so typing
 * on different holes doesn't cancel each other's saves.
 * 
 * @param saveFn - The actual save function to call after debounce
 * @param delay - Debounce delay in milliseconds (default 400ms)
 * @returns A debounced save function that accepts (key, data), plus save status
 */
export function useDebouncedSave<T>(
  saveFn: (key: string, data: T) => void | Promise<void>,
  delay: number = 400
) {
  // Map of key -> timeout ID for per-key debouncing
  const timersRef = useRef<Map<string, TimeoutId>>(new Map());
  // Map of key -> pending data (for cleanup/flush)
  const pendingRef = useRef<Map<string, T>>(new Map());
  // Track if component is mounted
  const mountedRef = useRef(true);
  // Save status for UI feedback
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  // Timer to reset status back to idle
  const statusTimerRef = useRef<TimeoutId | null>(null);

  // Cleanup on unmount - flush all pending saves
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Clear status timer
      if (statusTimerRef.current) {
        clearTimeout(statusTimerRef.current);
      }
      // Clear all timers and flush pending saves
      timersRef.current.forEach((timer, key) => {
        clearTimeout(timer);
        const pendingData = pendingRef.current.get(key);
        if (pendingData !== undefined) {
          // Fire immediately on unmount to prevent data loss
          saveFn(key, pendingData);
        }
      });
      timersRef.current.clear();
      pendingRef.current.clear();
    };
  }, [saveFn]);
  
  // Helper to update status with auto-reset to idle
  const updateStatus = useCallback((status: SaveStatus) => {
    if (!mountedRef.current) return;
    
    // Clear any existing reset timer
    if (statusTimerRef.current) {
      clearTimeout(statusTimerRef.current);
      statusTimerRef.current = null;
    }
    
    setSaveStatus(status);
    
    // Auto-reset to idle after "saved" or "error"
    if (status === "saved" || status === "error") {
      statusTimerRef.current = setTimeout(() => {
        if (mountedRef.current) {
          setSaveStatus("idle");
        }
      }, 2000);
    }
  }, []);

  const debouncedSave = useCallback(
    (key: string, data: T) => {
      // Store the pending data
      pendingRef.current.set(key, data);
      updateStatus("pending");

      // Clear existing timer for this key
      const existingTimer = timersRef.current.get(key);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      // Set new timer
      const timer = setTimeout(async () => {
        if (mountedRef.current) {
          const dataToSave = pendingRef.current.get(key);
          if (dataToSave !== undefined) {
            updateStatus("saving");
            try {
              await saveFn(key, dataToSave);
              updateStatus("saved");
            } catch {
              updateStatus("error");
            }
            pendingRef.current.delete(key);
          }
        }
        timersRef.current.delete(key);
      }, delay);

      timersRef.current.set(key, timer);
    },
    [saveFn, delay, updateStatus]
  );

  // Allow immediate flush of a specific key (e.g., on blur)
  const flush = useCallback(
    (key: string) => {
      const timer = timersRef.current.get(key);
      if (timer) {
        clearTimeout(timer);
        timersRef.current.delete(key);
      }
      const pendingData = pendingRef.current.get(key);
      if (pendingData !== undefined) {
        saveFn(key, pendingData);
        pendingRef.current.delete(key);
      }
    },
    [saveFn]
  );

  // Flush all pending saves
  const flushAll = useCallback(() => {
    timersRef.current.forEach((timer, key) => {
      clearTimeout(timer);
      const pendingData = pendingRef.current.get(key);
      if (pendingData !== undefined) {
        saveFn(key, pendingData);
      }
    });
    timersRef.current.clear();
    pendingRef.current.clear();
  }, [saveFn]);

  return { debouncedSave, flush, flushAll, saveStatus };
}
