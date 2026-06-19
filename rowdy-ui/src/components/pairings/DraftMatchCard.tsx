import { Check, Clock } from "lucide-react";
import { cn } from "../../lib/utils";
import DraftPlayerPill from "./DraftPlayerPill";
import type { DraftMatch, DraftTeamKey } from "../../types";
import type { PairingsMeta } from "./types";

export interface DraftMatchCardProps {
  match: DraftMatch;
  meta: PairingsMeta;
  /** This match is the one currently on the clock. */
  isCurrent: boolean;
}

function Slot({
  ids,
  team,
  meta,
  alignRight,
}: {
  ids: string[] | null;
  team: DraftTeamKey;
  meta: PairingsMeta;
  alignRight?: boolean;
}) {
  if (ids && ids.length) {
    return (
      // key off the ids so the entrance animation plays once when the slot fills
      <div key={ids.join("-")} className="animate-pick-in flex flex-col gap-1.5">
        {ids.map((pid) => (
          <DraftPlayerPill key={pid} pid={pid} team={team} meta={meta} alignRight={alignRight} />
        ))}
      </div>
    );
  }
  return (
    <div
      className={cn(
        "text-xs font-medium text-slate-300",
        alignRight ? "text-right" : "text-left"
      )}
    >
      — to pick —
    </div>
  );
}

/**
 * One match row on the draft board, styled to match the app's match cards: a
 * "Team A … vs … Team B" layout with a status chip. The current (on-the-clock)
 * match gets a pulsing ring so it's obvious where the action is.
 */
export default function DraftMatchCard({ match, meta, isCurrent }: DraftMatchCardProps) {
  const bothSet = !!(match.teamAPlayers?.length && match.teamBPlayers?.length);

  return (
    <div
      className={cn(
        "rounded-xl border bg-card/80 p-3 transition-all duration-200",
        isCurrent
          ? "animate-soft-pulse border-[hsl(var(--primary))]"
          : bothSet
            ? "border-border"
            : "border-border/60 opacity-90"
      )}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
          Match {match.matchNumber}
        </span>
        {bothSet ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
            <Check size={11} strokeWidth={3} /> Set
          </span>
        ) : isCurrent ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-700">
            <Clock size={11} strokeWidth={3} /> On the clock
          </span>
        ) : (
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Nom. {meta.teamName(match.nominatedBy)}
          </span>
        )}
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <Slot ids={match.teamAPlayers} team="teamA" meta={meta} />
        <span className="text-[10px] font-bold uppercase text-slate-300">vs</span>
        <Slot ids={match.teamBPlayers} team="teamB" meta={meta} alignRight />
      </div>
    </div>
  );
}
