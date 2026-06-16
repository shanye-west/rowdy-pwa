/**
 * One open offer inside a market card, drawn as a head-to-head tile: Team A on
 * the left, Team B on the right, each in its team color, with the stake in the
 * middle. The proposer sits on the side they bet (filled with their team color);
 * the open side shows a Take button you tap to bet the other team. Used by both
 * InlineBetCard (Cup futures) and the Markets tab (open match bets).
 */

import { Fragment } from "react";
import { Link } from "react-router-dom";
import SideLabel from "./SideLabel";
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

export default function BetOfferRow({
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
  const sides = [
    { key: "teamA" as const, label: teamALabel, color: teamAColor, align: "left" as const },
    { key: "teamB" as const, label: teamBLabel, color: teamBColor, align: "right" as const },
  ];

  return (
    <li className="flex items-stretch overflow-hidden rounded-lg ring-1 ring-slate-200">
      {sides.map((s, i) => {
        const isProposer = proposerSide === s.key;
        return (
          <Fragment key={s.key}>
            {i === 1 && (
              <div className="flex shrink-0 flex-col items-center justify-center bg-slate-50 px-2.5 py-2">
                <span className="text-[0.55rem] font-bold uppercase tracking-wide text-slate-400">Bet</span>
                <span className="text-sm font-bold tabular-nums text-slate-900">${amount}</span>
              </div>
            )}
            <div
              className={`flex min-w-0 flex-1 flex-col justify-center gap-1 px-3 py-2 ${
                s.align === "right" ? "items-end text-right" : "items-start text-left"
              }`}
              style={isProposer ? { backgroundColor: s.color } : undefined}
            >
              <SideLabel
                label={s.label}
                className={`max-w-full text-[0.6rem] font-bold uppercase leading-tight tracking-wide ${
                  isProposer ? "text-white/80" : ""
                }`}
                style={isProposer ? undefined : { color: s.color }}
              />
              {isProposer ? (
                <span className="max-w-full truncate text-sm font-semibold text-white">{proposerName}</span>
              ) : loggedIn ? (
                <button
                  type="button"
                  disabled={mine}
                  onClick={onTake}
                  style={mine ? undefined : { backgroundColor: s.color }}
                  className="rounded-full px-3.5 py-1 text-xs font-semibold text-white active:scale-95 disabled:bg-slate-200 disabled:text-slate-400"
                >
                  {mine ? "Yours" : "Take"}
                </button>
              ) : (
                <Link to="/login" className="text-xs font-semibold text-blue-600">
                  Log in
                </Link>
              )}
            </div>
          </Fragment>
        );
      })}
    </li>
  );
}
