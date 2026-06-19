import { cn } from "../../lib/utils";
import type { DraftTeamKey, PairingDraftDoc } from "../../types";
import type { PairingsMeta } from "./types";

export interface TurnHeaderProps {
  draft: PairingDraftDoc;
  actingTeam: DraftTeamKey;
  meta: PairingsMeta;
  isResponse: boolean;
  /** True when the current viewer can act for the acting team. */
  myMove: boolean;
}

/**
 * The team-colored banner at the top of the drafting view: which match, who's
 * up, and whether it's the viewer's move. `aria-live` announces turn changes to
 * screen readers as the draft advances.
 */
export default function TurnHeader({ draft, actingTeam, meta, isResponse, myMove }: TurnHeaderProps) {
  const turn = draft.turn!;
  const color = meta.teamColor(actingTeam);
  const pct = Math.round((turn.matchIndex / draft.totalMatches) * 100);

  return (
    <div
      aria-live="polite"
      className="overflow-hidden rounded-2xl p-4 text-white shadow-sm"
      style={{ background: `linear-gradient(135deg, ${color}, color-mix(in srgb, ${color} 78%, black))` }}
    >
      <div className="flex items-center justify-between text-xs font-medium opacity-90">
        <span>
          Match {turn.matchIndex + 1} of {draft.totalMatches}
        </span>
        <span className="uppercase tracking-wide">{isResponse ? "Response" : "Nomination"}</span>
      </div>
      <div className="mt-1 text-lg font-extrabold leading-tight">
        {meta.teamName(actingTeam)} to {isResponse ? "respond" : "nominate"}
        {myMove && <span className="ml-1 opacity-90">— your move</span>}
      </div>
      {!myMove && (
        <div className="text-xs opacity-90">Waiting for {meta.teamName(actingTeam)}…</div>
      )}
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/25">
        <div
          className={cn("h-full rounded-full bg-card/90 transition-all duration-500")}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
