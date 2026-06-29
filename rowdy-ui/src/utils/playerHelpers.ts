import type { PlayerDoc, TierMap } from "../types";

/**
 * Player name formatting utilities
 *
 * These functions take a players lookup map and return formatted names.
 * They handle missing data gracefully with sensible fallbacks.
 */

export type PlayerLookup = Record<string, PlayerDoc>;

const TIER_ORDER = ["A", "B", "C", "D"] as const;
const UNRANKED_TIER = TIER_ORDER.length; // players not found in a roster sort last

/**
 * Build a playerId -> tier rank map from a team's rosterByTier.
 * Rank is A=0, B=1, C=2, D=3; players absent from the roster are unranked.
 */
export function buildTierRank(roster: TierMap | undefined): Record<string, number> {
  const rank: Record<string, number> = {};
  if (!roster) return rank;
  TIER_ORDER.forEach((tier, idx) => {
    (roster[tier] || []).forEach((pid) => {
      if (rank[pid] === undefined) rank[pid] = idx;
    });
  });
  return rank;
}

/**
 * Order a list of players by their team tier (A first, then B, C, D). The sort
 * is stable: players within the same tier — and any not found in the roster,
 * which sort last — keep their original relative order. Returns a new array.
 *
 * Note: when player order is coupled to score-array indices (best ball / shamble
 * store gross per original index), sort a view that preserves the original index
 * rather than the raw array.
 */
export function sortPlayersByTier<T extends { playerId: string }>(
  players: T[],
  roster: TierMap | undefined
): T[] {
  const rank = buildTierRank(roster);
  return players
    .map((player, index) => ({ player, index }))
    .sort((a, b) => {
      const ra = rank[a.player.playerId] ?? UNRANKED_TIER;
      const rb = rank[b.player.playerId] ?? UNRANKED_TIER;
      return ra - rb || a.index - b.index;
    })
    .map(({ player }) => player);
}

/**
 * Get the full display name for a player
 * @returns Full name like "Shane West" or fallback
 */
export function getPlayerName(pid: string | undefined, players: PlayerLookup): string {
  if (!pid) return "Player";
  const p = players[pid];
  if (!p) return "...";
  return p.displayName || "Unknown";
}

/**
 * Get short name: first initial + last name
 * @returns Short name like "S. West" or fallback
 */
export function getPlayerShortName(pid: string | undefined, players: PlayerLookup): string {
  if (!pid) return "?";
  const p = players[pid];
  if (!p) return "?";
  const name = p.displayName || "Unknown";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0) + ".";
  const firstInitial = parts[0].charAt(0);
  const lastName = parts[parts.length - 1];
  return `${firstInitial}. ${lastName}`;
}

/**
 * Get player initials: first initial + last initial
 * @returns Initials like "SW" or fallback
 */
export function getPlayerInitials(pid: string | undefined, players: PlayerLookup): string {
  if (!pid) return "?";
  const p = players[pid];
  if (!p) return "?";
  const name = p.displayName || "Unknown";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  const firstInitial = parts[0].charAt(0).toUpperCase();
  const lastInitial = parts[parts.length - 1].charAt(0).toUpperCase();
  return `${firstInitial}${lastInitial}`;
}
