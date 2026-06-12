/**
 * Admin-only callables for creating/editing matches and recalculating their
 * stroke allocations. Moved from index.ts; the deployed function names are
 * unchanged (index.ts re-exports these under the same export names).
 *
 * All writes go through the Admin SDK, which bypasses security rules — every
 * callable must start with requireAdmin().
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { requireAdmin } from "../helpers/adminAuth.js";
import { computeTeamsWithStrokes, type CourseForStrokes, type ResolvedPlayer } from "../helpers/strokeCalculation.js";
import { ensureTournamentTeamColors } from "../utils/teamColors.js";

function db() {
  return getFirestore();
}

interface PlayerPayload {
  playerId: string;
  handicapIndex?: unknown;
}

/** Round's course with the 18-hole invariant enforced (shared by all three callables). */
async function fetchCourseForRound(roundId: string): Promise<{ courseId: string; course: CourseForStrokes }> {
  const roundDoc = await db().collection("rounds").doc(roundId).get();
  if (!roundDoc.exists) {
    throw new HttpsError("not-found", "Round not found");
  }
  const courseId = roundDoc.data()!.courseId;
  if (!courseId) {
    throw new HttpsError("failed-precondition", "Round does not have a courseId");
  }

  const courseDoc = await db().collection("courses").doc(courseId).get();
  if (!courseDoc.exists) {
    throw new HttpsError("not-found", "Course not found");
  }
  const course = courseDoc.data() as CourseForStrokes;
  if ((course.holes || []).length !== 18) {
    throw new HttpsError("failed-precondition", "Course must have 18 holes");
  }
  return { courseId, course };
}

/** Tournament handicap maps used as fallback when the caller omits handicapIndex. */
async function fetchTournamentHandicaps(tournamentId: string): Promise<{
  teamAHandicaps: Record<string, number>;
  teamBHandicaps: Record<string, number>;
}> {
  const tournamentDoc = await db().collection("tournaments").doc(tournamentId).get();
  const teamAHandicaps: Record<string, number> = {};
  const teamBHandicaps: Record<string, number> = {};
  if (tournamentDoc.exists) {
    const t = ensureTournamentTeamColors(tournamentDoc.data()! as any) as any;
    if (t.teamA?.handicapByPlayer) Object.assign(teamAHandicaps, t.teamA.handicapByPlayer);
    if (t.teamB?.handicapByPlayer) Object.assign(teamBHandicaps, t.teamB.handicapByPlayer);
  }
  return { teamAHandicaps, teamBHandicaps };
}

/** Caller-provided handicapIndex wins; otherwise either team map (seed/edit behavior). */
function resolveWithFallback(
  players: PlayerPayload[],
  teamAHandicaps: Record<string, number>,
  teamBHandicaps: Record<string, number>
): ResolvedPlayer[] {
  return players.map((p) => ({
    playerId: p.playerId,
    handicapIndex:
      p && typeof p.handicapIndex === "number"
        ? p.handicapIndex
        : (teamAHandicaps[p.playerId] ?? teamBHandicaps[p.playerId] ?? 0),
  }));
}

/** Accepts ISO strings, serialized timestamps, or Timestamp instances. */
function parseTeeTime(teeTime: unknown): Timestamp | null {
  if (!teeTime) return null;
  if (typeof teeTime === "string") {
    const date = new Date(teeTime);
    return isNaN(date.getTime()) ? null : Timestamp.fromDate(date);
  }
  if (teeTime instanceof Timestamp) return teeTime;
  if (typeof teeTime === "object" && "_seconds" in teeTime) {
    const t = teeTime as { _seconds: number; _nanoseconds?: number };
    return Timestamp.fromMillis(t._seconds * 1000 + (t._nanoseconds || 0) / 1000000);
  }
  return null;
}

