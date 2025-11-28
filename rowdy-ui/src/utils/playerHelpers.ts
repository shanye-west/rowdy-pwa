import type { PlayerDoc } from "../types";

/**
 * Player name formatting utilities
 * 
 * These functions take a players lookup map and return formatted names.
 * They handle missing data gracefully with sensible fallbacks.
 */

export type PlayerLookup = Record<string, PlayerDoc>;

/**
 * Get the full display name for a player
 * @returns Full name like "Shane West" or fallback
 */
export function getPlayerName(pid: string | undefined, players: PlayerLookup): string {
  if (!pid) return "Player";
  const p = players[pid];
  if (!p) return "...";
  return p.displayName || p.username || "Unknown";
}

/**
 * Get short name: first initial + last name
 * @returns Short name like "S. West" or fallback
 */
export function getPlayerShortName(pid: string | undefined, players: PlayerLookup): string {
  if (!pid) return "?";
  const p = players[pid];
  if (!p) return "?";
  const name = p.displayName || p.username || "Unknown";
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
  const name = p.displayName || p.username || "Unknown";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  const firstInitial = parts[0].charAt(0).toUpperCase();
  const lastInitial = parts[parts.length - 1].charAt(0).toUpperCase();
  return `${firstInitial}${lastInitial}`;
}
