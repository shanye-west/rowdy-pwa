import { useEffect, useRef } from "react";
import { Modal } from "../Modal";
import TeamName from "../TeamName";
import type { TournamentDoc, MatchDoc } from "../../types";
import type { HoleData } from ".";

type DrivePickerModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (playerIdx: 0 | 1 | 2 | 3 | null) => void;
  hole: HoleData | null;
  team: "A" | "B" | null;
  match: MatchDoc;
  tournament: TournamentDoc | null;
  teamAColor: string;
  teamBColor: string;
  getPlayerName: (playerId: string | undefined) => string;
};

export function DrivePickerModal({
  isOpen,
  onClose,
  onSelect,
  hole,
  team,
  match,
  tournament,
  teamAColor,
  teamBColor,
  getPlayerName,
}: DrivePickerModalProps) {
  // Guard against a double-tap selecting twice before the modal dismisses.
  const busyRef = useRef(false);
  useEffect(() => {
    if (isOpen) busyRef.current = false;
  }, [isOpen]);

  if (!isOpen || !hole || !team) return null;

  const handleSelect = (playerIdx: 0 | 1 | 2 | 3 | null) => {
    if (busyRef.current) return;
    busyRef.current = true;
    onSelect(playerIdx);
  };

  const teamPlayers = team === "A" ? match.teamAPlayers : match.teamBPlayers;
  const numPlayers = teamPlayers?.length || 2;
  const color = team === "A" ? teamAColor : teamBColor;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Whose drive for Hole ${hole.num}?`}
      ariaLabel="Select drive player"
    >
      <div className="text-xs text-center text-muted-foreground mb-3 font-medium" style={{ color }}>
        {team === "A" ? (
          <TeamName name={tournament?.teamA?.name || "Team A"} variant="inline" style={{ color: teamAColor }} />
        ) : (
          <TeamName name={tournament?.teamB?.name || "Team B"} variant="inline" style={{ color: teamBColor }} />
        )}
      </div>
      <div className="space-y-2">
        {/* Player buttons (2 or 4 depending on format) */}
        {Array.from({ length: numPlayers }, (_, i) => {
          const playerId = teamPlayers?.[i]?.playerId;
          return (
            <button
              key={i}
              type="button"
              onClick={() => handleSelect(i as 0 | 1 | 2 | 3)}
              aria-label={`Select ${getPlayerName(playerId)}'s drive`}
              className="w-full py-3 px-4 rounded-lg text-white font-semibold text-base transition-transform active:scale-95"
              style={{ backgroundColor: color }}
            >
              {getPlayerName(playerId)}
            </button>
          );
        })}
        {/* Clear button */}
        <button
          type="button"
          onClick={() => handleSelect(null)}
          aria-label="Clear drive selection"
          className="w-full py-3 px-4 rounded-lg bg-muted text-muted-foreground font-semibold text-base transition-transform active:scale-95 hover:bg-muted"
        >
          Clear
        </button>
      </div>
      {/* Cancel */}
      <button
        type="button"
        onClick={onClose}
        className="w-full mt-4 py-2 text-sm text-muted-foreground hover:text-foreground"
      >
        Cancel
      </button>
    </Modal>
  );
}
