/**
 * Shared auth guard for admin-only callable functions.
 *
 * Admin status lives on the player document (`isAdmin: true`), which is keyed
 * by player id rather than auth uid, so security rules cannot enforce admin —
 * every admin callable must run this check server-side instead.
 */

import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import * as logger from "firebase-functions/logger";
import { checkRateLimit, type RateLimitConfig } from "../rateLimit.js";

/**
 * Custom auth claim carrying the caller's player id.
 *
 * Player docs are keyed by player id, so finding "who is calling" meant a
 * `players where authUid == uid` query — a billed read on EVERY player callable
 * (each bet, chat post, reaction, push toggle…). With the id on the ID token,
 * requirePlayer needs no read at all.
 *
 * Accounts fill themselves in: the first call without the claim does the query
 * and sets it; the client's token picks it up at its next refresh (≤ 1 hour).
 * linkAuthToPlayer / deletePlayer keep it in step.
 *
 * Accepted trade-off: after an admin relinks or deletes a player, an ID token
 * already issued keeps the old claim until it expires (≤ 1 hour), so the
 * previous account can act as that player in that window.
 *
 * Admin status is deliberately NOT a claim: requireAdmin always reads the
 * player doc, so revoking admin takes effect immediately.
 */
export const PLAYER_ID_CLAIM = "playerId";

/** The caller's player id from their token, if the claim is set. */
export function playerIdFromClaims(request: CallableRequest): string | null {
  const v = (request.auth?.token as Record<string, unknown> | undefined)?.[PLAYER_ID_CLAIM];
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * Set (or with null, remove) the player-id claim on an auth account, keeping
 * any other custom claims it has. Costs Auth API calls, not Firestore reads.
 */
export async function setPlayerIdClaim(uid: string, playerId: string | null): Promise<void> {
  const user = await getAuth().getUser(uid);
  const claims: Record<string, unknown> = { ...(user.customClaims ?? {}) };
  if (playerId) {
    if (claims[PLAYER_ID_CLAIM] === playerId) return;
    claims[PLAYER_ID_CLAIM] = playerId;
  } else {
    if (!(PLAYER_ID_CLAIM in claims)) return;
    delete claims[PLAYER_ID_CLAIM];
  }
  await getAuth().setCustomUserClaims(uid, Object.keys(claims).length > 0 ? claims : null);
}

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

/**
 * Verifies the caller is authenticated, within rate limits, and linked to a
 * player document (any player — no admin requirement). Used by the sportsbook
 * callables, where every action is taken by an ordinary logged-in player.
 *
 * @returns the caller's auth uid, matching player id, and an `isAdmin()` check.
 *   `isAdmin` is a function so the common case never pays for it: it reads the
 *   player doc only when a caller actually asks (e.g. deleting someone else's
 *   comment).
 */
export async function requirePlayer(
  request: CallableRequest,
  functionName: string,
  limits: RateLimitConfig
): Promise<{ uid: string; playerId: string; isAdmin: () => Promise<boolean> }> {
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

  // Fast path: the player id is on the token — no read.
  const claimed = playerIdFromClaims(request);
  if (claimed) {
    return {
      uid,
      playerId: claimed,
      isAdmin: async () => {
        const snap = await getFirestore().collection("players").doc(claimed).get();
        return snap.exists && snap.data()?.authUid === uid && !!snap.data()?.isAdmin;
      },
    };
  }

  const playerSnap = await getFirestore().collection("players").where("authUid", "==", uid).get();
  if (playerSnap.empty) {
    throw new HttpsError("permission-denied", "No player linked to this account");
  }
  const playerId = playerSnap.docs[0].id;
  const admin = !!playerSnap.docs[0].data().isAdmin;

  // Backfill the claim so this account's later calls skip the query. Never
  // fail the caller's request over it.
  try {
    await setPlayerIdClaim(uid, playerId);
  } catch (err) {
    logger.warn("setPlayerIdClaim failed", { uid, playerId, error: String(err) });
  }

  return { uid, playerId, isAdmin: async () => admin };
}
