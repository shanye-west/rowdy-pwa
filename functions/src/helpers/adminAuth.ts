/**
 * Shared auth guard for admin-only callable functions.
 *
 * Admin status lives on the player document (`isAdmin: true`), which is keyed
 * by player id rather than auth uid, so security rules cannot enforce admin —
 * every admin callable must run this check server-side instead.
 */

import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { checkRateLimit, type RateLimitConfig } from "../rateLimit.js";

/**
 * Verifies the caller is authenticated, within rate limits, and an admin.
 * Throws the appropriate HttpsError otherwise.
 *
 * @returns the caller's auth uid and the matching player doc id
 */
export async function requireAdmin(
  request: CallableRequest,
  functionName: string,
  limits: RateLimitConfig
): Promise<{ uid: string; playerId: string }> {
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

  const playerSnap = await getFirestore().collection("players").where("authUid", "==", uid).get();
  if (playerSnap.empty || !playerSnap.docs[0].data().isAdmin) {
    throw new HttpsError("permission-denied", "Admin access required");
  }

  return { uid, playerId: playerSnap.docs[0].id };
}
