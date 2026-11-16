import OfflineImage from "../OfflineImage";
import PlayerAvatar from "../PlayerAvatar";
import { cn } from "../../lib/utils";
import { tierStyle } from "../../utils/tierColors";
import { TEAM_DRAFT_TIERS, realPicks, teamPlayerIds } from "../../utils/teamDraft";
import type { DraftTeamKey, TeamDraftDoc } from "../../types";
import { formatHcp, type TeamDraftMeta } from "./types";

export interface TeamDraftBoardProps {
  draft: TeamDraftDoc;
  meta: TeamDraftMeta;
}

const TEAMS: DraftTeamKey[] = ["teamA", "teamB"];

/**
 * Side-by-side rosters as they fill: one row per tier, `perTeamPerTier` slots
 * per team per tier. Captains carry a "C", drafted players their pick number,
 * auto placements (the other team filled the tier) an "Auto" tag, open slots a
 * dashed placeholder — so it's obvious which tiers each captain
 * still has to fill.
 */
export default function TeamDraftBoard({ draft, meta }: TeamDraftBoardProps) {
  const pickNo = new Map(realPicks(draft).map((p, i) => [p.playerId, i + 1]));
  const autoIds = new Set(draft.picks.filter((p) => p.auto).map((p) => p.playerId));
  const keepers = new Set([...draft.keepers.teamA, ...draft.keepers.teamB]);

  const byTier = (team: DraftTeamKey) => {
    const out: Record<string, string[]> = { A: [], B: [], C: [], D: [] };
    for (const pid of teamPlayerIds(draft, team)) {
      const t = draft.tierByPlayer[pid];
      if (t) out[t].push(pid);
    }
    return out;
  };
  const rosters = { teamA: byTier("teamA"), teamB: byTier("teamB") };

  return (
    <div className="card overflow-hidden p-0">
      <div className="grid grid-cols-2 border-b border-border">
        {TEAMS.map((team) => (
          <div
            key={team}
            className="flex min-w-0 items-center gap-2 px-3 py-2.5"
            style={{ background: `color-mix(in srgb, ${meta.teamColor(team)} 10%, transparent)` }}
          >
            {meta.teamLogo(team) && (
              <OfflineImage src={meta.teamLogo(team)} alt="" style={{ width: 24, height: 24, objectFit: "contain" }} />
            )}
            <span className="truncate text-xs font-extrabold" style={{ color: meta.teamColor(team) }}>
              {meta.teamName(team)}
            </span>
          </div>
        ))}
      </div>

      {TEAM_DRAFT_TIERS.map((tier) => (
        <div key={tier} className="border-b border-border last:border-b-0">
          <div className="flex items-center gap-2 bg-muted/60 px-3 py-1">
            <span className={cn("rounded px-1.5 py-0.5 text-[0.6rem] font-bold", tierStyle(tier).chip)}>Tier {tier}</span>
          </div>
          <div className="grid grid-cols-2 divide-x divide-border">
            {TEAMS.map((team) => {
              const ids = rosters[team][tier];
              const slots = Array.from({ length: draft.perTeamPerTier }, (_, i) => ids[i] ?? null);
              return (
                <div key={team} className="space-y-1 p-1.5">
                  {slots.map((pid, i) =>
                    pid ? (
                      <div key={pid} className="flex min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-1">
                        <PlayerAvatar name={meta.nameOf(pid)} playerId={pid} color={meta.teamColor(team)} size={24} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-semibold text-foreground">{meta.nameOf(pid)}</div>
                          <div className="text-[0.65rem] tabular-nums text-muted-foreground">
                            {formatHcp(meta.hcpOf(pid))}
                          </div>
                        </div>
                        {autoIds.has(pid) ? (
                          <span
                            className="shrink-0 rounded border px-1 text-[0.6rem] font-bold"
                            style={{ borderColor: meta.teamColor(team), color: meta.teamColor(team) }}
                            title="Placed automatically — the other team filled this tier"
                          >
                            Auto
                          </span>
                        ) : (
                          <span
                            className="shrink-0 rounded px-1 text-[0.6rem] font-bold tabular-nums text-white"
                            style={{ background: meta.teamColor(team) }}
                            title={keepers.has(pid) ? "Captain" : `Pick ${pickNo.get(pid)}`}
                          >
                            {keepers.has(pid) ? "C" : `#${pickNo.get(pid)}`}
                          </span>
                        )}
                      </div>
                    ) : (
                      <div
                        key={`open-${i}`}
                        className="flex h-[38px] items-center justify-center rounded-lg border border-dashed border-border text-[0.65rem] text-muted-foreground"
                      >
                        Open
                      </div>
                    )
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
