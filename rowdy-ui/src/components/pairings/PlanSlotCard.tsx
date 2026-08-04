import { AlertTriangle, Plus, X } from "lucide-react";
import PlayerAvatar from "../PlayerAvatar";
import { cn } from "../../lib/utils";
import { tierStyle } from "../../utils/tierColors";
import type { DraftTeamKey } from "../../types";
import type { PairingsMeta } from "./types";

export interface PlanSlotCardProps {
  /** 0-based slot index; displayed as "Matchup {index + 1}". */
  index: number;
  slot: string[];
  perSide: number;
  team: DraftTeamKey;
  meta: PairingsMeta;
  /** Highlighted as the slot the pool taps fill. */
  active: boolean;
  /** Tier-rule problem with this slot, if any. */
  violation: string | null;
  onActivate: () => void;
  onRemove: (pid: string) => void;
}

/**
 * One planned matchup on the captains' plan page: the players slotted in so far
 * (tap to pull one back out) plus empty placeholders. Tapping anywhere else on
 * the card makes it the active slot, so the pool below fills it.
 */
export default function PlanSlotCard({
  index,
  slot,
  perSide,
  team,
  meta,
  active,
  violation,
  onActivate,
  onRemove,
}: PlanSlotCardProps) {
  const color = meta.teamColor(team);
  const empties = Math.max(0, perSide - slot.length);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={active}
      onClick={onActivate}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onActivate();
        }
      }}
      className={cn(
        "rounded-xl border p-3 transition-all duration-150",
        violation
          ? "border-destructive/60 bg-destructive/5"
          : active
            ? "border-transparent ring-2"
            : "border-border bg-card hover:bg-muted/40"
      )}
      style={active && !violation ? { boxShadow: `0 0 0 2px ${color}` } : undefined}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[0.65rem] font-bold uppercase tracking-[0.2em] text-muted-foreground">
          Matchup {index + 1}
        </span>
        {active && (
          <span className="text-[0.65rem] font-bold uppercase tracking-wide" style={{ color }}>
            Filling
          </span>
        )}
      </div>

      <div className="space-y-1.5">
        {slot.map((pid) => {
          const tier = meta.tierOf(pid);
          const ch = meta.chOf(pid);
          return (
            <div key={pid} className="flex items-center gap-2 rounded-lg bg-muted/50 px-2 py-1.5">
              <PlayerAvatar name={meta.nameOf(pid)} playerId={pid} color={color} size={26} />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold" style={{ color }}>
                {meta.nameOf(pid)}
              </span>
              {tier && (
                <span className={cn("rounded px-1 text-[10px] font-bold", tierStyle(tier).chip)}>{tier}</span>
              )}
              {ch != null && <span className="text-[10px] font-medium text-muted-foreground">CH {ch}</span>}
              <button
                type="button"
                aria-label={`Remove ${meta.nameOf(pid)} from matchup ${index + 1}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(pid);
                }}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X size={14} />
              </button>
            </div>
          );
        })}

        {Array.from({ length: empties }).map((_, i) => (
          <div
            key={`empty-${i}`}
            className="flex items-center gap-2 rounded-lg border border-dashed border-border px-2 py-1.5 text-sm text-muted-foreground"
          >
            <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full border border-dashed border-border">
              <Plus size={13} />
            </span>
            Pick a player
          </div>
        ))}
      </div>

      {violation && (
        <div className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-destructive">
          <AlertTriangle size={13} className="shrink-0" /> {violation}
        </div>
      )}
    </div>
  );
}
