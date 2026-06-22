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
import { matchPlayerIds, tournamentPlayerIds } from "../helpers/roster.js";
import { notify, resolveCommentRecipients } from "../messaging/notify.js";
import type { CommentThreadType } from "../types.js";

function db() {
  return getFirestore();
}

const MAX_COMMENT_LENGTH = 1000;

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

/**
 * Create a one-level reply under a top-level comment: written to that comment's
 * `replies` subcollection, bumping its denormalized `replyCount`. Replies can't
 * have replies — the parent is looked up in the top-level `comments` collection,
 * so a reply id (which lives in a subcollection) can never be a parent.
 */
async function postReply(args: {
  playerId: string;
  authorName: string;
  tournamentId: string;
  threadType: CommentThreadType;
  threadId: string;
  parentId: string;
  text: string;
}): Promise<{ success: true; commentId: string }> {
  const { playerId, authorName, tournamentId, threadType, threadId, parentId, text } = args;
  const parentRef = db().collection("comments").doc(parentId);
  const replyRef = parentRef.collection("replies").doc();

  let parentAuthorId = "";
  await db().runTransaction(async (tx) => {
    const parentSnap = await tx.get(parentRef);
    if (!parentSnap.exists) throw new HttpsError("not-found", "Comment not found");
    const parent = parentSnap.data()!;
    if (parent.parentId) throw new HttpsError("failed-precondition", "You can only reply to a top-level comment");
    if (parent.tournamentId !== tournamentId || parent.threadType !== threadType || parent.threadId !== threadId) {
      throw new HttpsError("invalid-argument", "Reply target is not in this thread");
    }
    parentAuthorId = (parent.authorId as string) || "";
    tx.set(replyRef, {
      id: replyRef.id,
      parentId,
      tournamentId,
      threadType,
      threadId,
      authorId: playerId,
      authorName,
      text,
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.update(parentRef, { replyCount: FieldValue.increment(1) });
  });

  // Best-effort push to the parent author + everyone already in the sub-thread.
  try {
    const repliesSnap = await parentRef.collection("replies").get();
    const replierIds = repliesSnap.docs.map((d) => d.data().authorId as string);
    const recipients = [...new Set([parentAuthorId, ...replierIds])].filter((id) => !!id && id !== playerId);
    const preview = text.length > 80 ? `${text.slice(0, 79)}…` : text;
    await notify(recipients, {
      category: "chat",
      title: threadType === "sportsbook" ? "Sportsbook chat" : "Match chat",
      body: `${authorName} replied: ${preview}`,
      link: threadType === "sportsbook" ? "/sportsbook" : `/match/${threadId}`,
    });
  } catch (err) {
    console.error("postReply notify failed:", err);
  }

  return { success: true, commentId: replyRef.id };
}

/** Post a comment to a match thread or the sportsbook feed. */
export const postComment = onCall(async (request: CallableRequest) => {
  const { playerId } = await requirePlayer(request, "postComment", { maxCalls: 30, windowSeconds: 60 });

  const data = (request.data || {}) as Record<string, unknown>;
  const { tournamentId, threadType, threadId, text, parentId } = data;

  if (!tournamentId || typeof tournamentId !== "string") {
    throw new HttpsError("invalid-argument", "Missing tournamentId");
  }
  if (!isThreadType(threadType)) {
    throw new HttpsError("invalid-argument", "threadType must be 'match' or 'sportsbook'");
  }
  if (!threadId || typeof threadId !== "string") {
    throw new HttpsError("invalid-argument", "Missing threadId");
  }
  if (parentId !== undefined && (typeof parentId !== "string" || !parentId)) {
    throw new HttpsError("invalid-argument", "parentId must be a non-empty string");
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

  // A reply takes its own path: written to the parent's `replies` subcollection,
  // bumping the parent's denormalized count and pinging the sub-thread.
  if (typeof parentId === "string") {
    return postReply({ playerId, authorName, tournamentId, threadType, threadId, parentId, text: trimmed });
  }

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
    replyCount: 0,
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

/** Batch-delete every reply under a top-level comment (chunked for safety). */
async function deleteRepliesOf(parentRef: FirebaseFirestore.DocumentReference): Promise<void> {
  const replies = await parentRef.collection("replies").get();
  if (replies.empty) return;
  let batch = db().batch();
  let n = 0;
  for (const d of replies.docs) {
    batch.delete(d.ref);
    if (++n % 450 === 0) {
      await batch.commit();
      batch = db().batch();
    }
  }
  await batch.commit();
}

/**
 * Delete a comment or reply. The author may delete their own; admins may delete
 * any. Deleting a reply decrements its parent's count; deleting a top-level
 * comment cascades — its replies are removed too so none are left orphaned.
 */
export const deleteComment = onCall(async (request: CallableRequest) => {
  const { playerId, isAdmin } = await requirePlayer(request, "deleteComment", { maxCalls: 30, windowSeconds: 60 });
  const commentId = requireCommentId(request.data);
  const parentId = (request.data as { parentId?: unknown } | null)?.parentId;
  if (parentId !== undefined && (typeof parentId !== "string" || !parentId)) {
    throw new HttpsError("invalid-argument", "parentId must be a non-empty string");
  }

  // Reply: delete from the subcollection and decrement the parent's count.
  if (typeof parentId === "string") {
    const parentRef = db().collection("comments").doc(parentId);
    const replyRef = parentRef.collection("replies").doc(commentId);
    await db().runTransaction(async (tx) => {
      const [replySnap, parentSnap] = await Promise.all([tx.get(replyRef), tx.get(parentRef)]);
      if (!replySnap.exists) throw new HttpsError("not-found", "Comment not found");
      if (replySnap.data()!.authorId !== playerId && !isAdmin) {
        throw new HttpsError("permission-denied", "You can only delete your own comments");
      }
      tx.delete(replyRef);
      if (parentSnap.exists) tx.update(parentRef, { replyCount: FieldValue.increment(-1) });
    });
    return { success: true };
  }

  // Top-level: delete the comment, then cascade its replies.
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
  try {
    await deleteRepliesOf(ref);
  } catch (err) {
    console.error("cascade delete replies failed:", err);
  }

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