/**
 * Admin-only function to create a match with calculated strokesReceived.
 *
 * Data payload:
 * - id: string - Match document ID
 * - tournamentId: string
 * - roundId: string
 * - teeTime?: string | Timestamp
 * - teamAPlayers: Array<{ playerId: string, handicapIndex?: number }>
 * - teamBPlayers: Array<{ playerId: string, handicapIndex?: number }>
 * - matchNumber?: number
 */
export const seedMatch = onCall(async (request) => {
  await requireAdmin(request, "seedMatch", { maxCalls: 20, windowSeconds: 60 });

  const { id, tournamentId, roundId, teeTime, teamAPlayers, teamBPlayers } = request.data;

  if (!id || !tournamentId || !roundId || !teamAPlayers || !teamBPlayers) {
    throw new HttpsError("invalid-argument", "Missing required fields");
  }
  if (!Array.isArray(teamAPlayers) || !Array.isArray(teamBPlayers)) {
    throw new HttpsError("invalid-argument", "teamAPlayers and teamBPlayers must be arrays");
  }

  const { course } = await fetchCourseForRound(roundId);
  const { teamAHandicaps, teamBHandicaps } = await fetchTournamentHandicaps(tournamentId);

  const { teamAPlayersWithStrokes, teamBPlayersWithStrokes, courseHandicaps } = computeTeamsWithStrokes(
    resolveWithFallback(teamAPlayers, teamAHandicaps, teamBHandicaps),
    resolveWithFallback(teamBPlayers, teamAHandicaps, teamBHandicaps),
    course
  );

  const teeTimeTimestamp = parseTeeTime(teeTime);

  // Determine matchNumber: if caller provided `matchNumber` use it, otherwise
  // compute the lowest available positive integer for this round.
  let matchNumberToUse: number = request.data?.matchNumber ?? 0;
  if (!matchNumberToUse || typeof matchNumberToUse !== "number" || matchNumberToUse <= 0) {
    const existingSnaps = await db().collection("matches").where("roundId", "==", roundId).get();
    const nums = existingSnaps.docs.map((d) => Number(d.data()?.matchNumber) || 0).filter((n) => n > 0);
    let candidate = 1;
    const numSet = new Set(nums);
    while (numSet.has(candidate)) candidate++;
    matchNumberToUse = candidate;
  }

  // Fetch player auth UIDs for security rules optimization
  const allPlayerIds = [...teamAPlayers, ...teamBPlayers].map((p: PlayerPayload) => p.playerId);
  const authorizedUids: string[] = [];
  for (const playerId of allPlayerIds) {
    const pSnap = await db().collection("players").doc(playerId).get();
    if (pSnap.exists) {
      const authUid = pSnap.data()?.authUid;
      if (authUid) authorizedUids.push(authUid);
    }
  }

  const matchDoc = {
    id,
    tournamentId,
    roundId,
    matchNumber: matchNumberToUse,
    teeTime: teeTimeTimestamp,
    teamAPlayers: teamAPlayersWithStrokes,
    teamBPlayers: teamBPlayersWithStrokes,
    courseHandicaps,
    authorizedUids, // Store UIDs directly for efficient security rules
    holes: {},
    status: {
      leader: null,
      margin: 0,
      thru: 0,
      dormie: false,
      closed: false,
    },
    result: {},
  };

  await db().collection("matches").doc(id).set(matchDoc);

  return { success: true, matchId: id };
});

/**
 * Admin-only function to edit an existing match (players, round, tee time);
 * recalculates strokesReceived.
 *
 * Data payload:
 * - matchId: string
 * - tournamentId: string
 * - roundId: string
 * - teeTime?: string (ISO datetime format)
 * - teamAPlayers: Array<{ playerId: string, handicapIndex?: number }>
 * - teamBPlayers: Array<{ playerId: string, handicapIndex?: number }>
 */
