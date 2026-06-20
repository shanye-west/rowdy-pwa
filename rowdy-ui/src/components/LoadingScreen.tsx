import { useEffect, useState } from "react";
import { hardResetApp } from "../utils/swRecovery";

interface LoadingScreenProps {
  /**
   * Wrapper sizing/spacing classes, so a drop-in replacement keeps each page's
   * original spinner footprint (e.g. "py-20" or "min-h-[60vh]").
   */
  className?: string;
  /** ms of spinner before hinting that something may be wrong (default 8s). */
  slowAfterMs?: number;
  /** ms before offering a full app reset (default 18s). */
  stuckAfterMs?: number;
}

type Phase = "loading" | "slow" | "stuck";

/**
 * Centered loading spinner with a timed escape hatch. A genuinely stuck load
 * (first Firestore snapshot never arrives, wedged SW cache, dead connection)
 * used to spin forever with no way out but force-closing the app. After a few
 * seconds this surfaces a Reload, and after a while a "Reset app" that clears
 * the SW + caches.
 */
export default function LoadingScreen({
  className = "py-20",
  slowAfterMs = 8000,
  stuckAfterMs = 18000,
}: LoadingScreenProps) {
  const [phase, setPhase] = useState<Phase>("loading");

  useEffect(() => {
    const slow = setTimeout(() => setPhase((p) => (p === "loading" ? "slow" : p)), slowAfterMs);
    const stuck = setTimeout(() => setPhase("stuck"), stuckAfterMs);
    return () => {
      clearTimeout(slow);
      clearTimeout(stuck);
    };
  }, [slowAfterMs, stuckAfterMs]);

  return (
    <div className={`flex flex-col items-center justify-center gap-5 px-6 text-center ${className}`}>
      <div className="spinner-lg" />

      {phase !== "loading" && (
        <div className="space-y-3">
          <p className="max-w-xs text-sm text-muted-foreground">
            {phase === "stuck"
              ? "Still loading. This can happen right after an update or on a weak signal."
              : "Taking longer than usual…"}
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Reload
            </button>
            {phase === "stuck" && (
              <button
                type="button"
                onClick={() => { void hardResetApp(); }}
                className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
              >
                Reset app
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
