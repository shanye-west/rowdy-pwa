/**
 * Shared control styling for admin forms. Kept in its own module (not in
 * fields.tsx) so those files export components only and stay fast-refreshable.
 */

/** Standard text/number/select control styling. */
export const inputClass =
  "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground shadow-sm outline-none transition-colors " +
  "placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/25 " +
  "disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground read-only:bg-muted/60";

/** Same control, for ids and other machine-ish values. */
export const monoInputClass = `${inputClass} font-mono text-[0.8rem]`;

/** Outline-button treatment for destructive actions (pair with `variant="outline"`). */
export const dangerButtonClass =
  "border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive";
