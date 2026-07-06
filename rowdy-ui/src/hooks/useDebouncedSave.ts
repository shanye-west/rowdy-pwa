import { useCallback, useRef, useEffect, useState } from "react";

// Browser-compatible timeout type
type TimeoutId = ReturnType<typeof setTimeout>;

/** Save status for UI feedback */
export type SaveStatus = "idle" | "pending" | "saving" | "saved" | "queued" | "error";

/**
 * How long to wait for a server acknowledgment before treating an
 * already-locally-committed write as "queued". Covers flaky coverage where
 * `navigator.onLine` still reports true but requests hang — we never want the
 * indicator stuck on "Saving…" while the score is in fact safe on-device.
 */
const QUEUED_AFTER_MS = 4000;

/** Light haptic feedback, matching the score picker's idiom. */
function vibrate(pattern: number | number[]) {
  if (typeof navigator !== "undefined" && navigator.vibrate) {
    navigator.vibrate(pattern);
  }
}

/**
 * A hook that provides debounced save functionality per unique key.
 * Each key (e.g., hole number) has its own debounce timer, so typing
 * on different holes doesn't cancel each other's saves.
 *
 * On failure the pending data is **kept** (not dropped) and the key is marked
 * errored so the UI can flag it and offer a retry — a buzz confirms success,
 * a distinct buzz signals failure.
 *
 * @param saveFn - The actual save function to call after debounce. Must reject on failure.
 * @param delay - Debounce delay in milliseconds (default 400ms)
 * @param merge - Optional combiner for repeated saves to the same key while a
 *   save is still pending/in-flight. When provided, a new save for a key merges
 *   with the outstanding data instead of replacing it, so partial edits to
 *   different fields of the same key accumulate rather than dropping earlier ones.
 */
