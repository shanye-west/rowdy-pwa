/**
 * A single tappable row in the Open Bets list: one bettable event (a match,
 * session, or the Cup). Tapping it opens the focused bet sheet. Kept deliberately
 * compact — the dense builders live in the sheet, not here.
 */

import { memo, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";

export interface BetEventRowProps {
  /** Row title — a string, or a node (e.g. a two-line stacked matchup). */
  label: ReactNode;
  subtitle?: string;
  /** Team colors for the small split accent bar on the left. */
  accent?: { teamA: string; teamB: string };
  /**
   * How many open offers sit on this event. Renders a chip only when there are
   * any — a row with nothing waiting says nothing, since the chevron already
   * tells you it's tappable.
   */
  openCount?: number;
  onClick: () => void;
}

function BetEventRow({ label, subtitle, accent, openCount = 0, onClick }: BetEventRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60 active:bg-muted"
    >
      {accent && (
        <span className="flex h-9 w-1.5 shrink-0 flex-col overflow-hidden rounded-full">
          <span className="flex-1" style={{ backgroundColor: accent.teamA }} />
          <span className="flex-1" style={{ backgroundColor: accent.teamB }} />
        </span>
      )}
      <div className="min-w-0 flex-1 leading-snug">
        <div className="text-sm font-semibold text-foreground">{label}</div>
        {subtitle && <div className="truncate text-xs text-muted-foreground">{subtitle}</div>}
      </div>
      {openCount > 0 && (
        <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
          {openCount} open
        </span>
      )}
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/40" />
    </button>
  );
}

export default memo(BetEventRow);
