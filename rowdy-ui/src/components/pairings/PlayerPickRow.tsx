import { Check } from "lucide-react";
import PlayerAvatar from "../PlayerAvatar";
import { cn } from "../../lib/utils";
import { tierStyle } from "../../utils/tierColors";
import type { PairingsMeta } from "./types";

export interface PlayerPickRowProps {
  pid: string;
  meta: PairingsMeta;
  teamColor: string;
  selected: boolean;
  disabled?: boolean;
  /** Why the row is disabled (shown as a title + small caption). */
  disabledReason?: string;
  onToggle: () => void;
}

/**
 * A large, tappable picker row for choosing a player during the draft. Selected
 * rows tint + ring in the acting team's color; disabled rows (pick limit hit or
 * a tier-rule clash) dim and show the reason.
 */
export default function PlayerPickRow({
  pid,
  meta,
  teamColor,
  selected,
  disabled,
  disabledReason,
  onToggle,
}: PlayerPickRowProps) {
  const tier = meta.tierOf(pid);
  const ch = meta.chOf(pid);

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={selected}
      title={disabled ? disabledReason : undefined}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all duration-150",
        "active:scale-[0.98] disabled:cursor-not-allowed",
        selected
          ? "border-transparent ring-2"
          : disabled
            ? "border-slate-200 opacity-45"
            : "border-slate-200 hover:bg-slate-50"
      )}
      style={
        selected
          ? { background: `color-mix(in srgb, ${teamColor} 12%, white)`, boxShadow: `0 0 0 2px ${teamColor}` }
          : undefined
      }
    >
      <PlayerAvatar name={meta.nameOf(pid)} color={teamColor} size={32} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-slate-800">{meta.nameOf(pid)}</div>
        {disabled && disabledReason && (
          <div className="truncate text-[11px] font-medium text-rose-500">{disabledReason}</div>
        )}
      </div>
      {tier && (
        <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-bold", tierStyle(tier).chip)}>
          {tier}
        </span>
      )}
      {ch != null && <span className="text-xs font-medium text-slate-400">CH {ch}</span>}
      <span
        className={cn(
          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
          selected ? "border-transparent text-white" : "border-slate-300 text-transparent"
        )}
        style={selected ? { background: teamColor } : undefined}
      >
        <Check size={13} strokeWidth={3} />
      </span>
    </button>
  );
}
