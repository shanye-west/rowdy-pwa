import { useEffect, useState } from "react";
import { Modal, ModalActions } from "../Modal";
import { MatchStatusBadge } from "../MatchStatusBadge";
import type { FirestoreTimestampLike, TournamentDoc } from "../../types";

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
  teeTime?: FirestoreTimestampLike;
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
  // Guard against a double-tap firing the (async) close twice before the modal
  // dismisses. Reset whenever the modal reopens for a new hole.
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    if (isOpen) setSubmitting(false);
  }, [isOpen]);

  if (!isOpen) return null;

  const handlePrimary = () => {
    if (submitting) return;
    setSubmitting(true);
    onConfirm();
  };

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
        onPrimary={handlePrimary}
        primaryDisabled={submitting}
        secondaryLabel="Cancel"
        onSecondary={onClose}
      />
    </Modal>
  );
}
