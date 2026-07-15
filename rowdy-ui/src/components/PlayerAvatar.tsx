import { memo, useMemo, useState } from "react";
import { cn } from "../lib/utils";
import { playerPhotoUrl } from "../assets/players";

export interface PlayerAvatarProps {
  /** Player display name; initials are derived from it. */
  name?: string;
  /**
   * Player id. When a headshot is bundled for this player it renders as the
   * avatar; otherwise it falls back to the team-tinted initials.
   */
  playerId?: string | null;
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
 * Small circular avatar. When a headshot is bundled for `playerId` it renders
 * the photo; otherwise (no id, no photo, or a load error) it falls back to the
 * player's initials on a team-tinted background. Deterministic — same name +
 * color always renders the same initials.
 */
function PlayerAvatar({ name, playerId, color, size = 28, className }: PlayerAvatarProps) {
  const initials = useMemo(() => initialsOf(name), [name]);
  const photo = playerPhotoUrl(playerId);
  const [failed, setFailed] = useState(false);
  const tint = color || "var(--team-a-default)";

  if (photo && !failed) {
    return (
      <img
        src={photo}
        alt={name || ""}
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className={cn("inline-block shrink-0 rounded-full object-cover", className)}
        style={{
          width: size,
          height: size,
          background: `color-mix(in srgb, ${tint} 18%, var(--card-bg))`,
        }}
      />
    );
  }

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
        background: `color-mix(in srgb, ${tint} 18%, var(--card-bg))`,
        color: tint,
      }}
    >
      {initials}
    </span>
  );
}

export default memo(PlayerAvatar);
