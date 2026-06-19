/**
 * The head-to-head tile shared by the Markets and My Bets surfaces: Team A on
 * the left, Team B on the right, each in its team color, with the stake in the
 * middle. One side may be "filled" (solid team color, white text) to mark the
 * viewer's pick or the offer's proposer; the other reads on a light background.
 * Each side renders arbitrary content (a name, a Take button, "Open", …).
 */

import type { CSSProperties, ReactNode } from "react";
import SideLabel from "./SideLabel";

export interface MatchupSide {
  /** The side's name (player pairing or team name). */
  label: string;
  color: string;
  /** Fill this side with its team color (white text). */
  filled?: boolean;
  /** What sits under the label — a name, a button, an "Open" tag, etc. */
  content: ReactNode;
}

export interface BetMatchupProps {
  teamA: MatchupSide;
  teamB: MatchupSide;
  amount: number;
  /** Optional strip below the head-to-head row — e.g. live match status. */
  footer?: ReactNode;
}

export default function BetMatchup({ teamA, teamB, amount, footer }: BetMatchupProps) {
  return (
    <div className="overflow-hidden rounded-lg ring-1 ring-slate-200">
      <div className="flex items-stretch">
        <SideCell side={teamA} align="left" />
        <div className="flex shrink-0 flex-col items-center justify-center bg-muted px-2.5 py-2">
          <span className="text-[0.55rem] font-bold uppercase tracking-wide text-muted-foreground">Bet</span>
          <span className="text-sm font-bold tabular-nums text-foreground">${amount}</span>
        </div>
        <SideCell side={teamB} align="right" />
      </div>
      {footer && (
        <div className="border-t border-border bg-muted/60 px-3 py-1.5 text-[0.7rem] font-semibold">
          {footer}
        </div>
      )}
    </div>
  );
}

function SideCell({ side, align }: { side: MatchupSide; align: "left" | "right" }) {
  const { label, color, filled, content } = side;
  const labelStyle: CSSProperties | undefined = filled ? undefined : { color };
  return (
    <div
      className={`flex min-w-0 flex-1 flex-col justify-center gap-1 px-3 py-2 ${
        align === "right" ? "items-end text-right" : "items-start text-left"
      }`}
      style={filled ? { backgroundColor: color } : undefined}
    >
      <SideLabel
        label={label}
        className={`max-w-full text-[0.6rem] font-bold uppercase leading-tight tracking-wide ${
          filled ? "text-white/80" : ""
        }`}
        style={labelStyle}
      />
      <div className={`max-w-full text-sm font-semibold ${filled ? "text-white" : "text-foreground"}`}>{content}</div>
    </div>
  );
}
