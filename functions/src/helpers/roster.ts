/**
 * Shared roster / tournament-metadata helpers for the notification triggers and
 * the comment callables. A match references its players inline; a tournament's
 * full roster lives on the team docs (rosterByTier + handicapByPlayer). These
 * resolvers are the one place that knows those shapes, so the notify fan-out and
 * commentOps agree on "who is in this match / tournament".
 */

import { getFirestore } from "firebase-admin/firestore";

function db() {
  return getFirestore();
}

/** Player ids playing in a match (both teams), from the match doc. */
export function matchPlayerIds(m: FirebaseFirestore.DocumentData): string[] {
  const fromTeam = (team: unknown): string[] =>
    Array.isArray(team)
      ? team
          .map((p) => (p as { playerId?: unknown })?.playerId)
          .filter((id): id is string => typeof id === "string")
      : [];
  return [...fromTeam(m.teamAPlayers), ...fromTeam(m.teamBPlayers)];
}

/** Pure: every rostered player id (both teams) from a tournament doc, deduped. */
export function rosterPlayerIds(t: FirebaseFirestore.DocumentData | undefined): string[] {
  if (!t) return [];
  const ids: string[] = [];
  for (const team of [t.teamA, t.teamB]) {
    const tiers = (team as { rosterByTier?: Record<string, unknown> } | undefined)?.rosterByTier;
    if (tiers) {
      for (const tier of Object.values(tiers)) {
        if (Array.isArray(tier)) ids.push(...tier.filter((x): x is string => typeof x === "string"));
      }
    }
    const handicaps = (team as { handicapByPlayer?: Record<string, unknown> } | undefined)?.handicapByPlayer;
    if (handicaps) ids.push(...Object.keys(handicaps));
  }
  return [...new Set(ids)];
}

/** Every player on either team's roster for a tournament (deduped). */
export async function tournamentPlayerIds(tournamentId: string): Promise<string[]> {
  const t = (await db().collection("tournaments").doc(tournamentId).get()).data();
  return rosterPlayerIds(t);
}

/** Tournament fields the notification triggers need, resolved in one read. */
export interface TournamentMeta {
  exists: boolean;
  /** Whole-roster recipient set for tournament-wide ("all matches") notifications. */
  playerIds: string[];
  teamAName: string;
  teamBName: string;
  tiebreakerWinner?: "teamA" | "teamB";
  /** Admin override for total points available; falls back to a computed sum when unset. */
  totalPointsAvailable?: number;
}

function teamName(team: unknown, fallback: string): string {
  const n = (team as { name?: unknown } | undefined)?.name;
  return typeof n === "string" && n.trim() ? n : fallback;
}

/**
 * Read a tournament doc once and return roster + display metadata used to build
 * notification copy (team names) and resolve recipients. Falls back to generic
 * "Team A"/"Team B" labels when names aren't set.
 */
export async function loadTournamentMeta(tournamentId: string): Promise<TournamentMeta> {
  const t = (await db().collection("tournaments").doc(tournamentId).get()).data();
  const tb = t?.tiebreakerWinner;
  return {
    exists: !!t,
    playerIds: rosterPlayerIds(t),
    teamAName: teamName(t?.teamA, "Team A"),
    teamBName: teamName(t?.teamB, "Team B"),
    tiebreakerWinner: tb === "teamA" || tb === "teamB" ? tb : undefined,
    totalPointsAvailable: typeof t?.totalPointsAvailable === "number" ? t.totalPointsAvailable : undefined,
  };
}
