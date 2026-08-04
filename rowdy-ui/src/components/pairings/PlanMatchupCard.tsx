import { AlertTriangle, Plus, X } from "lucide-react";
import PlayerAvatar from "../PlayerAvatar";
import { cn } from "../../lib/utils";
import { tierStyle } from "../../utils/tierColors";
import type { DraftTeamKey, PlannedMatchup } from "../../types";
import type { PairingsMeta } from "./types";

export interface PlanMatchupCardProps {
  /** 0-based index; displayed as "Matchup {index + 1}". */
  index: number;
  matchup: PlannedMatchup;
  perSide: number;
  meta: PairingsMeta;
  /** Which side of THIS card the pool is filling, if any. */
  activeSide: DraftTeamKey | null;
  /** The viewer's own team, emphasized as "you" — null for an admin. */
  myTeam: DraftTeamKey | null;
  violations: Record<DraftTeamKey, string | null>;
  onActivate: (team: DraftTeamKey) => void;
  onRemove: (team: DraftTeamKey, pid: string) => void;
}

function Side({
  ids,
  team,
  perSide,
  meta,
  active,
  violation,
  alignRight,
  onActivate,
  onRemove,
}: {
  ids: string[];
  team: DraftTeamKey;
  perSide: number;
  meta: PairingsMeta;
  active: boolean;
  violation: string | null;
  alignRight?: boolean;
  onActivate: () => void;
  onRemove: (pid: string) => void;
}) {
  const color = meta.teamColor(team);
  const empties = Math.max(0, perSide - ids.length);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={active}
      aria-label={`Fill ${meta.teamName(team)}'s side`}
      onClick={onActivate}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onActivate();
        }
      }}
      className={cn(
        "min-w-0 space-y-1 rounded-lg border p-1.5 transition-all duration-150",
        violation
          ? "border-destructive/60 bg-destructive/5"
          : active
            ? "border-transparent"
            : "border-transparent hover:bg-muted/50"
      )}
      style={active && !violation ? { boxShadow: `0 0 0 2px ${color}` } : undefined}
    >
      {ids.map((pid) => {
        const tier = meta.tierOf(pid);
        const ch = meta.chOf(pid);
        return (
          <div
            key={pid}
            className={cn("flex items-center gap-1.5", alignRight && "flex-row-reverse")}
          >
            <PlayerAvatar name={meta.nameOf(pid)} playerId={pid} color={color} size={24} />
            <div className={cn("min-w-0 flex-1", alignRight && "text-right")}>
              <div className="truncate text-[13px] font-semibold leading-tight" style={{ color }}>
                {meta.nameOf(pid)}
              </div>
              <div className={cn("mt-0.5 flex items-center gap-1", alignRight && "justify-end")}>
                {tier && (
                  <span className={cn("rounded px-1 text-[10px] font-bold", tierStyle(tier).chip)}>{tier}</span>
                )}
                {ch != null && <span className="text-[10px] font-medium text-muted-foreground">CH {ch}</span>}
              </div>
            </div>
            <button
              type="button"
              aria-label={`Remove ${meta.nameOf(pid)}`}
              onClick={(e) => {
                e.stopPropagation();
                onRemove(pid);
              }}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X size={12} />
            </button>
          </div>
        );
      })}

      {Array.from({ length: empties }).map((_, i) => (
        <div
          key={`empty-${i}`}
          className={cn(
            "flex items-center gap-1.5 rounded-md border border-dashed border-border px-1.5 py-1 text-[11px] font-medium text-muted-foreground",
            alignRight && "flex-row-reverse"
          )}
        >
          <Plus size={11} className="shrink-0" />
          {active ? "Tap a player below" : "Empty"}
        </div>
      ))}
    </div>
  );
}

/**
 * One matchup on the personal plan board: your side, "vs", and the side you
 * think you'll be facing. Either half can be tapped to make it the one the pool
 * fills — planning the opponent's pairs is half the point of the exercise.
 */
export default function PlanMatchupCard({
  index,
  matchup,
  perSide,
  meta,
  activeSide,
  myTeam,
  violations,
  onActivate,
  onRemove,
}: PlanMatchupCardProps) {
  const bothSet = matchup.teamA.length === perSide && matchup.teamB.length === perSide;
  const violation = violations.teamA ?? violations.teamB;

  return (
    <div
      className={cn(
        "rounded-xl border bg-card/80 p-2.5 transition-all duration-200",
        activeSide ? "border-[hsl(var(--primary))]" : bothSet ? "border-border" : "border-border/60"
      )}
    >
      <div className="mb-1.5 flex items-center justify-between px-0.5">
        <span className="text-[0.65rem] font-bold uppercase tracking-[0.2em] text-muted-foreground">
          Matchup {index + 1}
        </span>
        {violation ? (
          <span className="flex items-center gap-1 text-[11px] font-semibold text-destructive">
            <AlertTriangle size={11} className="shrink-0" /> {violation}
          </span>
        ) : (
          bothSet && (
            <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600">Set</span>
          )
        )}
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1">
        <Side
          ids={matchup.teamA}
          team="teamA"
          perSide={perSide}
          meta={meta}
          active={activeSide === "teamA"}
          violation={violations.teamA}
          onActivate={() => onActivate("teamA")}
          onRemove={(pid) => onRemove("teamA", pid)}
        />
        <span className="px-0.5 text-[10px] font-bold uppercase text-muted-foreground/70">vs</span>
        <Side
          ids={matchup.teamB}
          team="teamB"
          perSide={perSide}
          meta={meta}
          active={activeSide === "teamB"}
          violation={violations.teamB}
          alignRight
          onActivate={() => onActivate("teamB")}
          onRemove={(pid) => onRemove("teamB", pid)}
        />
      </div>

      {myTeam && (
        <div className="mt-1 grid grid-cols-[1fr_auto_1fr] gap-1 px-1.5 text-[9px] font-bold uppercase tracking-wide text-muted-foreground/70">
          <span>{myTeam === "teamA" ? "You" : "Them"}</span>
          <span />
          <span className="text-right">{myTeam === "teamB" ? "You" : "Them"}</span>
        </div>
      )}
    </div>
  );
}
