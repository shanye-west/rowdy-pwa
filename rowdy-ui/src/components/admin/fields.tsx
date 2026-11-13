/**
 * Form primitives for the admin surface.
 *
 * Admin pages used to hand-roll every input with raw `border-gray-300` classes,
 * which is why they drifted away from the rest of the app. Everything here is
 * built on the same design tokens (border/card/muted-foreground) and the shared
 * Switch, so an admin form looks like the app rather than a raw HTML page.
 */

import { useId, type ReactNode } from "react";
import { cn } from "../../lib/utils";
import { Switch } from "../ui/switch";

export interface FieldProps {
  label: ReactNode;
  /** Small grey text under the control. */
  hint?: ReactNode;
  /** Renders "optional" next to the label. */
  optional?: boolean;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}

/** Label + control + hint, stacked. */
export function Field({ label, hint, optional, htmlFor, className, children }: FieldProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label
        htmlFor={htmlFor}
        className="flex items-baseline gap-2 text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground"
      >
        {label}
        {optional && <span className="font-normal normal-case tracking-normal opacity-70">optional</span>}
      </label>
      {children}
      {hint && <p className="text-xs leading-snug text-muted-foreground">{hint}</p>}
    </div>
  );
}

export interface ToggleRowProps {
  label: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}

/**
 * A labelled on/off row. Replaces the bare `<input type="checkbox">` rows —
 * same 44px-friendly hit area as the rest of the app's toggles.
 */
export function ToggleRow({ label, description, checked, onChange, disabled }: ToggleRowProps) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div className="min-w-0">
        <label htmlFor={id} className="block text-sm font-semibold text-foreground">
          {label}
        </label>
        {description && <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{description}</p>}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}

/** Divider-separated stack of ToggleRows. */
export function ToggleList({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-border/60">{children}</div>;
}

/**
 * Boxed supporting detail (ids, computed totals, notes). `tone="warning"` is the
 * amber variant for something the admin should act on before saving.
 */
export function InfoNote({
  children,
  className,
  tone = "neutral",
}: {
  children: ReactNode;
  className?: string;
  tone?: "neutral" | "warning";
}) {
  return (
    <div
      role={tone === "warning" ? "alert" : undefined}
      className={cn(
        "rounded-lg px-3 py-2 text-xs leading-relaxed",
        tone === "warning"
          ? "border border-amber-500/40 bg-amber-500/10 text-amber-800"
          : "bg-muted/60 text-muted-foreground",
        className
      )}
    >
      {children}
    </div>
  );
}

/** A single switch in its own card — for the one control a page leads with (a lock). */
export function ToggleCard(props: ToggleRowProps) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card px-4 py-1.5 shadow-sm">
      <ToggleRow {...props} />
    </div>
  );
}

/** A titled sub-group inside a form (e.g. "Skins", "Payouts"). */
export function FieldGroup({
  title,
  description,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-border/70 p-3">
      <div>
        <div className="text-sm font-semibold text-foreground">{title}</div>
        {description && <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{description}</p>}
      </div>
      {children}
    </div>
  );
}
