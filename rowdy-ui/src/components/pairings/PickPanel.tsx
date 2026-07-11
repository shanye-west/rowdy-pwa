import { useMemo } from "react";
import { RotateCcw } from "lucide-react";
import PlayerPickRow from "./PlayerPickRow";
import DraftPlayerPill from "./DraftPlayerPill";
import { cn } from "../../lib/utils";
import { tierStyle, TIER_ORDER } from "../../utils/tierColors";
import { remainingPlayerIds, wouldViolateTier, wouldStrandTeam, otherTeam } from "../../utils/pairingDraft";
import type { DraftTeamKey, PairingDraftDoc } from "../../types";
import type { PairingsMeta } from "./types";

export interface PickPanelProps {
  draft: PairingDraftDoc;
  actingTeam: DraftTeamKey;
  meta: PairingsMeta;
  isResponse: boolean;
  /** Opponent players this team is responding to (response turns only). */
  nominatedIds: string[] | null;
  selected: string[];
  busy: boolean;
  canUndo: boolean;
  onToggleSelect: (pid: string) => void;
  onSubmit: () => void;
  onUndo: () => void;
}

/**
 * The acting team's pick panel: who they're facing (on a response), the players
 * left to choose grouped by tier with big tap targets, and the nominate/confirm
 * + undo actions. Tier-rule clashes and the pick limit are pre-disabled so an
 * illegal pick can't be submitted.
 */
export default function PickPanel({
  draft,
  actingTeam,
  meta,
  isResponse,
  nominatedIds,
  selected,
  busy,
  canUndo,
  onToggleSelect,
  onSubmit,
  onUndo,
}: PickPanelProps) {
  const perSide = draft.playersPerSide;
  const teamColor = meta.teamColor(actingTeam);
  const remaining = useMemo(() => remainingPlayerIds(draft, actingTeam), [draft, actingTeam]);

  // Group remaining players by tier (A→D, unknown tiers last).
  const groups = useMemo(() => {
    const byTier = new Map<string, string[]>();
    for (const pid of remaining) {
      const t = meta.tierOf(pid) ?? "—";
      if (!byTier.has(t)) byTier.set(t, []);
      byTier.get(t)!.push(pid);
    }
    const ordered: { tier: string; ids: string[] }[] = [];
    for (const t of TIER_ORDER) if (byTier.has(t)) ordered.push({ tier: t, ids: byTier.get(t)! });
    if (byTier.has("—")) ordered.push({ tier: "—", ids: byTier.get("—")! });
    return ordered;
  }, [remaining, meta]);

  const full = selected.length >= perSide;
  const canSubmit = selected.length === perSide && !busy;

  return (
    <div className="space-y-3">
      <div className="card p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-bold" style={{ color: teamColor }}>
            {isResponse
              ? `${meta.teamName(actingTeam)} — choose your matchup`
              : `${meta.teamName(actingTeam)} — nominate`}
          </div>
          <span className="shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">
            {selected.length}/{perSide} selected
          </span>
        </div>

        {isResponse && nominatedIds && nominatedIds.length > 0 && (
          <div className="rounded-xl border border-border bg-muted/40 p-2.5">
            <div className="mb-1.5 text-[0.65rem] font-bold uppercase tracking-wide text-muted-foreground">
              You're facing
            </div>
            <div className="space-y-1">
              {nominatedIds.map((pid) => (
                <DraftPlayerPill key={pid} pid={pid} team={otherTeam(actingTeam)} meta={meta} />
              ))}
            </div>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Pick {perSide} player{perSide > 1 ? "s" : ""}.
          {perSide === 2 && " No two A-tier and no two D-tier together."}
          {meta.grossOnly && " Course handicaps are shown for reference only (gross play)."}
        </p>

        {remaining.length === 0 ? (
          <p className="text-sm text-muted-foreground">No players left to pick.</p>
        ) : (
          <div className="space-y-3">
            {groups.map(({ tier, ids }) => (
              <div key={tier} className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className={cn("rounded px-1.5 py-0.5 text-[0.65rem] font-bold", tierStyle(tier).chip)}>
                    {tier === "—" ? "No tier" : `Tier ${tier}`}
                  </span>
                  <span className="h-px flex-1 bg-border" />
                </div>
                {ids.map((pid) => {
                  const isSel = selected.includes(pid);
                  let disabledReason: string | undefined;
                  if (!isSel && full) disabledReason = "Pick limit reached — deselect first";
                  else if (!isSel && perSide === 2) {
                    disabledReason = wouldViolateTier(selected, pid, draft.tierByPlayer) ?? undefined;
                    // When this would complete the pair, also make sure what's left
                    // can still be paired legally (mirrors the server look-ahead).
                    if (!disabledReason && selected.length === perSide - 1) {
                      disabledReason = wouldStrandTeam(draft, actingTeam, [...selected, pid]) ?? undefined;
                    }
                  }
                  return (
                    <PlayerPickRow
                      key={pid}
                      pid={pid}
                      meta={meta}
                      teamColor={teamColor}
                      selected={isSel}
                      disabled={!!disabledReason}
                      disabledReason={disabledReason}
                      onToggle={() => onToggleSelect(pid)}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Actions live outside the card: `.card` is overflow-hidden, which would
          clip a sticky descendant. Docked above the bottom nav on long lists. */}
      <div
        className="sticky z-10 flex gap-2 rounded-xl border border-border bg-card/95 p-2 shadow-lg backdrop-blur"
        style={{ bottom: "calc(var(--bottom-nav-height) + env(safe-area-inset-bottom, 0px) + 0.5rem)" }}
      >
        <button className="btn btn-primary flex-1" disabled={!canSubmit} onClick={onSubmit}>
          {busy ? "Submitting…" : isResponse ? "Confirm matchup" : `Nominate ${selected.length}/${perSide}`}
        </button>
        {canUndo && (
          <button
            className="btn btn-secondary inline-flex items-center gap-1.5"
            disabled={busy}
            onClick={onUndo}
          >
            <RotateCcw size={15} /> Undo
          </button>
        )}
      </div>
    </div>
  );
}
