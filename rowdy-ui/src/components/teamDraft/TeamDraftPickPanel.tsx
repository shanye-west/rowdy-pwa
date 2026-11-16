import { useMemo } from "react";
import { RotateCcw } from "lucide-react";
import PlayerPickRow from "../pairings/PlayerPickRow";
import { cn } from "../../lib/utils";
import { tierStyle } from "../../utils/tierColors";
import { TEAM_DRAFT_TIERS, availablePlayerIds, pickBlockReason, tierCounts } from "../../utils/teamDraft";
import type { DraftTeamKey, TeamDraftDoc } from "../../types";
import type { PairingsMeta } from "../pairings/types";
import { formatHcp, type TeamDraftMeta } from "./types";

export interface TeamDraftPickPanelProps {
  draft: TeamDraftDoc;
  team: DraftTeamKey;
  meta: TeamDraftMeta;
  selected: string | null;
  busy: boolean;
  canUndo: boolean;
  onSelect: (pid: string | null) => void;
  onSubmit: () => void;
  onUndo: () => void;
}

/**
 * The on-the-clock captain's picker: players still on the board grouped by
 * tier (with "n of 2 filled" for this team), tiers the team has already filled
 * pre-disabled, and a sticky "Draft {name}" button (pairings PickPanel style).
 */
export default function TeamDraftPickPanel({
  draft,
  team,
  meta,
  selected,
  busy,
  canUndo,
  onSelect,
  onSubmit,
  onUndo,
}: TeamDraftPickPanelProps) {
  const teamColor = meta.teamColor(team);
  const counts = tierCounts(draft, team);
  const groups = useMemo(() => {
    const avail = availablePlayerIds(draft);
    return TEAM_DRAFT_TIERS.map((tier) => ({ tier, ids: avail.filter((id) => draft.tierByPlayer[id] === tier) })).filter(
      (g) => g.ids.length > 0
    );
  }, [draft]);

  // PlayerPickRow takes the pairings view-model; the handicap is passed as hcpText.
  const rowMeta = useMemo<PairingsMeta>(
    () => ({
      players: [],
      nameOf: meta.nameOf,
      chOf: () => null,
      tierOf: meta.tierOf,
      teamName: meta.teamName,
      teamColor: meta.teamColor,
      teamLogo: meta.teamLogo,
      grossOnly: false,
    }),
    [meta]
  );

  return (
    <div className="space-y-3">
      <div className="card space-y-3 p-4">
        <div className="text-sm font-bold" style={{ color: teamColor }}>
          {meta.teamName(team)} — make your pick
        </div>
        <p className="text-xs text-muted-foreground">
          Each team ends with {draft.perTeamPerTier} players from every tier. Once you've filled a tier, it's
          locked for you.
        </p>

        {groups.map(({ tier, ids }) => {
          const full = counts[tier] >= draft.perTeamPerTier;
          return (
            <div key={tier} className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className={cn("rounded px-1.5 py-0.5 text-[0.65rem] font-bold", tierStyle(tier).chip)}>
                  Tier {tier}
                </span>
                <span className="h-px flex-1 bg-border" />
                <span
                  className={cn(
                    "text-[0.65rem] font-semibold tabular-nums",
                    full ? "text-destructive" : "text-muted-foreground"
                  )}
                >
                  {full ? "Filled" : `${counts[tier]}/${draft.perTeamPerTier} filled`}
                </span>
              </div>
              {ids.map((pid) => {
                const reason = pickBlockReason(draft, team, pid) ?? undefined;
                const isSel = selected === pid;
                return (
                  <PlayerPickRow
                    key={pid}
                    pid={pid}
                    meta={rowMeta}
                    teamColor={teamColor}
                    selected={isSel}
                    disabled={!!reason}
                    disabledReason={reason}
                    hcpText={`HI ${formatHcp(meta.hcpOf(pid))}`}
                    onToggle={() => onSelect(isSel ? null : pid)}
                  />
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Outside the card: .card is overflow-hidden and would clip a sticky child. */}
      <div
        className="sticky z-10 flex gap-2 rounded-xl border border-border bg-card/95 p-2 shadow-lg backdrop-blur"
        style={{ bottom: "calc(var(--bottom-nav-height) + env(safe-area-inset-bottom, 0px) + 0.5rem)" }}
      >
        <button className="btn btn-primary min-w-0 flex-1 truncate" disabled={!selected || busy} onClick={onSubmit}>
          {busy ? "Drafting…" : selected ? `Draft ${meta.nameOf(selected)}` : "Select a player"}
        </button>
        {canUndo && (
          <button className="btn btn-secondary inline-flex items-center gap-1.5" disabled={busy} onClick={onUndo}>
            <RotateCcw size={15} /> Undo
          </button>
        )}
      </div>
    </div>
  );
}
