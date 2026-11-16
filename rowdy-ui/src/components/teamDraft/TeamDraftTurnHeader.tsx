import { Hourglass } from "lucide-react";
import OfflineImage from "../OfflineImage";
import { availablePlayerIds } from "../../utils/teamDraft";
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
 * number, players left, whose pick it is, and a progress strip with one segment
 * per draftable player. Auto placements (the rest of a tier going to the other
 * team) cost no pick, so the strip tracks players placed, not picks.
 */
export default function TeamDraftTurnHeader({ draft, meta, myMove }: TeamDraftTurnHeaderProps) {
  const turn = draft.turn!;
  const team = turn.team;
  const color = meta.teamColor(team);
  const logo = meta.teamLogo(team);
  const name = meta.teamName(team);
  const left = availablePlayerIds(draft).length;
  const total = draft.picks.length + left;

  // The most recent real pick plus whatever it auto-placed.
  let lastReal = draft.picks.length - 1;
  while (lastReal >= 0 && draft.picks[lastReal].auto) lastReal--;
  const last = lastReal >= 0 ? draft.picks[lastReal] : null;
  const autos = lastReal >= 0 ? draft.picks.slice(lastReal + 1) : [];

  return (
    <div
      aria-live="polite"
      className="overflow-hidden rounded-2xl p-4 text-white shadow-sm"
      style={{ background: `linear-gradient(135deg, ${color}, color-mix(in srgb, ${color} 78%, black))` }}
    >
      <div className="flex items-center justify-between text-xs font-medium opacity-90">
        <span>Pick {turn.pickIndex + 1}</span>
        <span className="uppercase tracking-wide">
          {left} left on the board
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

      {/* One segment per draftable player: solid = placed, faint = still on the board. */}
      <div className="mt-3 flex gap-0.5">
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={
              "h-1.5 flex-1 rounded-full " +
              (i < draft.picks.length ? "bg-white/90" : i === draft.picks.length ? "bg-white/55 motion-safe:animate-pulse" : "bg-white/20")
            }
          />
        ))}
      </div>

      {last && (
        <div className="mt-2.5 space-y-0.5 text-xs opacity-90">
          <div className="truncate">
            Last pick: <span className="font-bold">{meta.nameOf(last.playerId)}</span> → {meta.teamName(last.team)}
          </div>
          {autos.length > 0 && (
            <div>
              Tier filled — {autos.map((p) => meta.nameOf(p.playerId)).join(" & ")} auto to{" "}
              {meta.teamName(autos[0].team)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
