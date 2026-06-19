import { memo } from "react";

interface SyncStatusBadgeProps {
  /** Match doc has local writes not yet acknowledged by the server. */
  hasPendingWrites: boolean;
  /** Whether the device currently reports being online. */
  isOnline: boolean;
}

/**
 * Persistent confidence indicator for whether scores have reached the server.
 *
 * Unlike SaveStatusIndicator (transient per-save feedback), this reflects the
 * authoritative sync state from Firestore snapshot metadata, so a player can
 * confirm everything is safely synced before closing the app or leaving
 * coverage:
 *  - pending + offline → "Saved on device · will sync"
 *  - pending + online  → "Syncing…"
 *  - no pending        → "All changes synced ✓"
 */
export const SyncStatusBadge = memo(function SyncStatusBadge({
  hasPendingWrites,
  isOnline,
}: SyncStatusBadgeProps) {
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
  } else {
    cls = "bg-green-100 text-green-700";
    dotCls = "bg-green-500";
    label = "All changes synced";
    synced = true;
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
