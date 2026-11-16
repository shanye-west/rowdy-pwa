import { Hourglass } from "lucide-react";
import OfflineImage from "../OfflineImage";
import { snakeTeam } from "../../utils/teamDraft";
import type { TeamDraftDoc } from "../../types";
import type { TeamDraftMeta } from "./types";

export interface TeamDraftTurnHeaderProps {
  draft: TeamDraftDoc;
  meta: TeamDraftMeta;
  /** True when the viewer can pick for the team on the clock. */
  myMove: boolean;
}

/**
 * Team-colored "on the clock" banner (mirrors the pairings TurnHeader): pick
 * number, round, whose pick it is, and a segmented progress strip where each
 * segment is tinted by the team that owns that pick.
 */
export default function TeamDraftTurnHeader({ draft, meta, myMove }: TeamDraftTurnHeaderProps) {
  const turn = draft.turn!;
  const team = turn.team;
  const color = meta.teamColor(team);
  const logo = meta.teamLogo(team);
  const name = meta.teamName(team);
  const round = Math.floor(turn.pickIndex / 2) + 1;
  const rounds = Math.ceil(draft.totalPicks / 2);
  const last = draft.picks[draft.picks.length - 1];

  return (
    <div
      aria-live="polite"
      className="overflow-hidden rounded-2xl p-4 text-white shadow-sm"
      style={{ background: `linear-gradient(135deg, ${color}, color-mix(in srgb, ${color} 78%, black))` }}
    >
      <div className="flex items-center justify-between text-xs font-medium opacity-90">
        <span>
          Pick {turn.pickIndex + 1} of {draft.totalPicks}
        </span>
        <span className="uppercase tracking-wide">
          Round {round} of {rounds}
        </span>
      </div>

      <div className="mt-1.5 flex items-center gap-3">
        {logo && <OfflineImage src={logo} alt="" loading="lazy" style={{ width: 40, height: 40, objectFit: "contain" }} />}
        <div className="min-w-0">
          <div className="text-lg font-extrabold leading-tight">{name} on the clock</div>
          {myMove ? (
            <span className="mt-1 inline-flex items-center rounded-full bg-white/20 px-2.5 py-1 text-xs font-bold uppercase tracking-wide">
              Your pick — choose below
            </span>
          ) : (
            <span className="mt-1 inline-flex items-center gap-1.5 text-xs opacity-90">
              <Hourglass size={13} className="motion-safe:animate-pulse" /> Waiting for {name}…
            </span>
          )}
        </div>
      </div>

      {/* One segment per pick: solid = made, bright = on the clock, faint = to come. */}
      <div className="mt-3 flex gap-0.5">
        {Array.from({ length: draft.totalPicks }, (_, i) => {
          const owner = snakeTeam(draft.firstPickTeam, i);
          const state = i < turn.pickIndex ? "done" : i === turn.pickIndex ? "now" : "next";
          return (
            <span
              key={i}
              title={`Pick ${i + 1}: ${meta.teamName(owner)}`}
              className={
                "h-1.5 flex-1 rounded-full " +
                (state === "done" ? "bg-white/90" : state === "now" ? "bg-white/55 motion-safe:animate-pulse" : "bg-white/20")
              }
            />
          );
        })}
      </div>

      {last && (
        <div className="mt-2.5 truncate text-xs opacity-90">
          Last pick: <span className="font-bold">{meta.nameOf(last.playerId)}</span> → {meta.teamName(last.team)}
        </div>
      )}
    </div>
  );
}
