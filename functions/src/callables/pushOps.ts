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
import { getMessaging } from "firebase-admin/messaging";
import { info } from "firebase-functions/logger";
import { requireAdmin, requirePlayer } from "../helpers/adminAuth.js";
import { tokensToPrune } from "../messaging/notify.js";
import type { NotificationCategory } from "../types.js";

function db() {
  return getFirestore();
}

/** Admin diagnostic: recipients always come from the caller, never request data. */
export const sendTestPush = onCall({ timeoutSeconds: 60 }, async (request: CallableRequest) => {
  const { playerId } = await requireAdmin(request, "sendTestPush", { maxCalls: 3, windowSeconds: 60 });
  // Give the caller time to put the PWA in the background. Foreground pushes
  // appear as in-app toasts, rather than system notifications.
  await new Promise<void>((resolve) => setTimeout(resolve, 10_000));
  const snap = await db().collection("pushTokens").where("playerId", "==", playerId).get();
  const tokens = [...new Set(snap.docs.map((doc) => doc.data().token)
    .filter((token): token is string => typeof token === "string" && token.length > 0))];
  if (!tokens.length) {
    throw new HttpsError("failed-precondition", "No registered devices found. Turn notifications off and back on, then retry.");
  }
  let accepted = 0;
  const errors = new Set<string>();
  const dead: string[] = [];
  for (let i = 0; i < tokens.length; i += 500) {
    const chunk = tokens.slice(i, i + 500);
    const result = await getMessaging().sendEachForMulticast({
      tokens: chunk,
      data: {
        title: "Rowdy Cup test notification",
        body: "Push notifications are working on this device. Only you received this test.",
        link: "/settings/notifications",
        category: "test",
      },
    });
    accepted += result.successCount;
    result.responses.forEach((response) => {
      if (!response.success) errors.add(response.error?.code ?? "messaging/unknown-error");
    });
    dead.push(...tokensToPrune(result.responses, chunk));
  }
  // Drop tokens FCM says are permanently dead (same rule notify() applies), so a
  // leftover from an old install doesn't keep failing every future test.
  if (dead.length > 0) {
    const batch = db().batch();
    dead.forEach((token) => batch.delete(db().collection("pushTokens").doc(token)));
    await batch.commit();
  }
  // FCM acceptance is not proof that the phone displayed a notification.
  const result = { accepted, failed: tokens.length - accepted, errors: [...errors], pruned: dead.length };
  info("Admin test push result", { playerId, ...result });
  return result;
});

/** Categories a player may toggle; anything else in the payload is ignored. */
const NOTIFICATION_CATEGORIES: NotificationCategory[] = [
  "chat",
  "sportsbook",
  "matchResult",
  "matchLeadChange",
  "tournament",
];

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

/** FCM error codes meaning the token is permanently dead (see tokensToPrune). */
const DEAD_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
]);

/**
 * Ask FCM whether a token is still deliverable, without delivering anything (a
 * dry-run send). Only a definitive "dead" answer returns false — a transient or
 * unknown error counts as alive so we never churn a working device.
 */
async function isTokenAlive(token: string): Promise<boolean> {
  try {
    await getMessaging().send({ token, data: { category: "validate" } }, true);
    return true;
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    return !(code && DEAD_TOKEN_CODES.has(code));
  }
}

/**
 * Register (or refresh) the calling player's device token for web push.
 *
 * Returns `valid: false` (and stores nothing) when FCM says the token is dead —
 * iOS can kill a subscription on Apple's side while the device still believes
 * in it, so the client calls this on every launch and re-subscribes on false.
 */
export const registerPushToken = onCall(async (request: CallableRequest) => {
  const { playerId } = await requirePlayer(request, "registerPushToken", { maxCalls: 30, windowSeconds: 60 });
  const token = requireToken(request.data);
  const userAgent = (request.data as { userAgent?: unknown } | null)?.userAgent;
  // Set only when the player just turned notifications on (not on the silent
  // launch-time refresh): confirm with a real push to this one device.
  const confirm = (request.data as { confirm?: unknown } | null)?.confirm === true;
  const ref = db().collection("pushTokens").doc(token);

  if (!(await isTokenAlive(token))) {
    await ref.delete();
    info("Dead push token rejected at registration", { playerId });
    return { success: true, valid: false };
  }

  await ref.set(
    {
      token,
      playerId,
      userAgent: typeof userAgent === "string" ? userAgent.slice(0, 512) : null,
      createdAt: FieldValue.serverTimestamp(),
      lastSeenAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  if (!confirm) return { success: true, valid: true };

  // Best-effort: a failed confirmation must not fail the registration. The
  // client falls back to an in-app message when `confirmed` is false.
  let confirmed = false;
  try {
    await getMessaging().send({
      token,
      data: {
        title: "Notifications are on 🎉",
        body: "You'll get Rowdy Cup alerts on this device.",
        link: "/settings/notifications",
        category: "welcome",
      },
    });
    confirmed = true;
  } catch (err) {
    info("Enable-confirmation push failed", { playerId, code: (err as { code?: string } | null)?.code ?? "unknown" });
  }
  return { success: true, valid: true, confirmed };
});

/** Remove a device token (the menu "turn off" action, or a sign-out cleanup). */
export const unregisterPushToken = onCall(async (request: CallableRequest) => {
  await requirePlayer(request, "unregisterPushToken", { maxCalls: 30, windowSeconds: 60 });
  const token = requireToken(request.data);
  await db().collection("pushTokens").doc(token).delete();
  return { success: true };
});

/**
 * Save the calling player's per-category notification preferences onto their
 * player doc (players/{id}.notificationPrefs). A callable (not a client write +
 * rule) keeps the player doc server-write-locked — the security rule deliberately
 * restricts client self-writes to account-linking fields to block privilege
 * escalation. Unknown keys / non-boolean values are dropped; the client sends the
 * full map on each save. Delivery uses these via messaging/notify.ts.
 */
export const setNotificationPrefs = onCall(async (request: CallableRequest) => {
  const { playerId } = await requirePlayer(request, "setNotificationPrefs", { maxCalls: 30, windowSeconds: 60 });
  const raw = (request.data as { prefs?: unknown } | null)?.prefs;
  if (!raw || typeof raw !== "object") {
    throw new HttpsError("invalid-argument", "Missing prefs");
  }
  const prefs: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (NOTIFICATION_CATEGORIES.includes(key as NotificationCategory) && typeof value === "boolean") {
      prefs[key] = value;
    }
  }
  await db().collection("players").doc(playerId).set({ notificationPrefs: prefs }, { merge: true });
  return { success: true };
});
