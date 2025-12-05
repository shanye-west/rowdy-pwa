import { memo } from "react";
import { MIN_DRIVES_PER_ROUND } from "../../constants";

/** Props for DrivesTrackerBanner */
export interface DrivesTrackerBannerProps {
  teamAColor: string;
  teamBColor: string;
  teamAName: string;
  teamBName: string;
  teamAPlayers: Array<{ playerId?: string }>;
  teamBPlayers: Array<{ playerId?: string }>;
  drivesUsed: { teamA: number[]; teamB: number[] };
  drivesNeeded: { teamA: number[]; teamB: number[] };
  getPlayerShortName: (playerId?: string) => string;
}

/** Player drive status display */
interface PlayerDriveStatusProps {
  playerName: string;
  drivesUsed: number;
  drivesNeeded: number;
}

function PlayerDriveStatus({ playerName, drivesUsed, drivesNeeded }: PlayerDriveStatusProps) {
  return (
    <div>
      <span className="text-slate-500">{playerName}:</span>{" "}
      <span className={`font-bold ${drivesNeeded > 0 ? "text-red-500" : "text-green-600"}`}>
        {drivesUsed}/{MIN_DRIVES_PER_ROUND}
      </span>
      {drivesNeeded > 0 && (
        <span className="text-red-500 text-xs ml-1">⚠️ Need {drivesNeeded}</span>
      )}
    </div>
  );
}

/**
 * Drives Tracker Banner - shows drive usage and requirements for scramble/shamble formats
 * Displayed above the scorecard when match is in progress
 */
export const DrivesTrackerBanner = memo(function DrivesTrackerBanner({
  teamAColor,
  teamBColor,
  teamAName,
  teamBName,
  teamAPlayers,
  teamBPlayers,
  drivesUsed,
  drivesNeeded,
  getPlayerShortName,
}: DrivesTrackerBannerProps) {
  return (
    <div className="card p-3 space-y-2">
      <div className="text-xs font-bold uppercase text-slate-500">Drives Tracker</div>
      <div className="grid grid-cols-2 gap-4 text-sm">
        {/* Team A */}
        <div>
          <div className="font-semibold" style={{ color: teamAColor }}>{teamAName}</div>
          <div className="flex flex-col gap-1 mt-1">
            <PlayerDriveStatus
              playerName={getPlayerShortName(teamAPlayers[0]?.playerId)}
              drivesUsed={drivesUsed.teamA[0]}
              drivesNeeded={drivesNeeded.teamA[0]}
            />
            <PlayerDriveStatus
              playerName={getPlayerShortName(teamAPlayers[1]?.playerId)}
              drivesUsed={drivesUsed.teamA[1]}
              drivesNeeded={drivesNeeded.teamA[1]}
            />
          </div>
        </div>
        {/* Team B */}
        <div>
          <div className="font-semibold" style={{ color: teamBColor }}>{teamBName}</div>
          <div className="flex flex-col gap-1 mt-1">
            <PlayerDriveStatus
              playerName={getPlayerShortName(teamBPlayers[0]?.playerId)}
              drivesUsed={drivesUsed.teamB[0]}
              drivesNeeded={drivesNeeded.teamB[0]}
            />
            <PlayerDriveStatus
              playerName={getPlayerShortName(teamBPlayers[1]?.playerId)}
              drivesUsed={drivesUsed.teamB[1]}
              drivesNeeded={drivesNeeded.teamB[1]}
            />
          </div>
        </div>
      </div>
    </div>
  );
});
