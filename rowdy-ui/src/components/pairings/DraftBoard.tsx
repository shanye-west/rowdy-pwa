import DraftMatchCard from "./DraftMatchCard";
import type { PairingDraftDoc } from "../../types";
import type { PairingsMeta } from "./types";

export interface DraftBoardProps {
  draft: PairingDraftDoc;
  meta: PairingsMeta;
}

/**
 * The full match board, shared by the drafting / review / finalized states.
 * Shows a compact "n of total set" progress line above the match cards and
 * highlights whichever match is currently on the clock.
 */
export default function DraftBoard({ draft, meta }: DraftBoardProps) {
  const currentIndex = draft.turn?.matchIndex ?? -1;
  const setCount = draft.matches.filter(
    (m) => m.teamAPlayers?.length && m.teamBPlayers?.length
  ).length;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Matchups</span>
        <span className="text-xs font-medium text-muted-foreground">
          {setCount} of {draft.totalMatches} set
        </span>
      </div>
      {draft.matches.map((m, i) => (
        <DraftMatchCard key={m.matchNumber} match={m} meta={meta} isCurrent={i === currentIndex} />
      ))}
    </div>
  );
}
