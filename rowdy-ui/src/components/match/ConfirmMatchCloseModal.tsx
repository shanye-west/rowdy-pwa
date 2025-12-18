import { Modal, ModalActions } from "../Modal";
import { MatchStatusBadge } from "../MatchStatusBadge";
import type { TournamentDoc } from "../../types";

type ConfirmMatchCloseModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  winner: "teamA" | "teamB" | "AS" | null;
  margin: number;
  thru: number;
  teamAColor: string;
  teamBColor: string;
  tournament: TournamentDoc | null;
  teeTime: string | { _seconds: number } | undefined;
};

export function ConfirmMatchCloseModal({
  isOpen,
  onClose,
  onConfirm,
  winner,
  margin,
  thru,
  teamAColor,
  teamBColor,
  tournament,
  teeTime,
}: ConfirmMatchCloseModalProps) {
  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="End Match?"
      ariaLabel="Confirm match end"
    >
      {/* Match Score Tile - same format as scorecard */}
      <div 
        className="rounded-lg mb-4"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '12px 16px',
          backgroundColor: winner === "AS" 
            ? '#f1f5f9' 
            : winner === "teamA" 
              ? teamAColor 
              : teamBColor,
          border: winner === "AS" ? '2px solid #cbd5e1' : 'none'
        }}
      >
        <MatchStatusBadge
          status={{ closed: true, thru, margin }}
          result={{ winner }}
          teamAColor={teamAColor}
          teamBColor={teamBColor}
          teamAName={tournament?.teamA?.name}
          teamBName={tournament?.teamB?.name}
          teeTime={teeTime}
        />
      </div>

      <ModalActions
        primaryLabel="Confirm"
        onPrimary={onConfirm}
        secondaryLabel="Cancel"
        onSecondary={onClose}
      />
    </Modal>
  );
}
