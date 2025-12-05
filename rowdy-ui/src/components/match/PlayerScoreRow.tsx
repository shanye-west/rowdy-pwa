import { memo } from "react";
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
  team: "A" | "B";
  pIdx: number;
  label: string;
  color: string;
  holes: HoleData[];
  isLastOfTeam: boolean;
  isTeamB?: boolean; // For different bottom border style
  trackDrives: boolean;
  getCellValue: (holeKey: string) => number | "";
  isHoleLocked: (holeNum: number) => boolean;
  hasStroke: (holeIdx: number) => boolean;
  getDriveValue: (holeKey: string) => 0 | 1 | null;
  getLowScoreStatus: (holeKey: string) => 'solo' | 'tied' | null;
  onCellChange: (holeKey: string, value: number | null) => void;
  outTotal: number | null;
  inTotal: number | null;
  totalScore: number | null;
}

/** Memoized player score row - renders 18 ScoreInputCells + totals */
export const PlayerScoreRow = memo(function PlayerScoreRow({
  team,
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
      {holes.slice(0, 9).map(h => (
        <td key={h.k} className="p-0.5">
          <ScoreInputCell
            holeKey={h.k}
            holeNum={h.num}
            value={getCellValue(h.k)}
            par={h.par}
            locked={isHoleLocked(h.num)}
            hasStroke={hasStroke(h.num - 1)}
            hasDrive={trackDrives && getDriveValue(h.k) === pIdx}
            lowScoreStatus={getLowScoreStatus(h.k)}
            teamColor={team}
            onChange={onCellChange}
          />
        </td>
      ))}
      {/* OUT total */}
      <td className="py-1 bg-slate-50 font-bold text-slate-700 border-l-2 border-slate-200">
        {outTotal ?? "–"}
      </td>
      {/* Back 9 holes */}
      {holes.slice(9, 18).map((h, i) => (
        <td key={h.k} className={`p-0.5 ${i === 0 ? "border-l-2 border-slate-200" : ""}`}>
          <ScoreInputCell
            holeKey={h.k}
            holeNum={h.num}
            value={getCellValue(h.k)}
            par={h.par}
            locked={isHoleLocked(h.num)}
            hasStroke={hasStroke(h.num - 1)}
            hasDrive={trackDrives && getDriveValue(h.k) === pIdx}
            lowScoreStatus={getLowScoreStatus(h.k)}
            teamColor={team}
            onChange={onCellChange}
          />
        </td>
      ))}
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
