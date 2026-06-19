/**
 * The hero card atop the My Bets tab: a dark, branded summary of the player's
 * betting standing — net P&L (settled bets), W-L-P record, and the running
 * "owed to you / you owe" totals from the head-to-head tab. Presentational; all
 * figures are computed by the caller from the useBets selectors.
 */

import { memo } from "react";
import { Card } from "./ui/card";

interface BetSummaryCardProps {
  /** Net of settled bets (positive = up, negative = down). */
  net: number;
  wins: number;
  losses: number;
  pushes: number;
  /** Total others currently owe this player (sum of positive tabs). */
  owedToYou: number;
  /** Total this player currently owes others (sum of negative tabs). */
  youOwe: number;
}

const signed = (n: number): string => (n < 0 ? `-$${Math.abs(n)}` : `$${n}`);

function BetSummaryCard({ net, wins, losses, pushes, owedToYou, youOwe }: BetSummaryCardProps) {
  const netColor = net > 0 ? "text-emerald-400" : net < 0 ? "text-red-400" : "text-white";
  return (
    <Card className="border-0 bg-slate-900 p-5 text-white shadow-md">
      <div className="text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-white/50">Your net</div>
      <div className={`font-display text-4xl font-bold leading-tight tabular-nums ${netColor}`}>{signed(net)}</div>
      <div className="mt-1 text-xs font-medium text-white/60">
        {wins}W · {losses}L{pushes > 0 ? ` · ${pushes}P` : ""}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-white/10 p-3">
          <div className="text-[0.55rem] font-semibold uppercase tracking-wide text-white/50">Owed to you</div>
          <div className="text-lg font-bold tabular-nums text-emerald-400">${owedToYou}</div>
        </div>
        <div className="rounded-xl bg-white/10 p-3">
          <div className="text-[0.55rem] font-semibold uppercase tracking-wide text-white/50">You owe</div>
          <div className="text-lg font-bold tabular-nums text-red-400">${youOwe}</div>
        </div>
      </div>
    </Card>
  );
}

export default memo(BetSummaryCard);
