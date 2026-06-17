/**
 * Achievement badges derived from a player's aggregated series stats.
 *
 * Pure + defensive: every counter is read through `num()` so older stat docs
 * that predate a given field simply don't earn that badge (no crashes, no NaN).
 * Surfaced on the player profile; see PlayerStatsBySeries in ../types.
 */

import type { PlayerStatsBySeries } from "../types";

export type BadgeTone = "gold" | "fun";

export interface BadgeDef {
  id: string;
  label: string;
  emoji: string;
  tone: BadgeTone;
  /** Relevant counter pulled from aggregated stats. */
  value: (s: PlayerStatsBySeries) => number;
  /** Minimum value required to earn the badge (default 1). */
  threshold?: number;
  /** One-line description, given the earned count. */
  describe: (count: number) => string;
}

export interface EarnedBadge {
  id: string;
  label: string;
  emoji: string;
  tone: BadgeTone;
  count: number;
  description: string;
}

const num = (v: number | undefined): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;

const plural = (c: number, word: string) => `${c} ${word}${c === 1 ? "" : "s"}`;

export const BADGE_DEFS: BadgeDef[] = [
  {
    id: "clutch",
    label: "Clutch Hero",
    emoji: "🏆",
    tone: "gold",
    value: (s) => num(s.clutchWins),
    describe: (c) => `${plural(c, "match")} won on the 18th hole`,
  },
  {
    id: "comeback",
    label: "Comeback King",
    emoji: "🔥",
    tone: "gold",
    value: (s) => num(s.comebackWins),
    describe: (c) => `Erased a 3-down back-nine deficit ${plural(c, "time")}`,
  },
  {
    id: "wire",
    label: "Wire to Wire",
    emoji: "🛡️",
    tone: "gold",
    value: (s) => num(s.neverBehindWins),
    describe: (c) => `Won ${plural(c, "match")} without ever trailing`,
  },
  {
    id: "drives",
    label: "Drive Master",
    emoji: "🚀",
    tone: "gold",
    threshold: 10,
    value: (s) => num(s.drivesUsed),
    describe: (c) => `${plural(c, "drive")} taken off your tee`,
  },
  {
    id: "birdies",
    label: "Birdie Machine",
    emoji: "🐦",
    tone: "gold",
    threshold: 5,
    value: (s) => num(s.birdies),
    describe: (c) => `${plural(c, "career birdie")}`,
  },
  {
    id: "eagles",
    label: "Eagle Club",
    emoji: "🦅",
    tone: "gold",
    value: (s) => num(s.eagles),
    describe: (c) => `${plural(c, "career eagle")}`,
  },
  {
    id: "captain",
    label: "Captain",
    emoji: "🎖️",
    tone: "gold",
    value: (s) => num(s.captainWins),
    describe: (c) => `${plural(c, "win")} as captain`,
  },
  {
    id: "captainslayer",
    label: "Captain Slayer",
    emoji: "⚔️",
    tone: "gold",
    value: (s) => num(s.captainVsCaptainWins),
    describe: (c) => `Beat the opposing captain ${plural(c, "time")}`,
  },
  // Fun / "shame" badges — the banter fuel.
  {
    id: "heartbreak",
    label: "Heartbreaker",
    emoji: "💔",
    tone: "fun",
    value: (s) => num(s.blownLeads),
    describe: (c) => `Coughed up a 3-up back-nine lead ${plural(c, "time")}`,
  },
  {
    id: "jekyll",
    label: "Jekyll & Hyde",
    emoji: "🎭",
    tone: "fun",
    value: (s) => num(s.jekyllAndHydes),
    describe: (c) => `${plural(c, "wildly lopsided team round")}`,
  },
];

/** Returns the badges a player has earned, in catalog order. */
export function getBadges(stats: PlayerStatsBySeries | null | undefined): EarnedBadge[] {
  if (!stats) return [];
  const earned: EarnedBadge[] = [];
  for (const def of BADGE_DEFS) {
    const count = def.value(stats);
    if (count >= (def.threshold ?? 1)) {
      earned.push({
        id: def.id,
        label: def.label,
        emoji: def.emoji,
        tone: def.tone,
        count,
        description: def.describe(count),
      });
    }
  }
  return earned;
}
