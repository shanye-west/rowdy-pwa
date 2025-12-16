import React, { memo } from "react";
import { ScoreInputCell } from "./ScoreInputCell";
import type { HoleInputLoose } from "../../types";

/** Hole data structure used by PlayerScoreRow */
export interface HoleData {
  k: string;
  num: number;
  input: HoleInputLoose;
  par: number;
  hcpIndex?: number;
  yards?: number;
}

/** Props for PlayerScoreRow */
export interface PlayerScoreRowProps {
  /** Team key, kept for compatibility with callers */
  team?: "A" | "B";
  pIdx: number;
  label: React.ReactNode;
  color: string;
  holes: HoleData[];
  isLastOfTeam: boolean;
  isTeamB?: boolean; // For different bottom border style
  trackDrives: boolean;
  getCellValue: (holeKey: string) => number | "";
  isHoleLocked: (holeNum: number) => boolean;
  hasStroke: (holeIdx: number) => boolean;
  getDriveValue: (holeKey: string) => 0 | 1 | 2 | 3 | null;
  getLowScoreStatus: (holeKey: string) => 'solo' | 'tied' | null;
  onCellChange: (holeKey: string, value: number | null) => void;
  outTotal: number | null;
  inTotal: number | null;
  totalScore: number | null;
  /** 0-indexed hole where match closed (null if match ongoing or went to 18) */
  closingHole?: number | null;
}

/** Memoized player score row - renders 18 ScoreInputCells + totals */
export const PlayerScoreRow = memo(function PlayerScoreRow({
  pIdx,
  label,
  color,
  holes,
  isLastOfTeam,
  isTeamB,
  trackDrives,
  getCellValue,
  isHoleLocked,
  hasStroke,
  getDriveValue,
  getLowScoreStatus,
  onCellChange,
  outTotal,
  inTotal,
  totalScore,
  closingHole,
}: PlayerScoreRowProps) {
  // Team B last row has thicker border
  const rowClassName = isTeamB && isLastOfTeam 
    ? "border-b-2 border-slate-300" 
    : isLastOfTeam 
      ? "" 
      : "border-b border-slate-100";

  return (
    <tr className={rowClassName}>
      <td 
        className="sticky left-0 z-10 bg-white text-left px-3 py-1 font-semibold whitespace-nowrap"
        style={{ color }}
      >
        {label}
      </td>
      {/* Front 9 holes */}
      {holes.slice(0, 9).map((h, i) => {
        const holeIdx = i;
        const isPostMatch = closingHole != null && holeIdx > closingHole;
        
        let cellClass = "p-0.5";
        if (isPostMatch) cellClass += " bg-slate-50/60";
        
        return (
          <td 
            key={h.k} 
            className={cellClass}
          >
            <ScoreInputCell
              holeKey={h.k}
              holeNum={h.num}
              value={getCellValue(h.k)}
              par={h.par}
              locked={isHoleLocked(h.num)}
              hasStroke={hasStroke(h.num - 1)}
              hasDrive={trackDrives && getDriveValue(h.k) === pIdx}
              lowScoreStatus={getLowScoreStatus(h.k)}
              teamColor={color}
              onChange={onCellChange}
              isPostMatch={isPostMatch}
            />
          </td>
        );
      })}
      {/* OUT total */}
      <td className="py-1 bg-slate-50 font-bold text-slate-700 border-l-2 border-slate-200">
        {outTotal ?? "–"}
      </td>
      {/* Back 9 holes - post-match cells have border and tint */}
      {holes.slice(9, 18).map((h, i) => {
        const holeIdx = 9 + i;
        const isPostMatch = closingHole != null && holeIdx > closingHole;
        
        // Build class: first hole of back 9 gets border, first post-match gets thick colored border
        let cellClass = "p-0.5";
        if (i === 0) cellClass += " border-l-2 border-slate-200";
        if (isPostMatch) cellClass += " bg-slate-50/60";
        
        return (
          <td 
            key={h.k} 
            className={cellClass}
          >
            <ScoreInputCell
              holeKey={h.k}
              holeNum={h.num}
              value={getCellValue(h.k)}
              par={h.par}
              locked={isHoleLocked(h.num)}
              hasStroke={hasStroke(h.num - 1)}
              hasDrive={trackDrives && getDriveValue(h.k) === pIdx}
              lowScoreStatus={getLowScoreStatus(h.k)}
              teamColor={color}
              onChange={onCellChange}
              isPostMatch={isPostMatch}
            />
          </td>
        );
      })}
      {/* IN total */}
      <td className="py-1 bg-slate-50 font-bold text-slate-700 border-l-2 border-slate-200">
        {inTotal ?? "–"}
      </td>
      {/* TOTAL */}
      <td className="py-1 bg-slate-200 font-bold text-slate-900 text-base">
        {totalScore ?? "–"}
      </td>
    </tr>
  );
});
