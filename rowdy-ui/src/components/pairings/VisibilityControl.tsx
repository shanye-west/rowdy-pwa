/**
 * Admin controls for who can watch a pairings draft.
 *
 * Some rounds are drafted with the /pairings-tv board up on a screen and the
 * whole group watching; others are picked by the captains out of sight and
 * revealed once they're done. `VisibilityPicker` chooses which at setup time;
 * `VisibilityBar` shows (and flips) the choice on a draft that already exists —
 * flipping a private draft to live IS the reveal.
 */

import { Eye, EyeOff, Lock, Radio } from "lucide-react";
import { cn } from "../../lib/utils";
import type { DraftVisibility } from "../../types";

const OPTIONS: {
  value: DraftVisibility;
  icon: typeof Radio;
  label: string;
  blurb: string;
}[] = [
  {
    value: "live",
    icon: Radio,
    label: "Watch live",
    blurb: "Everyone can follow the picks as they happen.",
  },
  {
    value: "private",
    icon: Lock,
    label: "Private",
    blurb: "Captains & admins only — share the board when you're ready.",
  },
];

export interface VisibilityPickerProps {
  value: DraftVisibility;
  onChange: (v: DraftVisibility) => void;
  disabled?: boolean;
}

/** Pre-draft choice between a public board and a captains-only one. */
export function VisibilityPicker({ value, onChange, disabled }: VisibilityPickerProps) {
  return (
    <div className="card space-y-3 p-4">
      <div className="font-semibold text-foreground">Who can watch?</div>
      <div className="grid gap-2 sm:grid-cols-2">
        {OPTIONS.map(({ value: v, icon: Icon, label, blurb }) => {
          const on = value === v;
          return (
            <button
              key={v}
              type="button"
              onClick={() => onChange(v)}
              aria-pressed={on}
              disabled={disabled}
              className={cn(
                "flex items-start gap-2.5 rounded-xl border px-3 py-3 text-left transition-all duration-200 disabled:opacity-60",
                on
                  ? "border-primary bg-primary/5 ring-2 ring-primary"
                  : "border-border text-muted-foreground hover:bg-muted"
              )}
            >
              <Icon size={16} className={cn("mt-0.5 shrink-0", on ? "text-primary" : "text-muted-foreground")} />
              <span className="min-w-0">
                <span className={cn("block text-sm font-bold", on ? "text-foreground" : "text-muted-foreground")}>
                  {label}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{blurb}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export interface VisibilityBarProps {
  visibility: DraftVisibility;
  /** Admins get the toggle; everyone else just sees where things stand. */
  isAdmin: boolean;
  busy?: boolean;
  onChange: (v: DraftVisibility) => void;
  /** Copy for the reveal button, e.g. once the draft is done. */
  revealLabel?: string;
}

/**
 * Status strip on an existing draft: is the field watching, or is this one
 * behind closed doors? Admins get the one-tap switch between the two.
 */
export function VisibilityBar({ visibility, isAdmin, busy, onChange, revealLabel }: VisibilityBarProps) {
  const isPrivate = visibility === "private";
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-4 py-3 text-sm font-semibold",
        isPrivate ? "border-slate-200 bg-slate-50 text-slate-700" : "border-red-200 bg-red-50 text-red-700"
      )}
    >
      {isPrivate ? <EyeOff size={18} className="shrink-0" /> : <Eye size={18} className="shrink-0" />}
      <span className="min-w-0 flex-1">
        {isPrivate ? "Private draft — captains & admins only" : "Live — everyone can watch this draft"}
      </span>
      {isAdmin && (
        <button
          type="button"
          className="btn btn-secondary shrink-0 px-3 py-1.5 text-xs"
          disabled={busy}
          onClick={() => onChange(isPrivate ? "live" : "private")}
        >
          {isPrivate ? (revealLabel ?? "Share with everyone") : "Make private"}
        </button>
      )}
    </div>
  );
}
