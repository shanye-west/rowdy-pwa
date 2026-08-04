import { useEffect, useRef, useState } from "react";
import { Dices } from "lucide-react";
import { cn } from "../../lib/utils";
import type { DraftTeamKey } from "../../types";
import type { PairingsMeta } from "./types";

export interface TeamFlipPickerProps {
  meta: PairingsMeta;
  value: DraftTeamKey;
  onChange: (team: DraftTeamKey) => void;
  /** Heading above the two team buttons. */
  label?: string;
}

/**
 * Records the coin flip: who nominates match 1. Shared by the admin's pre-draft
 * setup and the "start a staged draft" step — the flip happens at the tee, long
 * after availability is locked in, so it needs to be enterable from both.
 */
export default function TeamFlipPicker({
  meta,
  value,
  onChange,
  label = "Who nominates first?",
}: TeamFlipPickerProps) {
  const [flashed, setFlashed] = useState<DraftTeamKey | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

  const flipCoin = () => {
    const winner: DraftTeamKey = Math.random() < 0.5 ? "teamA" : "teamB";
    onChange(winner);
    setFlashed(winner);
    navigator.vibrate?.(20);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashed(null), 800);
  };

  return (
    <div className="card space-y-3 p-4">
      <div className="font-semibold text-foreground">{label}</div>
      <div className="grid grid-cols-2 gap-2">
        {(["teamA", "teamB"] as DraftTeamKey[]).map((team) => {
          const on = value === team;
          const color = meta.teamColor(team);
          return (
            <button
              key={team}
              type="button"
              onClick={() => onChange(team)}
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
  );
}
