/**
 * Callables for comments (match threads + the sportsbook trash-talk feed).
 *
 * Every action is taken by an ordinary logged-in player (resolved via
 * requirePlayer). All writes go through these callables — the `comments`
 * collection is locked to clients by the security rules. One generic collection
 * serves both surfaces via a (threadType, threadId) discriminator:
 *   - match thread:     threadType "match",      threadId = matchId
 *   - sportsbook feed:  threadType "sportsbook", threadId = `sb_${tournamentId}`
 */

import { onCall, HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { requirePlayer } from "../helpers/adminAuth.js";
import { notify, resolveCommentRecipients } from "../messaging/notify.js";
import type { CommentThreadType } from "../types.js";

function db() {
  return getFirestore();
}

const MAX_COMMENT_LENGTH = 1000;

/** Player ids playing in a match (both teams), from the match doc. */
function matchPlayerIds(m: FirebaseFirestore.DocumentData): string[] {
  const fromTeam = (team: unknown): string[] =>
    Array.isArray(team)
      ? team.map((p) => (p as { playerId?: unknown })?.playerId).filter((id): id is string => typeof id === "string")
      : [];
  return [...fromTeam(m.teamAPlayers), ...fromTeam(m.teamBPlayers)];
}

/** Every player on either team's roster for a tournament (deduped). */
async function tournamentPlayerIds(tournamentId: string): Promise<string[]> {
  const t = (await db().collection("tournaments").doc(tournamentId).get()).data();
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

/** Emoji reactions a comment may carry. Keep in sync with the UI palette. */
const REACTION_EMOJI = ["👍", "🔥", "😂", "⛳", "💀"] as const;

function isThreadType(v: unknown): v is CommentThreadType {
  return v === "match" || v === "sportsbook";
}

function requireCommentId(data: unknown): string {
  const commentId = (data as { commentId?: unknown } | null)?.commentId;
  if (!commentId || typeof commentId !== "string") {
    throw new HttpsError("invalid-argument", "Missing commentId");
  }
  return commentId;
}

/** Loads a tournament and asserts comments are enabled for it. */
async function requireCommentsTournament(tournamentId: string): Promise<void> {
  const snap = await db().collection("tournaments").doc(tournamentId).get();
  if (!snap.exists) throw new HttpsError("not-found", "Tournament not found");
  if (snap.data()?.commentsEnabled !== true) {
    throw new HttpsError("failed-precondition", "Comments are not enabled for this tournament");
  }
}

/** Post a comment to a match thread or the sportsbook feed. */
export const postComment = onCall(async (request: CallableRequest) => {
  const { playerId } = await requirePlayer(request, "postComment", { maxCalls: 30, windowSeconds: 60 });

  const data = (request.data || {}) as Record<string, unknown>;
  const { tournamentId, threadType, threadId, text } = data;

  if (!tournamentId || typeof tournamentId !== "string") {
    throw new HttpsError("invalid-argument", "Missing tournamentId");
  }
  if (!isThreadType(threadType)) {
    throw new HttpsError("invalid-argument", "threadType must be 'match' or 'sportsbook'");
  }
  if (!threadId || typeof threadId !== "string") {
    throw new HttpsError("invalid-argument", "Missing threadId");
  }
  if (typeof text !== "string") {
    throw new HttpsError("invalid-argument", "text must be a string");
  }
  const trimmed = text.trim();
  if (!trimmed) throw new HttpsError("invalid-argument", "Comment cannot be empty");
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    throw new HttpsError("invalid-argument", `Comment must be ${MAX_COMMENT_LENGTH} characters or fewer`);
  }

  await requireCommentsTournament(tournamentId);

  // Validate the thread target ties back to this tournament.
  let matchParticipants: string[] = [];
  if (threadType === "match") {
    const matchSnap = await db().collection("matches").doc(threadId).get();
    if (!matchSnap.exists) throw new HttpsError("not-found", "Match not found");
    const m = matchSnap.data()!;
    if (m.tournamentId && m.tournamentId !== tournamentId) {
      throw new HttpsError("invalid-argument", "Match is not in this tournament");
    }
    matchParticipants = matchPlayerIds(m);
  } else if (threadId !== `sb_${tournamentId}`) {
    throw new HttpsError("invalid-argument", "Invalid sportsbook thread");
  }

  // Denormalize the author's display name at post time.
  const playerSnap = await db().collection("players").doc(playerId).get();
  const authorName = (playerSnap.data()?.displayName as string | undefined) || playerId;

  const ref = db().collection("comments").doc();
  await ref.set({
    id: ref.id,
    tournamentId,
    threadType,
    threadId,
    authorId: playerId,
    authorName,
    text: trimmed,
    reactions: {},
    createdAt: FieldValue.serverTimestamp(),
  });

  // Best-effort push fan-out — a messaging failure must never fail the comment.
  try {
    const tournamentParticipants =
      threadType === "sportsbook" ? await tournamentPlayerIds(tournamentId) : [];
    const recipients = resolveCommentRecipients(threadType, playerId, matchParticipants, tournamentParticipants);
    const preview = trimmed.length > 80 ? `${trimmed.slice(0, 79)}…` : trimmed;
    await notify(recipients, {
      category: "chat",
      title: threadType === "sportsbook" ? "Sportsbook chat" : "Match chat",
      body: `${authorName}: ${preview}`,
      link: threadType === "sportsbook" ? "/sportsbook" : `/match/${threadId}`,
    });
  } catch (err) {
    console.error("postComment notify failed:", err);
  }

  return { success: true, commentId: ref.id };
});

/** Delete a comment. The author may delete their own; admins may delete any. */
export const deleteComment = onCall(async (request: CallableRequest) => {
  const { playerId, isAdmin } = await requirePlayer(request, "deleteComment", { maxCalls: 30, windowSeconds: 60 });
  const commentId = requireCommentId(request.data);
  const ref = db().collection("comments").doc(commentId);

  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Comment not found");
    const comment = snap.data()!;
    if (comment.authorId !== playerId && !isAdmin) {
      throw new HttpsError("permission-denied", "You can only delete your own comments");
    }
    tx.delete(ref);
  });

  return { success: true };
});

/** Toggle the caller's reaction with a given emoji on a comment. */
export const toggleReaction = onCall(async (request: CallableRequest) => {
  const { playerId } = await requirePlayer(request, "toggleReaction", { maxCalls: 60, windowSeconds: 60 });
  const commentId = requireCommentId(request.data);
  const emoji = (request.data as { emoji?: unknown } | null)?.emoji;
  if (typeof emoji !== "string" || !REACTION_EMOJI.includes(emoji as (typeof REACTION_EMOJI)[number])) {
    throw new HttpsError("invalid-argument", "Unsupported reaction");
  }
  const ref = db().collection("comments").doc(commentId);

  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Comment not found");
    const reactions = (snap.data()?.reactions ?? {}) as Record<string, string[]>;
    const current = reactions[emoji] ?? [];
    if (current.includes(playerId)) {
      const next = current.filter((id) => id !== playerId);
      if (next.length === 0) {
        tx.update(ref, { [`reactions.${emoji}`]: FieldValue.delete() });
      } else {
        tx.update(ref, { [`reactions.${emoji}`]: next });
      }
    } else {
      tx.update(ref, { [`reactions.${emoji}`]: [...current, playerId] });
    }
  });

  return { success: true };
});
