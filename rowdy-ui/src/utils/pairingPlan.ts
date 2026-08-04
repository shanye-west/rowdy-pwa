/**
 * Helpers for a personal pairing plan — the pre-draft sandbox where one captain
 * (or admin) lays out a whole mock board: their own pairs, their guess at the
 * opponent's pairs, and which of those they want facing each other.
 *
 * The plan is only a plan: nothing here writes to the draft, and the real
 * validation still happens server-side when picks are made. These functions
 * mirror the same A/A + D/D tier rule so nobody spends the pre-round hours on a
 * board the draft would refuse.
 */

import { isPairableRemainder, pairTierViolation } from "./pairingDraft";
import type { DraftTeamKey, PlannedMatchup } from "../types";

export type TierMapLookup = Record<string, "A" | "B" | "C" | "D">;

export const PLAN_TEAMS: DraftTeamKey[] = ["teamA", "teamB"];

/** An empty board of `slotCount` matchups. */
export function emptyMatchups(slotCount: number): PlannedMatchup[] {
  return Array.from({ length: slotCount }, () => ({ teamA: [], teamB: [] }));
}

/**
 * Fit a stored board to the round's shape: exactly `slotCount` matchups, each
 * side holding at most `perSide` ids, no player appearing twice. Availability
 * can change between saves (someone gets benched, the format changes), so a
 * loaded plan is always squared up against the current round rather than
 * trusted as-is. `allowed` optionally restricts each side to available players.
 */
export function normalizeMatchups(
  matchups: PlannedMatchup[] | undefined,
  slotCount: number,
  perSide: number,
  allowed?: Record<DraftTeamKey, Set<string>>
): PlannedMatchup[] {
  const seen: Record<DraftTeamKey, Set<string>> = { teamA: new Set(), teamB: new Set() };
  const out: PlannedMatchup[] = [];
  for (let i = 0; i < slotCount; i++) {
    const next: PlannedMatchup = { teamA: [], teamB: [] };
    for (const team of PLAN_TEAMS) {
      const raw = matchups?.[i]?.[team] ?? [];
      for (const pid of raw) {
        if (next[team].length >= perSide) break;
        if (seen[team].has(pid)) continue;
        if (allowed && !allowed[team].has(pid)) continue;
        seen[team].add(pid);
        next[team].push(pid);
      }
    }
    out.push(next);
  }
  return out;
}

/** Available players on `team` not yet placed anywhere on the board. */
export function unassignedIds(
  available: string[],
  matchups: PlannedMatchup[],
  team: DraftTeamKey
): string[] {
  const placed = new Set(matchups.flatMap((m) => m[team]));
  return available.filter((id) => !placed.has(id));
}

/** Reason a side is illegal (A/A or D/D), or null. Full sides only. */
export function sideViolation(side: string[], perSide: number, tiers: TierMapLookup): string | null {
  if (side.length !== perSide) return null;
  return pairTierViolation(side, tiers);
}

/**
 * Reason adding `candidateId` to `side` would be illegal, or null. Lets the pool
 * pre-disable a second A (or second D), the same way the live draft's pick panel
 * does — on either team, since a plan pairs the opponent too.
 */
export function cannotAddToSide(
  side: string[],
  candidateId: string,
  perSide: number,
  tiers: TierMapLookup
): string | null {
  if (side.length >= perSide) return "That side is full";
  if (perSide !== 2) return null;
  const tier = tiers[candidateId];
  if (tier !== "A" && tier !== "D") return null;
  if (!side.some((id) => tiers[id] === tier)) return null;
  return tier === "A" ? "Can't pair two A-tier players" : "Can't pair two D-tier players";
}

/**
 * Advisory warning when a team's remaining players can't legally fill the sides
 * that still have room — e.g. three A-tier left for two open slots. Soft by
 * design: individual illegal drops are already blocked, so this only flags a
 * board that's painted itself into a corner.
 */
export function planStrandWarning(
  matchups: PlannedMatchup[],
  available: string[],
  team: DraftTeamKey,
  perSide: number,
  tiers: TierMapLookup
): string | null {
  if (perSide !== 2) return null;
  const left = unassignedIds(available, matchups, team);
  if (left.length === 0) return null;
  const sidesWithRoom = matchups.filter((m) => m[team].length < perSide).length;
  if (isPairableRemainder(left, sidesWithRoom, tiers)) return null;
  return "no two A-tier and no two D-tier can go together, and what's left can't be split that way.";
}

/** True when two boards match (order within a side is ignored). */
export function matchupsEqual(a: PlannedMatchup[], b: PlannedMatchup[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((matchup, i) =>
    PLAN_TEAMS.every((team) => {
      const s1 = [...matchup[team]].sort();
      const s2 = [...b[i][team]].sort();
      return s1.length === s2.length && s1.every((id, j) => id === s2[j]);
    })
  );
}

/** Matchups with both sides fully filled — the ones that are really "set". */
export function completeMatchupCount(matchups: PlannedMatchup[], perSide: number): number {
  return matchups.filter((m) => m.teamA.length === perSide && m.teamB.length === perSide).length;
}
