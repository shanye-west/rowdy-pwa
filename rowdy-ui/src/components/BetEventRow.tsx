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
  /** Right-side hint, e.g. "2 open" or "Tap to bet". */
  hint?: string;
  /** Draw attention to the hint (e.g. there are offers to take). */
  hintActive?: boolean;
  onClick: () => void;
}

function BetEventRow({ label, subtitle, accent, hint, hintActive, onClick }: BetEventRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted active:bg-muted"
    >
      {accent && (
        <span className="flex h-9 w-1.5 shrink-0 flex-col overflow-hidden rounded-full">
          <span className="flex-1" style={{ backgroundColor: accent.teamA }} />
          <span className="flex-1" style={{ backgroundColor: accent.teamB }} />
        </span>
      )}
      <div className="min-w-0 flex-1 leading-snug">
        <div className="text-sm font-semibold text-foreground">{label}</div>
        {subtitle && <div className="truncate text-[0.7rem] text-muted-foreground">{subtitle}</div>}
      </div>
      {hint && (
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[0.7rem] font-semibold ${
            hintActive ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"
          }`}
        >
          {hint}
        </span>
      )}
      <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
    </button>
  );
}

export default memo(BetEventRow);
