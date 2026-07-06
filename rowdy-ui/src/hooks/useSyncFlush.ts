import { useEffect, useRef, useState } from "react";
import { waitForPendingWrites } from "firebase/firestore";
import { db } from "../firebase";

export type FlushState = "idle" | "syncing" | "synced";

/**
 * On each offline→online transition, wait for Firestore to flush its queued
 * writes to the server and expose a state the UI can surface app-wide:
 * "syncing" until the local write queue drains, then "synced" briefly, then
 * idle. This gives players a global "everything you entered offline is now on
 * the server" confirmation — the per-match SyncStatusBadge only covers the
 * match currently on screen.
 */
export function useSyncFlush(isOnline: boolean): FlushState {
  const [state, setState] = useState<FlushState>("idle");
  const prevOnlineRef = useRef(isOnline);

  useEffect(() => {
    const was = prevOnlineRef.current;
    prevOnlineRef.current = isOnline;
    if (!isOnline || was) return; // only act on an offline→online transition

    let cancelled = false;
    setState("syncing");
    waitForPendingWrites(db)
      .then(() => { if (!cancelled) setState("synced"); })
      .catch(() => { if (!cancelled) setState("idle"); });
    return () => { cancelled = true; };
  }, [isOnline]);

  // Auto-dismiss the "synced" confirmation after a moment.
  useEffect(() => {
    if (state !== "synced") return;
    const t = setTimeout(() => setState("idle"), 2500);
    return () => clearTimeout(t);
  }, [state]);

  return state;
}
