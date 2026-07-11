import { RotateCcw } from "lucide-react";

export interface WaitingPanelProps {
  teamName: string;
  teamColor: string;
  /** True on a response turn (choosing a matchup) vs a nomination. */
  isResponse: boolean;
  canUndo: boolean;
  busy: boolean;
  onUndo: () => void;
}

/**
 * Shown to the non-acting captain while the other team is on the clock. Makes
 * the live "we're waiting on them" state explicit (instead of a bare board),
 * and keeps the undo affordance reachable when this side owns the last pick.
 * The turn banner already announces changes via aria-live, so this panel stays
 * silent to screen readers.
 */
export default function WaitingPanel({
  teamName,
  teamColor,
  isResponse,
  canUndo,
  busy,
  onUndo,
}: WaitingPanelProps) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2.5">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full motion-safe:animate-pulse"
          style={{ background: teamColor }}
        />
        <p className="text-sm text-foreground">
          <span className="font-bold">{teamName}</span> is choosing{" "}
          {isResponse ? "their matchup" : "a nomination"}…
        </p>
      </div>
      <p className="mt-1.5 pl-5 text-xs text-muted-foreground">
        This page updates live — no need to refresh.
      </p>
      {canUndo && (
        <button
          className="btn btn-secondary mt-3 inline-flex w-full items-center justify-center gap-1.5"
          disabled={busy}
          onClick={onUndo}
        >
          <RotateCcw size={15} /> Undo last pick
        </button>
      )}
    </div>
  );
}