export const editMatch = onCall(async (request) => {
  await requireAdmin(request, "editMatch", { maxCalls: 30, windowSeconds: 60 });

  const { matchId, tournamentId, roundId, teeTime, teamAPlayers, teamBPlayers } = request.data;

  if (!matchId || !tournamentId || !roundId || !teamAPlayers || !teamBPlayers) {
    throw new HttpsError("invalid-argument", "Missing required fields");
  }
  if (!Array.isArray(teamAPlayers) || !Array.isArray(teamBPlayers)) {
    throw new HttpsError("invalid-argument", "teamAPlayers and teamBPlayers must be arrays");
  }

  const matchDoc = await db().collection("matches").doc(matchId).get();
  if (!matchDoc.exists) {
    throw new HttpsError("not-found", "Match not found");
  }

  const { course } = await fetchCourseForRound(roundId);
  const { teamAHandicaps, teamBHandicaps } = await fetchTournamentHandicaps(tournamentId);

  const { teamAPlayersWithStrokes, teamBPlayersWithStrokes, courseHandicaps } = computeTeamsWithStrokes(
    resolveWithFallback(teamAPlayers, teamAHandicaps, teamBHandicaps),
    resolveWithFallback(teamBPlayers, teamAHandicaps, teamBHandicaps),
    course
  );

  const updates: Record<string, unknown> = {
    tournamentId,
    roundId,
    teamAPlayers: teamAPlayersWithStrokes,
    teamBPlayers: teamBPlayersWithStrokes,
    courseHandicaps,
  };

  // Only update teeTime if provided
  const teeTimeTimestamp = parseTeeTime(teeTime);
  if (teeTimeTimestamp) {
    updates.teeTime = teeTimeTimestamp;
  }

  await db().collection("matches").doc(matchId).update(updates);

  return { success: true, matchId };
});

/**
 * Admin-only function to recalculate strokesReceived for an existing match
 * using the tournament's *current* handicap indexes (no caller overrides —
 * the point is to re-sync the match with the tournament map).
 *
 * Data payload:
 * - matchId: string
 */
export const recalculateMatchStrokes = onCall(async (request) => {
  await requireAdmin(request, "recalculateMatchStrokes", { maxCalls: 10, windowSeconds: 60 });

  const { matchId } = request.data;
  if (!matchId) {
    throw new HttpsError("invalid-argument", "Missing matchId");
  }

  const matchDoc = await db().collection("matches").doc(matchId).get();
  if (!matchDoc.exists) {
    throw new HttpsError("not-found", "Match not found");
  }

  const match = matchDoc.data()!;
  const tournamentId = match.tournamentId;
  const roundId = match.roundId;
  if (!tournamentId || !roundId) {
    throw new HttpsError("failed-precondition", "Match missing tournamentId or roundId");
  }

  const tournamentDoc = await db().collection("tournaments").doc(tournamentId).get();
  if (!tournamentDoc.exists) {
    throw new HttpsError("not-found", "Tournament not found");
  }
  const tournament = tournamentDoc.data()!;
  const teamAHandicaps: Record<string, number> = tournament.teamA?.handicapByPlayer || {};
  const teamBHandicaps: Record<string, number> = tournament.teamB?.handicapByPlayer || {};

  const { course } = await fetchCourseForRound(roundId);

  // Per-team maps only — unlike seed/edit there is no cross-team fallback
  const teamAPlayers: PlayerPayload[] = match.teamAPlayers || [];
  const teamBPlayers: PlayerPayload[] = match.teamBPlayers || [];
  const { teamAPlayersWithStrokes, teamBPlayersWithStrokes, courseHandicaps } = computeTeamsWithStrokes(
    teamAPlayers.map((p) => ({ playerId: p.playerId, handicapIndex: teamAHandicaps[p.playerId] ?? 0 })),
    teamBPlayers.map((p) => ({ playerId: p.playerId, handicapIndex: teamBHandicaps[p.playerId] ?? 0 })),
    course
  );

  await db().collection("matches").doc(matchId).update({
    teamAPlayers: teamAPlayersWithStrokes,
    teamBPlayers: teamBPlayersWithStrokes,
    courseHandicaps,
  });

  return { success: true, matchId, courseHandicaps };
});
