/**
 * One open offer inside a market card, drawn as a head-to-head tile (see
 * BetMatchup): the proposer sits on the side they bet (filled with their team
 * color); the open side shows a Take button you tap to bet the other team.
 * Used inside the bet sheet to list takeable team-market offers (match/round/cup).
 */

import { memo } from "react";
import { Link } from "react-router-dom";
import BetMatchup, { type MatchupSide } from "./BetMatchup";
import type { BetSide } from "../types";

export interface BetOfferRowProps {
  teamALabel: string;
  teamBLabel: string;
  teamAColor: string;
  teamBColor: string;
  /** Side the proposer bet — that half is filled and shows their name. */
  proposerSide: BetSide;
  proposerName: string;
  amount: number;
  /** True if this is your own offer (Take is disabled). */
  mine: boolean;
  loggedIn: boolean;
  onTake: () => void;
}

function BetOfferRow({
  teamALabel,
  teamBLabel,
  teamAColor,
  teamBColor,
  proposerSide,
  proposerName,
  amount,
  mine,
  loggedIn,
  onTake,
}: BetOfferRowProps) {
  const buildSide = (key: BetSide, label: string, color: string): MatchupSide => {
    if (proposerSide === key) {
      return { label, color, filled: true, content: <span className="block truncate">{proposerName}</span> };
    }
    return {
      label,
      color,
      content: loggedIn ? (
        <button
          type="button"
          disabled={mine}
          onClick={onTake}
          style={mine ? undefined : { backgroundColor: color }}
          className="rounded-full px-3.5 py-1 text-xs font-semibold text-white active:scale-95 disabled:bg-slate-200 disabled:text-slate-400"
        >
          {mine ? "Yours" : "Take"}
        </button>
      ) : (
        <Link to="/login" className="text-xs font-semibold text-blue-600">
          Log in
        </Link>
      ),
    };
  };

  return (
    <li>
      <BetMatchup
        teamA={buildSide("teamA", teamALabel, teamAColor)}
        teamB={buildSide("teamB", teamBLabel, teamBColor)}
        amount={amount}
      />
    </li>
  );
}

export default memo(BetOfferRow);
