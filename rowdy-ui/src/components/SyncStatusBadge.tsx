import { memo, useEffect, useRef, useState } from "react";

interface SyncStatusBadgeProps {
  /** Match doc has local writes not yet acknowledged by the server. */
  hasPendingWrites: boolean;
  /** Whether the device currently reports being online. */
  isOnline: boolean;
}

/** How long the "all synced" confirmation lingers after writes land. */
const SYNCED_CONFIRM_MS = 2500;

/**
 * Confidence indicator for whether scores have reached the server.
 *
 * Unlike SaveStatusIndicator (transient per-save feedback), this reflects the
 * authoritative sync state from Firestore snapshot metadata:
 *  - pending + offline → "Saved on device · will sync"
 *  - pending + online  → "Syncing…"
 *  - no pending        → nothing, except a brief "All changes synced ✓"
 *                        confirmation right after pending writes clear
 *
 * The steady state renders nothing so the scorecard isn't permanently paying
 * screen space for "everything is fine" — the badge only speaks up when scores
 * are still in flight, or to confirm the moment they land.
 */
export const SyncStatusBadge = memo(function SyncStatusBadge({
  hasPendingWrites,
  isOnline,
}: SyncStatusBadgeProps) {
  const [showSynced, setShowSynced] = useState(false);
  const wasPendingRef = useRef(false);

  useEffect(() => {
    if (hasPendingWrites) {
      wasPendingRef.current = true;
      setShowSynced(false);
      return;
    }
    // Only confirm after a real pending→synced transition, so simply opening a
    // fully-synced scorecard shows nothing at all.
    if (!wasPendingRef.current) return;
    wasPendingRef.current = false;
    setShowSynced(true);
    const id = window.setTimeout(() => setShowSynced(false), SYNCED_CONFIRM_MS);
    return () => window.clearTimeout(id);
  }, [hasPendingWrites]);

  let cls: string;
  let dotCls: string;
  let label: string;
  let synced = false;

  if (hasPendingWrites && !isOnline) {
    cls = "bg-amber-100 text-amber-800";
    dotCls = "bg-amber-500";
    label = "Saved on device · will sync";
  } else if (hasPendingWrites) {
    cls = "bg-muted text-muted-foreground";
    dotCls = "bg-slate-400 animate-pulse";
    label = "Syncing…";
  } else if (showSynced) {
    cls = "bg-green-100 text-green-700";
    dotCls = "bg-green-500";
    label = "All changes synced";
    synced = true;
  } else {
    return null;
  }

  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${cls}`}
      role="status"
      aria-live="polite"
    >
      <span className={`h-2 w-2 rounded-full ${dotCls}`} />
      <span>{label}</span>
      {synced && <span className="text-green-600">✓</span>}
    </div>
  );
});

export default SyncStatusBadge;
