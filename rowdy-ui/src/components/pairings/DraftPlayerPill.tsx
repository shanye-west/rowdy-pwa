import PlayerAvatar from "../PlayerAvatar";
import { cn } from "../../lib/utils";
import { tierStyle } from "../../utils/tierColors";
import type { DraftTeamKey } from "../../types";
import type { PairingsMeta } from "./types";

export interface DraftPlayerPillProps {
  pid: string;
  team: DraftTeamKey;
  meta: PairingsMeta;
  /** Mirror the layout for the right-hand (team B) side of a match. */
  alignRight?: boolean;
}

/**
 * A placed player as shown on the draft board: initials avatar, name (team
 * color), tier chip, and course handicap. Right-aligned variant mirrors the
 * order so the avatar hugs the outer edge of the match card.
 */
export default function DraftPlayerPill({ pid, team, meta, alignRight }: DraftPlayerPillProps) {
  const tier = meta.tierOf(pid);
  const ch = meta.chOf(pid);
  const color = meta.teamColor(team);

  const avatar = <PlayerAvatar name={meta.nameOf(pid)} color={color} size={26} />;
  const text = (
    <div className={cn("min-w-0", alignRight && "text-right")}>
      <div className="truncate text-sm font-semibold leading-tight" style={{ color }}>
        {meta.nameOf(pid)}
      </div>
      <div className={cn("mt-0.5 flex items-center gap-1", alignRight && "justify-end")}>
        {tier && (
          <span className={cn("rounded px-1 text-[10px] font-bold", tierStyle(tier).chip)}>{tier}</span>
        )}
        {ch != null && <span className="text-[10px] font-medium text-muted-foreground">CH {ch}</span>}
      </div>
    </div>
  );

  return (
    <div className={cn("flex items-center gap-2", alignRight && "flex-row-reverse")}>
      {avatar}
      {text}
    </div>
  );
}
