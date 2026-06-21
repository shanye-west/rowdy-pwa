/**
 * Web-push fan-out for the Rowdy Cup app.
 *
 * `notify()` does two things for a set of recipient players:
 *   1. Writes a per-recipient in-app notification doc under
 *      players/{playerId}/notifications/{id} — this drives the notification bell
 *      + unread nav badges (read directly by the client; see firestore.rules).
 *   2. Sends a web push (FCM) to each of the recipients' registered devices and
 *      prunes any tokens FCM reports as dead.
 *
 * It is intentionally BEST-EFFORT: callers wrap it in try/catch so a messaging
 * failure can never fail the underlying comment/bet write. The recipient
 * resolution and dead-token detection are factored into the pure helpers
 * `resolveCommentRecipients` / `tokensToPrune` so they're unit-testable without
 * the emulator (see messaging/notify.test.ts).
 */

import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import type { NotificationCategory } from "../types.js";

function db() {
  return getFirestore();
}

/**
 * How long an in-app notification lives before Firestore auto-deletes it. Each
 * doc is stamped with `expireAt`; a TTL policy on the `notifications` collection
 * group (Firestore console → TTL) reaps expired docs server-side so history
 * self-cleans without any client/cron work. Players can still delete sooner from
 * the bell. Coarse cleanup only — TTL deletion can lag up to ~24h past expiry.
 */
const NOTIFICATION_TTL_DAYS = 30;

export interface NotifyPayload {
  category: NotificationCategory;
  title: string;
  body: string;
  /** App-relative deep link opened on tap, e.g. "/sportsbook" or "/match/abc". */
  link: string;
}

/**
 * Pure: which players should receive a comment notification. The author is
 * always excluded and the list is deduped. Match-thread comments notify that
 * match's players; sportsbook-feed comments notify the whole tournament roster.
 */
export function resolveCommentRecipients(
  threadType: "match" | "sportsbook",
  authorId: string,
  matchParticipantIds: string[],
  tournamentParticipantIds: string[]
): string[] {
  const base = threadType === "match" ? matchParticipantIds : tournamentParticipantIds;
  return [...new Set(base)].filter((id) => !!id && id !== authorId);
}

/** FCM error codes that mean a token is permanently dead and should be deleted. */
const PRUNABLE_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
]);

/**
 * Pure: given a multicast response and the tokens it was sent to (same order),
 * return the tokens FCM rejected as permanently invalid.
 */
export function tokensToPrune(
  responses: ReadonlyArray<{ success: boolean; error?: { code?: string } }>,
  tokens: ReadonlyArray<string>
): string[] {
  const dead: string[] = [];
  responses.forEach((r, i) => {
    const code = r.error?.code;
    if (!r.success && code && PRUNABLE_CODES.has(code) && tokens[i]) {
      dead.push(tokens[i]);
    }
  });
  return dead;
}

/** Load every registered device token for the given players (chunked `in` query). */
async function loadTokensForPlayers(playerIds: string[]): Promise<string[]> {
  const tokens: string[] = [];
  for (let i = 0; i < playerIds.length; i += 30) {
    const chunk = playerIds.slice(i, i + 30);
    if (chunk.length === 0) continue;
    const snap = await db().collection("pushTokens").where("playerId", "in", chunk).get();
    snap.docs.forEach((d) => {
      const token = d.data().token;
      if (typeof token === "string" && token) tokens.push(token);
    });
  }
  return tokens;
}

/**
 * Fan out a notification to recipients: write in-app history + send web push.
 * Best-effort; resolves even if messaging fails (errors are logged, not thrown).
 */
export async function notify(recipientPlayerIds: string[], payload: NotifyPayload): Promise<void> {
  const recipients = [...new Set(recipientPlayerIds)].filter(Boolean);
  if (recipients.length === 0) return;

  // 1. In-app notification history (bell + unread badges).
  const expireAt = Timestamp.fromMillis(Date.now() + NOTIFICATION_TTL_DAYS * 24 * 60 * 60 * 1000);
  const historyBatch = db().batch();
  for (const playerId of recipients) {
    const ref = db().collection("players").doc(playerId).collection("notifications").doc();
    historyBatch.set(ref, {
      id: ref.id,
      category: payload.category,
      title: payload.title,
      body: payload.body,
      link: payload.link,
      read: false,
      createdAt: FieldValue.serverTimestamp(),
      expireAt,
    });
  }
  await historyBatch.commit();

  // 2. Web push to each registered device. We send DATA-ONLY messages (no
  // `notification` payload) and render them ourselves in the service worker's
  // onBackgroundMessage / the client's onMessage. This is deliberate: a
  // `notification` payload would be auto-displayed by the SDK in the background
  // AND re-shown by our handler, producing duplicate notifications.
  const tokens = await loadTokensForPlayers(recipients);
  if (tokens.length === 0) return;

  const res = await getMessaging().sendEachForMulticast({
    tokens,
    data: {
      title: payload.title,
      body: payload.body,
      link: payload.link,
      category: payload.category,
    },
  });

  // 3. Prune dead tokens so we stop sending to uninstalled/expired devices.
  const dead = tokensToPrune(res.responses, tokens);
  if (dead.length > 0) {
    const pruneBatch = db().batch();
    dead.forEach((tok) => pruneBatch.delete(db().collection("pushTokens").doc(tok)));
    await pruneBatch.commit();
  }
}
