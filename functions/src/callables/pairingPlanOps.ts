/**
 * Callable for a personal pre-draft pairing plan
 * (`pairingPlans/{roundId}__{ownerPlayerId}`).
 *
 * A plan is ONE PERSON's mock draft board for a round: how they'd pair their own
 * side, how they think the opponent will pair theirs, and which of those they
 * want to see face each other. Each captain, co-captain and admin gets their own
 * doc so they can each test their own assumptions — nobody reads anyone else's,
 * admins included. That's why the doc is keyed by player id rather than team,
 * and why `authorizedUids` holds exactly one uid.
 *
 * Deliberately NOT part of the `pairingDrafts` doc, which is readable by every
 * signed-in user so the /pairings-tv board works.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { requirePlanner } from "../helpers/captainAuth.js";
import { assertPairTiersAllowed, draftPlayersPerSide, DraftError, type DraftTeam } from "../helpers/pairingDraft.js";
import type { RoundFormat } from "../types.js";

function db() {
  return getFirestore();
}

const TIERS = ["A", "B", "C", "D"] as const;
const TEAMS: DraftTeam[] = ["teamA", "teamB"];
/** Generous ceilings — a real round is ~6 matchups; these only stop abuse. */
const MAX_MATCHUPS = 24;
const MAX_NOTES = 4000;

/** Deterministic plan doc id: one plan per round per person. */
export function planDocId(roundId: string, ownerPlayerId: string): string {
  return `${roundId}__${ownerPlayerId}`;
}

/** Flatten a team's rosterByTier into an id set + a playerId → tier lookup. */
function rosterAndTiers(rosterByTier: Record<string, string[]> | undefined): {
  roster: Set<string>;
  tiers: Record<string, string>;
} {
  const roster = new Set<string>();
  const tiers: Record<string, string> = {};
  for (const tier of TIERS) {
    for (const pid of rosterByTier?.[tier] ?? []) {
      roster.add(pid);
      tiers[pid] = tier;
    }
  }
  return { roster, tiers };
}

/**
 * Captain, co-captain or admin: save YOUR OWN pairing plan for a round. The
 * owner is taken from the caller's auth, never from the request, so there's no
 * way to write (or overwrite) somebody else's plan.
 */
export const savePairingPlan = onCall(async (request) => {
  const { roundId, matchups, notes } = request.data || {};
  if (!roundId || typeof roundId !== "string") throw new HttpsError("invalid-argument", "Missing roundId");
  if (!Array.isArray(matchups)) throw new HttpsError("invalid-argument", "matchups must be an array");
  if (matchups.length > MAX_MATCHUPS) throw new HttpsError("invalid-argument", "Too many matchups");
  if (notes != null && typeof notes !== "string") throw new HttpsError("invalid-argument", "notes must be a string");
  if (typeof notes === "string" && notes.length > MAX_NOTES) {
    throw new HttpsError("invalid-argument", "Notes are too long");
  }

  const roundSnap = await db().collection("rounds").doc(roundId).get();
  if (!roundSnap.exists) throw new HttpsError("not-found", "Round not found");
  const round = roundSnap.data()!;
  const tournamentId = round.tournamentId as string | undefined;
  const format = round.format as RoundFormat | null | undefined;
  if (!tournamentId) throw new HttpsError("failed-precondition", "Round is missing tournamentId");
  if (!format) throw new HttpsError("failed-precondition", "Round has no format set");

  const { uid, playerId } = await requirePlanner(
    request,
    "savePairingPlan",
    { maxCalls: 60, windowSeconds: 60 },
    tournamentId
  );

  const tSnap = await db().collection("tournaments").doc(tournamentId).get();
  if (!tSnap.exists) throw new HttpsError("not-found", "Tournament not found");
  const t = tSnap.data()!;

  // Validate against each team's ROSTER, not the round's available list: plans
  // are often written before availability is staged, and a benched player in a
  // saved plan is a UI warning, not a reason to reject the save.
  const sides = {
    teamA: rosterAndTiers(t.teamA?.rosterByTier),
    teamB: rosterAndTiers(t.teamB?.rosterByTier),
  };

  const playersPerSide = draftPlayersPerSide(format);
  const seen: Record<DraftTeam, Set<string>> = { teamA: new Set(), teamB: new Set() };
  const clean: { teamA: string[]; teamB: string[] }[] = [];

  for (const matchup of matchups) {
    if (!matchup || typeof matchup !== "object") {
      throw new HttpsError("invalid-argument", "Each matchup must be an object");
    }
    const cleanMatchup: { teamA: string[]; teamB: string[] } = { teamA: [], teamB: [] };
    for (const team of TEAMS) {
      const raw = (matchup as Record<string, unknown>)[team];
      if (raw != null && !Array.isArray(raw)) {
        throw new HttpsError("invalid-argument", `matchup.${team} must be an array of player ids`);
      }
      const ids = ((raw as unknown[]) ?? []).map(String);
      if (ids.length > playersPerSide) {
        throw new HttpsError("invalid-argument", `A side holds at most ${playersPerSide} player(s)`);
      }
      for (const pid of ids) {
        if (!sides[team].roster.has(pid)) {
          throw new HttpsError("invalid-argument", `Player ${pid} is not on that team's roster`);
        }
        if (seen[team].has(pid)) {
          throw new HttpsError("invalid-argument", "A player can only appear in one matchup");
        }
        seen[team].add(pid);
      }
      // Same A/A + D/D rule the live draft enforces, applied to each side —
      // only once a side is full, so a half-filled slot still saves mid-thought.
      if (ids.length === playersPerSide) {
        try {
          assertPairTiersAllowed(ids, sides[team].tiers);
        } catch (e) {
          if (e instanceof DraftError) throw new HttpsError("failed-precondition", e.message);
          throw e;
        }
      }
      cleanMatchup[team] = ids;
    }
    clean.push(cleanMatchup);
  }

  // Full overwrite: a plan is one small doc its owner re-saves as a whole.
  // `authorizedUids` is the owner alone — that's what makes it unreadable by
  // the other captains AND by admins.
  await db()
    .collection("pairingPlans")
    .doc(planDocId(roundId, playerId))
    .set({
      roundId,
      tournamentId,
      ownerPlayerId: playerId,
      matchups: clean,
      notes: typeof notes === "string" ? notes : "",
      authorizedUids: [uid],
      updatedAt: FieldValue.serverTimestamp(),
    });

  return { success: true };
});
