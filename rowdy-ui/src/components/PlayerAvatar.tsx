import { useMemo } from "react";
import { cn } from "../lib/utils";

export interface PlayerAvatarProps {
  /** Player display name; initials are derived from it. */
  name?: string;
  /** Team color (css value). Used as a tinted background + text color. */
  color?: string;
  /** Diameter in px (default 28). */
  size?: number;
  className?: string;
}

/** First letters of the first two words, uppercased (e.g. "Jordan Webb" → "JW"). */
function initialsOf(name: string | undefined): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Small circular initials avatar. Players have no photo field, so initials on a
 * team-tinted background are how we give each name a visual anchor. Deterministic
 * — same name + color always renders the same.
 */
export default function PlayerAvatar({ name, color, size = 28, className }: PlayerAvatarProps) {
  const initials = useMemo(() => initialsOf(name), [name]);
  const tint = color || "var(--team-a-default)";
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-bold leading-none",
        className
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.4),
        background: `color-mix(in srgb, ${tint} 18%, white)`,
        color: tint,
      }}
    >
      {initials}
    </span>
  );
}
