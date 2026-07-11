import { useEffect, useRef, useState } from "react";
import { Dices, Check, CheckCircle2, AlertTriangle } from "lucide-react";
import PlayerAvatar from "../PlayerAvatar";
import { Badge } from "../ui/badge";
import { cn } from "../../lib/utils";
import { tierStyle } from "../../utils/tierColors";
import { tierPlayerIds } from "../../utils/roster";
import type { DraftTeamKey, TournamentDoc } from "../../types";
import type { PairingsMeta } from "./types";

/** One team's roster as available/benched toggles. Hoisted to module scope so
 *  it isn't re-created (and remounted) on every keystroke in DraftSetup. */
function TeamAvailabilityPicker({
  team,
  sel,
  setSel,
  tournament,
  meta,
}: {
  team: DraftTeamKey;
  sel: Set<string>;
  setSel: (s: Set<string>) => void;
  tournament: TournamentDoc;
  meta: PairingsMeta;
}) {
  const ids = tierPlayerIds(tournament[team]?.rosterByTier);
  const color = meta.teamColor(team);
  const toggle = (pid: string) => {
    const next = new Set(sel);
    if (next.has(pid)) next.delete(pid);
    else next.add(pid);
    setSel(next);
  };
  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-bold" style={{ color }}>
          {meta.teamName(team)}
        </h3>
        <Badge variant="muted">{sel.size} playing</Badge>
      </div>
      {ids.length === 0 ? (
        <p className="text-sm text-muted-foreground">No roster set for this team.</p>
      ) : (
        <div className="space-y-1.5">
          {ids.map((pid) => {
            const on = sel.has(pid);
            const tier = meta.tierOf(pid);
            const ch = meta.chOf(pid);
            return (
              <button
                key={pid}
                type="button"
                onClick={() => toggle(pid)}
                aria-pressed={on}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-all duration-150 active:scale-[0.98]",
                  on ? "border-transparent ring-2" : "border-border opacity-55 hover:opacity-80"
                )}
                style={
                  on
                    ? { background: `color-mix(in srgb, ${color} 10%, var(--card-bg))`, boxShadow: `0 0 0 2px ${color}` }
                    : undefined
                }
              >
                <PlayerAvatar name={meta.nameOf(pid)} color={color} size={30} />
                <div className="min-w-0 flex-1">
                  <div className={cn("truncate text-sm font-semibold", on ? "text-foreground" : "text-muted-foreground line-through")}>
                    {meta.nameOf(pid)}
                  </div>
                  {!on && <div className="text-[11px] font-medium text-muted-foreground">Benched</div>}
                </div>
                {tier && (
                  <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-bold", tierStyle(tier).chip)}>
                    {tier}
                  </span>
                )}
                {ch != null && <span className="text-xs font-medium text-muted-foreground">CH {ch}</span>}
                {on && (
                  <span
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white"
                    style={{ background: color }}
                  >
                    <Check size={13} strokeWidth={3} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export interface DraftSetupProps {
  tournament: TournamentDoc;
  meta: PairingsMeta;
  perSide: number;
  availA: Set<string>;
  availB: Set<string>;
  setAvailA: (s: Set<string>) => void;
  setAvailB: (s: Set<string>) => void;
  firstPick: DraftTeamKey;
  setFirstPick: (t: DraftTeamKey) => void;
  busy: boolean;
  onStart: () => void;
}

/**
 * Admin pre-draft setup: bench any players sitting out, record the coin-flip
 * winner (who nominates match 1), and start the draft once both sides are
 * balanced.
 */
export default function DraftSetup({
  tournament,
  meta,
  perSide,
  availA,
  availB,
  setAvailA,
  setAvailB,
  firstPick,
  setFirstPick,
  busy,
  onStart,
}: DraftSetupProps) {
  const [flashed, setFlashed] = useState<DraftTeamKey | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

  const countA = availA.size;
  const countB = availB.size;
  const balanced = countA === countB && countA > 0 && countA % perSide === 0;
  const totalMatches = balanced ? countA / perSide : 0;

  const flipCoin = () => {
    const winner: DraftTeamKey = Math.random() < 0.5 ? "teamA" : "teamB";
    setFirstPick(winner);
    setFlashed(winner);
    navigator.vibrate?.(20);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashed(null), 800);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Bench anyone sitting out, record the coin-flip winner (they nominate match 1), then start the
        draft.{perSide === 2 && " Pairs can't be two A-tier or two D-tier players."}
      </p>

      <TeamAvailabilityPicker team="teamA" sel={availA} setSel={setAvailA} tournament={tournament} meta={meta} />
      <TeamAvailabilityPicker team="teamB" sel={availB} setSel={setAvailB} tournament={tournament} meta={meta} />

      {/* Coin flip */}
      <div className="card p-4 space-y-3">
        <div className="font-semibold text-foreground">Who nominates first?</div>
        <div className="grid grid-cols-2 gap-2">
          {(["teamA", "teamB"] as DraftTeamKey[]).map((team) => {
            const on = firstPick === team;
            const color = meta.teamColor(team);
            return (
              <button
                key={team}
                type="button"
                onClick={() => setFirstPick(team)}
                aria-pressed={on}
                className={cn(
                  "rounded-xl border px-3 py-3 text-sm font-bold transition-all duration-200",
                  flashed === team && "animate-soft-pulse",
                  on ? "border-transparent text-white" : "border-border text-muted-foreground hover:bg-muted"
                )}
                style={on ? { background: color } : undefined}
              >
                {meta.teamName(team)}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={flipCoin}
          className="btn-ghost mx-auto inline-flex items-center gap-1.5 text-sm text-muted-foreground"
        >
          <Dices size={16} className={cn(flashed && "motion-safe:animate-spin")} /> Flip a coin
        </button>
      </div>

      {/* Balance status */}
      <div
        className={cn(
          "flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium",
          balanced
            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
            : "border-amber-200 bg-amber-50 text-amber-800"
        )}
      >
        {balanced ? (
          <CheckCircle2 size={16} className="shrink-0" />
        ) : (
          <AlertTriangle size={16} className="shrink-0" />
        )}
        <span>
          {balanced
            ? `${countA} v ${countB} — ${totalMatches} matchup${totalMatches > 1 ? "s" : ""} ready`
            : `Both teams need the same number of players, divisible by ${perSide}. Currently ${countA} v ${countB}.`}
        </span>
      </div>

      <button className="btn btn-primary w-full" disabled={!balanced || busy} onClick={onStart}>
        {busy ? "Starting…" : balanced ? `Start draft · ${totalMatches} matchups` : "Start draft"}
      </button>
    </div>
  );
}
