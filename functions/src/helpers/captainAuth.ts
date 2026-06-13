/**
 * Auth guard for the pairings draft: allows a tournament admin OR the
 * captain/co-captain of the team the caller is acting for.
 *
 * Like admin status, captain status lives on data keyed by player id (the
 * tournament's `teamX.captainId` / `coCaptainId`), so security rules can't
 * enforce it — these checks run server-side in the draft callables.
 */

import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { checkRateLimit, type RateLimitConfig } from "../rateLimit.js";

type TeamKey = "teamA" | "teamB";

/**
 * Verifies the caller is authenticated, within rate limits, and either an admin
 * or a captain/co-captain of `team` in `tournamentId`.
 *
 * @returns the caller's auth uid, matching player id, and admin flag
 */
export async function requireCaptainOrAdmin(
  request: CallableRequest,
  functionName: string,
  limits: RateLimitConfig,
  tournamentId: string,
  team: TeamKey
): Promise<{ uid: string; playerId: string; isAdmin: boolean }> {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Must be logged in");
  }

  const rateLimit = checkRateLimit(uid, functionName, limits);
  if (!rateLimit.allowed) {
    throw new HttpsError(
      "resource-exhausted",
      `Rate limit exceeded. Try again in ${Math.ceil((rateLimit.resetAt - Date.now()) / 1000)}s`
    );
  }

  const db = getFirestore();
  const playerSnap = await db.collection("players").where("authUid", "==", uid).get();
  if (playerSnap.empty) {
    throw new HttpsError("permission-denied", "No player linked to this account");
  }
  const playerDoc = playerSnap.docs[0];
  const playerId = playerDoc.id;
  if (playerDoc.data().isAdmin) {
    return { uid, playerId, isAdmin: true };
  }

  const tournamentSnap = await db.collection("tournaments").doc(tournamentId).get();
  if (!tournamentSnap.exists) {
    throw new HttpsError("not-found", "Tournament not found");
  }
  const teamData = tournamentSnap.data()?.[team] as { captainId?: string; coCaptainId?: string } | undefined;
  const captains = new Set([teamData?.captainId, teamData?.coCaptainId].filter(Boolean) as string[]);
  if (!captains.has(playerId)) {
    throw new HttpsError("permission-denied", "Captain access required for this team");
  }

  return { uid, playerId, isAdmin: false };
}
