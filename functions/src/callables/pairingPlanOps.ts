/**
 * Callable for a team's pre-draft pairing plan (`pairingPlans/{roundId}__{team}`).
 *
 * A plan is one team's scratchpad: how that captain intends to pair their own
 * side, written down before the draft opens. It is deliberately NOT part of the
 * `pairingDrafts` doc — that one is readable by every signed-in user so the
 * /pairings-tv board works, and a plan the whole field can read is worthless.
 *
 * Access is that team's captain + co-captain, plus tournament admins (who run
 * the draft and are trusted with both sides' plans). Everyone else is shut out
 * by the `authorizedUids` rule; writes come through here.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { requireCaptainOrAdmin, planReaderUids } from "../helpers/captainAuth.js";
import { assertPairTiersAllowed, draftPlayersPerSide, DraftError, type DraftTeam } from "../helpers/pairingDraft.js";
import type { RoundFormat } from "../types.js";

function db() {
  return getFirestore();
}

const TIERS = ["A", "B", "C", "D"] as const;
/** Generous ceilings — a real round is ~6 pairs; these only stop abuse. */
const MAX_PAIRS = 24;
const MAX_NOTES = 4000;

function isTeam(v: unknown): v is DraftTeam {
  return v === "teamA" || v === "teamB";
}

/** Deterministic plan doc id: one plan per round per team. */
export function planDocId(roundId: string, team: DraftTeam): string {
  return `${roundId}__${team}`;
}

/**
 * Captain/co-captain of `team`, or any admin: save that team's pairing plan for
 * a round. Overwrites the team's single plan doc, so two people editing at once
 * is last-write-wins; the UI warns when someone else has saved.
 */
export const savePairingPlan = onCall(async (request) => {
  const { roundId, team, pairs, notes } = request.data || {};
  if (!roundId || typeof roundId !== "string") throw new HttpsError("invalid-argument", "Missing roundId");
  if (!isTeam(team)) throw new HttpsError("invalid-argument", "team must be 'teamA' or 'teamB'");
  if (!Array.isArray(pairs)) throw new HttpsError("invalid-argument", "pairs must be an array");
  if (pairs.length > MAX_PAIRS) throw new HttpsError("invalid-argument", "Too many pairs");
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

  const { playerId } = await requireCaptainOrAdmin(
    request,
    "savePairingPlan",
    { maxCalls: 60, windowSeconds: 60 },
    tournamentId,
    team
  );

  const tSnap = await db().collection("tournaments").doc(tournamentId).get();
  if (!tSnap.exists) throw new HttpsError("not-found", "Tournament not found");
  const t = tSnap.data()!;

  // Validate against the team's ROSTER, not the round's available list: a plan
  // is often written before availability is staged, and a benched player in a
  // saved plan is a UI warning, not a reason to reject the save.
  const roster = new Set<string>();
  const tierByPlayer: Record<string, string> = {};
  const rosterByTier = (t[team]?.rosterByTier || {}) as Record<string, string[]>;
  for (const tier of TIERS) {
    for (const pid of rosterByTier[tier] ?? []) {
      roster.add(pid);
      tierByPlayer[pid] = tier;
    }
  }

  const playersPerSide = draftPlayersPerSide(format);
  const seen = new Set<string>();
  const cleanPairs: string[][] = [];
  for (const pair of pairs) {
    if (!Array.isArray(pair)) throw new HttpsError("invalid-argument", "Each pair must be an array of player ids");
    if (pair.length > playersPerSide) {
      throw new HttpsError("invalid-argument", `A pairing holds at most ${playersPerSide} player(s)`);
    }
    const ids = pair.map(String);
    for (const pid of ids) {
      if (!roster.has(pid)) throw new HttpsError("invalid-argument", `Player ${pid} is not on this team's roster`);
      if (seen.has(pid)) throw new HttpsError("invalid-argument", "A player can only appear in one pairing");
      seen.add(pid);
    }
    // Same A/A + D/D rule the live draft enforces — only once a pair is full,
    // so a half-filled slot can still be saved mid-thought.
    if (ids.length === playersPerSide) {
      try {
        assertPairTiersAllowed(ids, tierByPlayer);
      } catch (e) {
        if (e instanceof DraftError) throw new HttpsError("failed-precondition", e.message);
        throw e;
      }
    }
    cleanPairs.push(ids);
  }

  // Re-derived on every save, so adding a co-captain or an admin grants access
  // to plans that already exist the next time one is saved.
  const authorizedUids = await planReaderUids(t, team);

  // Full overwrite: the plan is a single small doc the captain re-saves as a
  // whole, so there's nothing to merge and no history to preserve.
  await db()
    .collection("pairingPlans")
    .doc(planDocId(roundId, team))
    .set({
      roundId,
      tournamentId,
      team,
      pairs: cleanPairs,
      notes: typeof notes === "string" ? notes : "",
      authorizedUids,
      updatedBy: playerId,
      updatedAt: FieldValue.serverTimestamp(),
    });

  return { success: true };
});
