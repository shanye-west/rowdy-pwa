/**
 * Callables for managing a player's web-push device tokens.
 *
 * Every action is taken by an ordinary logged-in player (resolved via
 * requirePlayer). Tokens live in the top-level `pushTokens` collection keyed by
 * the token itself; that collection has NO security rule, so clients can't read
 * or write it directly — only these callables, via the Admin SDK. The notify()
 * fan-out (messaging/notify.ts) reads tokens here to deliver web push.
 */

import { onCall, HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { requirePlayer } from "../helpers/adminAuth.js";

function db() {
  return getFirestore();
}

/** Validate and return the FCM registration token from the request. */
function requireToken(data: unknown): string {
  const token = (data as { token?: unknown } | null)?.token;
  // FCM tokens are ~150-300 chars; cap generously and reject anything with a
  // slash so it's always a valid Firestore document id.
  if (!token || typeof token !== "string" || token.length > 4096 || token.includes("/")) {
    throw new HttpsError("invalid-argument", "Missing or invalid token");
  }
  return token;
}

/** Register (or refresh) the calling player's device token for web push. */
export const registerPushToken = onCall(async (request: CallableRequest) => {
  const { playerId } = await requirePlayer(request, "registerPushToken", { maxCalls: 30, windowSeconds: 60 });
  const token = requireToken(request.data);
  const userAgent = (request.data as { userAgent?: unknown } | null)?.userAgent;

  await db()
    .collection("pushTokens")
    .doc(token)
    .set(
      {
        token,
        playerId,
        userAgent: typeof userAgent === "string" ? userAgent.slice(0, 512) : null,
        createdAt: FieldValue.serverTimestamp(),
        lastSeenAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

  return { success: true };
});

/** Remove a device token (the menu "turn off" action, or a sign-out cleanup). */
export const unregisterPushToken = onCall(async (request: CallableRequest) => {
  await requirePlayer(request, "unregisterPushToken", { maxCalls: 30, windowSeconds: 60 });
  const token = requireToken(request.data);
  await db().collection("pushTokens").doc(token).delete();
  return { success: true };
});