export function useDebouncedSave<T>(
  saveFn: (key: string, data: T) => void | Promise<void>,
  delay: number = 400,
  merge?: (prev: T, next: T) => T
) {
  // Map of key -> timeout ID for per-key debouncing
  const timersRef = useRef<Map<string, TimeoutId>>(new Map());
  // Map of key -> pending data (retained until a save succeeds)
  const pendingRef = useRef<Map<string, T>>(new Map());
  // Track if component is mounted
  const mountedRef = useRef(true);
  // Aggregate save status for the small inline indicator
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  // Keys whose most recent save failed (sticky until retried/re-edited)
  const [erroredKeys, setErroredKeys] = useState<Set<string>>(() => new Set());
  // Timer to reset aggregate status back to idle
  const statusTimerRef = useRef<TimeoutId | null>(null);

  // Cleanup on unmount - flush all pending saves to prevent data loss
  useEffect(() => {
    mountedRef.current = true;
    // Capture the (stable) ref maps so the cleanup uses the same instances.
    const timers = timersRef.current;
    const pending = pendingRef.current;
    return () => {
      mountedRef.current = false;
      if (statusTimerRef.current) {
        clearTimeout(statusTimerRef.current);
      }
      timers.forEach((timer, key) => {
        clearTimeout(timer);
        const pendingData = pending.get(key);
        if (pendingData !== undefined) {
          // Fire immediately on unmount; swallow errors since we can't surface them.
          Promise.resolve(saveFn(key, pendingData)).catch(() => {});
        }
      });
      timers.clear();
      pending.clear();
    };
  }, [saveFn]);

  // Add/remove a key from the errored set, preserving reference when unchanged.
  const markErrored = useCallback((key: string, errored: boolean) => {
    setErroredKeys((prev) => {
      if (errored === prev.has(key)) return prev;
      const next = new Set(prev);
      if (errored) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  // Re-arm a key's pending data after a failed save, merge-aware: if newer
  // edits arrived while the save was in flight, the newer edits win per-field.
  const rearm = useCallback((key: string, failed: T) => {
    const newer = pendingRef.current.get(key);
    if (newer === undefined) {
      pendingRef.current.set(key, failed);
    } else {
      pendingRef.current.set(key, merge ? merge(failed, newer) : newer);
    }
  }, [merge]);

  // Update aggregate status with auto-reset to idle after a terminal state.
  const updateStatus = useCallback((status: SaveStatus) => {
    if (!mountedRef.current) return;
    if (statusTimerRef.current) {
      clearTimeout(statusTimerRef.current);
      statusTimerRef.current = null;
    }
    setSaveStatus(status);
    if (status === "saved" || status === "error" || status === "queued") {
      // Transient feedback only — the persistent sync state (e.g. the
      // SyncStatusBadge driven by metadata.hasPendingWrites) carries the
      // authoritative "queued vs synced" truth after this fades.
      statusTimerRef.current = setTimeout(() => {
        if (mountedRef.current) setSaveStatus("idle");
      }, 2000);
    }
  }, []);

  // Run saveFn for a key using its current pending data.
  const attempt = useCallback(
    async (key: string) => {
      if (!mountedRef.current) return;
      const data = pendingRef.current.get(key);
      if (data === undefined) return;

      // Issue the write. With Firestore offline persistence the local write is
      // committed synchronously and durably *here*; the returned promise only
      // resolves once the server acknowledges — and never resolves while
      // offline. So we must not gate the indicator on awaiting it indefinitely.
      const savePromise = Promise.resolve(saveFn(key, data));
      // The write is durable locally now — clear pending so flushes/unmount
      // don't redundantly re-issue it. (Re-armed below only on a real failure.)
      pendingRef.current.delete(key);
      markErrored(key, false);

      const offline = typeof navigator !== "undefined" && navigator.onLine === false;
      if (offline) {
        // Known offline: report the write as safely queued instead of hanging on
        // "Saving…". Firestore syncs it automatically when connectivity returns.
        updateStatus("queued");
        vibrate(10);
        // A queued write can still reject once connectivity returns (e.g. an admin
        // locked the match, or authorization changed) — the SDK then rolls the
        // local write back. Surface it as an error so the user isn't left believing
        // a rejected score was saved. (If the app is closed before reconnect, the
        // SDK replays the mutation on next launch with no in-app handler — an
        // accepted residual we can't catch client-side.)
        savePromise.catch(() => {
          if (!mountedRef.current) return;
          rearm(key, data);
          markErrored(key, true);
          updateStatus("error");
          vibrate([40, 30, 40]);
        });
        return;
      }

      updateStatus("saving");
      // Online, but coverage may be flaky: don't let "Saving…" hang. If the
      // server ack doesn't arrive promptly, treat the (already-durable) write as
      // queued; it flips to "saved" if the ack lands later.
      let settled = false;
      const queuedTimer = setTimeout(() => {
        if (settled || !mountedRef.current) return;
        updateStatus("queued");
      }, QUEUED_AFTER_MS);

      try {
        await savePromise;
        if (!mountedRef.current) return;
        settled = true;
        clearTimeout(queuedTimer);
        updateStatus("saved");
        vibrate(10);
      } catch {
        settled = true;
        clearTimeout(queuedTimer);
        if (!mountedRef.current) return;
        // Genuine failure (e.g. permission): re-arm pending so the user can retry.
        rearm(key, data);
        markErrored(key, true);
        updateStatus("error");
        vibrate([40, 30, 40]);
      }
    },
    [saveFn, updateStatus, markErrored, rearm]
  );

  const debouncedSave = useCallback(
    (key: string, data: T) => {
      const prev = pendingRef.current.get(key);
      pendingRef.current.set(key, prev !== undefined && merge ? merge(prev, data) : data);
      markErrored(key, false); // re-editing clears a prior error for this key
      updateStatus("pending");

      const existingTimer = timersRef.current.get(key);
      if (existingTimer) clearTimeout(existingTimer);

      const timer = setTimeout(() => {
        timersRef.current.delete(key);
        void attempt(key);
      }, delay);
      timersRef.current.set(key, timer);
    },
    [attempt, delay, markErrored, updateStatus, merge]
  );

  // Manually retry a failed (or still-pending) key immediately.
  const retry = useCallback(
    (key: string) => {
      const timer = timersRef.current.get(key);
      if (timer) {
        clearTimeout(timer);
        timersRef.current.delete(key);
      }
      void attempt(key);
    },
    [attempt]
  );

  // Immediate flush of a specific key (e.g., on blur)
  const flush = useCallback(
    (key: string) => {
      const timer = timersRef.current.get(key);
      if (timer) {
        clearTimeout(timer);
        timersRef.current.delete(key);
      }
      if (pendingRef.current.has(key)) void attempt(key);
    },
    [attempt]
  );

  // Flush all pending saves
  const flushAll = useCallback(() => {
    timersRef.current.forEach((timer) => clearTimeout(timer));
    timersRef.current.clear();
    pendingRef.current.forEach((_data, key) => void attempt(key));
  }, [attempt]);

  return { debouncedSave, flush, flushAll, retry, saveStatus, erroredKeys };
}
