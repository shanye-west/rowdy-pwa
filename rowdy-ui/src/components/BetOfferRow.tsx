/**
 * One open offer inside a market card: who's backing what, the stake, and a
 * Take button. Used by both InlineBetCard (Cup futures) and the Markets tab
 * (open match bets) so the two read identically. The layout is overflow-proof —
 * the long names live in a truncating column and the stake + fixed-width Take
 * button sit in a shrink-0 column, so nothing spills out of the tile.
 */

import { Link } from "react-router-dom";

export interface BetOfferRowProps {
  /** Team color dot for the side being backed. */
  dotColor: string;
  /** Display name of the player who posted the offer. */
  proposerName: string;
  /** Label of the side the proposer is backing. */
  backsLabel: string;
  /** Label of the side you'd take if you accept. */
  takeLabel: string;
  amount: number;
  /** True if this is your own offer (Take is disabled). */
  mine: boolean;
  loggedIn: boolean;
  onTake: () => void;
}

export default function BetOfferRow({
  dotColor,
  proposerName,
  backsLabel,
  takeLabel,
  amount,
  mine,
  loggedIn,
  onTake,
}: BetOfferRowProps) {
  return (
    <li className="flex items-center gap-2.5 rounded-lg bg-slate-50 px-3 py-2">
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: dotColor }} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs text-slate-600">
          <span className="font-semibold text-slate-800">{proposerName}</span> backs{" "}
          <span className="font-semibold text-slate-800">{backsLabel}</span>
        </div>
        <div className="truncate text-[0.7rem] text-slate-400">You'd back {takeLabel}</div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-sm font-bold tabular-nums text-slate-900">${amount}</span>
        {loggedIn ? (
          <button
            type="button"
            disabled={mine}
            onClick={onTake}
            className="rounded-full bg-green-600 px-3.5 py-1 text-xs font-semibold text-white active:scale-95 disabled:bg-slate-200 disabled:text-slate-400"
          >
            {mine ? "Yours" : "Take"}
          </button>
        ) : (
          <Link to="/login" className="text-xs font-semibold text-blue-600">
            Log in
          </Link>
        )}
      </div>
    </li>
  );
}
