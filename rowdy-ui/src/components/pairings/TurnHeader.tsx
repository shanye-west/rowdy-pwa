import { Hourglass } from "lucide-react";
import OfflineImage from "../OfflineImage";
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
  const logo = meta.teamLogo(actingTeam);
  const teamName = meta.teamName(actingTeam);

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

      <div className="mt-1.5 flex items-center gap-3">
        {logo && (
          <OfflineImage
            src={logo}
            alt=""
            loading="lazy"
            style={{ width: 40, height: 40, objectFit: "contain" }}
          />
        )}
        <div className="min-w-0">
          <div className="text-lg font-extrabold leading-tight">
            {teamName} to {isResponse ? "respond" : "nominate"}
          </div>
          {myMove ? (
            <span className="mt-1 inline-flex items-center rounded-full bg-white/20 px-2.5 py-1 text-xs font-bold uppercase tracking-wide">
              Your move — pick below
            </span>
          ) : (
            <span className="mt-1 inline-flex items-center gap-1.5 text-xs opacity-90">
              <Hourglass size={13} className="motion-safe:animate-pulse" /> Waiting for {teamName}…
            </span>
          )}
        </div>
      </div>

      {/* One segment per match: filled = done, half = on the clock, faint = upcoming. */}
      <div className="mt-3 flex gap-1">
        {Array.from({ length: draft.totalMatches }, (_, i) => (
          <span
            key={i}
            className={
              "h-1.5 flex-1 rounded-full transition-colors " +
              (i < turn.matchIndex ? "bg-white/90" : i === turn.matchIndex ? "bg-white/50" : "bg-white/25")
            }
          />
        ))}
      </div>
    </div>
  );
}
