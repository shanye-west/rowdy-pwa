import { memo } from "react";
import type { HoleData } from "./PlayerScoreRow";

/** Props for DriveSelectorsSection */
export interface DriveSelectorsSectionProps {
  holes: HoleData[];
  teamAColor: string;
  teamBColor: string;
  teamAName: string;
  teamBName: string;
  teamAPlayers: Array<{ playerId?: string }>;
  teamBPlayers: Array<{ playerId?: string }>;
  cellWidth: number;
  totalColWidth: number;
  isMatchClosed: boolean;
  isHoleLocked: (holeNum: number) => boolean;
  getDriveValue: (hole: HoleData, team: "A" | "B") => 0 | 1 | 2 | 3 | null;
  getPlayerInitials: (playerId?: string) => string;
  onDriveClick: (hole: HoleData, team: "A" | "B") => void;
  /** 0-indexed hole where match closed (null if went to 18) */
  closingHole?: number | null;
}

/** Props for a single drive row */
interface DriveRowProps {
  team: "A" | "B";
  teamName: string;
  teamColor: string;
  teamPlayers: Array<{ playerId?: string }>;
  holes: HoleData[];
  cellWidth: number;
  totalColWidth: number;
  isMatchClosed: boolean;
  isHoleLocked: (holeNum: number) => boolean;
  getDriveValue: (hole: HoleData, team: "A" | "B") => 0 | 1 | 2 | 3 | null;
  getPlayerInitials: (playerId?: string) => string;
  onDriveClick: (hole: HoleData, team: "A" | "B") => void;
  closingHole?: number | null;
}

/** Single drive row for a team */
const DriveRow = memo(function DriveRow({
  team,
  teamName,
  teamColor,
  teamPlayers,
  holes,
  cellWidth,
  totalColWidth,
  isMatchClosed,
  isHoleLocked,
  getDriveValue,
  getPlayerInitials,
  onDriveClick,
  closingHole,
}: DriveRowProps) {
  const renderDriveButton = (hole: HoleData, options?: { isFirstBack9?: boolean; isPostMatch?: boolean }) => {
    const { isFirstBack9, isPostMatch } = options || {};
    const locked = isHoleLocked(hole.num);
    const currentDrive = getDriveValue(hole, team);
    // Support 2-player (twoManScramble) and 4-player (fourManScramble) teams
    const initials = currentDrive != null && currentDrive >= 0 && currentDrive < teamPlayers.length
      ? getPlayerInitials(teamPlayers[currentDrive]?.playerId)
      : null;
    
    // Build class and style
    let cellClass = "p-0.5";
    if (isFirstBack9) cellClass += " border-l-2 border-slate-200";
    if (isPostMatch) cellClass += " bg-slate-100/50";
    
    return (
      <td 
        key={`drive${team}-${hole.k}`} 
        className={cellClass}
        style={{ 
          width: cellWidth, 
          minWidth: cellWidth,
        }}
      >
        <button
          type="button"
          disabled={locked || isMatchClosed}
          onClick={() => onDriveClick(hole, team)}
          className={`
            w-10 h-7 text-xs font-bold rounded border transition-colors
            ${locked || isMatchClosed
              ? "bg-slate-50 text-slate-600 border-slate-200 cursor-default"
              : initials
                ? "text-white border-transparent"
                : "bg-white border-slate-300 text-slate-400 hover:border-slate-400 hover:bg-slate-50"
            }
          `}
          style={initials && !locked ? { backgroundColor: teamColor } : {}}
        >
          {initials || "–"}
        </button>
      </td>
    );
  };

  return (
    <tr style={{ backgroundColor: teamColor + "15" }}>
      <td 
        className="sticky left-0 z-10 text-left px-3 py-1.5 font-semibold whitespace-nowrap text-xs"
        style={{ backgroundColor: teamColor + "15", color: teamColor }}
      >
        {teamName} Drive
      </td>
      {/* Front 9 */}
      {holes.slice(0, 9).map(h => renderDriveButton(h))}
      {/* OUT spacer */}
      <td className="bg-slate-100 border-l-2 border-slate-200" style={{ width: totalColWidth, minWidth: totalColWidth }}></td>
      {/* Back 9 - post-match cells have border and tint */}
      {holes.slice(9, 18).map((h, i) => {
        const holeIdx = 9 + i;
        const isPostMatch = closingHole != null && holeIdx > closingHole;
        return renderDriveButton(h, { 
          isFirstBack9: i === 0, 
          isPostMatch, 
        });
      })}
      {/* IN spacer */}
      <td className="bg-slate-100 border-l-2 border-slate-200" style={{ width: totalColWidth, minWidth: totalColWidth }}></td>
      {/* TOT spacer */}
      <td className="bg-slate-200" style={{ width: totalColWidth, minWidth: totalColWidth }}></td>
    </tr>
  );
});

/**
 * Drive selector rows for scramble/shamble formats
 * Renders Team A and Team B drive selection rows inside the scorecard table
 */
export const DriveSelectorsSection = memo(function DriveSelectorsSection({
  holes,
  teamAColor,
  teamBColor,
  teamAName,
  teamBName,
  teamAPlayers,
  teamBPlayers,
  cellWidth,
  totalColWidth,
  isMatchClosed,
  isHoleLocked,
  getDriveValue,
  getPlayerInitials,
  onDriveClick,
  closingHole,
}: DriveSelectorsSectionProps) {
  return (
    <>
      <DriveRow
        team="A"
        teamName={teamAName}
        teamColor={teamAColor}
        teamPlayers={teamAPlayers}
        holes={holes}
        cellWidth={cellWidth}
        totalColWidth={totalColWidth}
        isMatchClosed={isMatchClosed}
        isHoleLocked={isHoleLocked}
        getDriveValue={getDriveValue}
        getPlayerInitials={getPlayerInitials}
        onDriveClick={onDriveClick}
        closingHole={closingHole}
      />
      <DriveRow
        team="B"
        teamName={teamBName}
        teamColor={teamBColor}
        teamPlayers={teamBPlayers}
        holes={holes}
        cellWidth={cellWidth}
        totalColWidth={totalColWidth}
        isMatchClosed={isMatchClosed}
        isHoleLocked={isHoleLocked}
        getDriveValue={getDriveValue}
        getPlayerInitials={getPlayerInitials}
        onDriveClick={onDriveClick}
        closingHole={closingHole}
      />
    </>
  );
});
