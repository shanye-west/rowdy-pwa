/**
 * Comments data hooks (match threads + the sportsbook trash-talk feed).
 *
 * Two layers:
 *  - `useComments(threadId)` is the raw subscription, bounded to the newest
 *    PAGE_SIZE messages (a `threadId`-filtered onSnapshot ordered newest-first,
 *    reversed to oldest-first for display since a thread reads top-to-bottom).
 *    Older history loads on demand via cursor-based one-time reads (`loadOlder`),
 *    so reads/renders stay bounded as the thread grows. The ordered query needs a
 *    `(threadId, createdAt DESC)` composite index.
 *  - `useCommentThread(...)` wraps that subscription with *optimistic* post /
 *    react / delete. Writes go through Cloud Function callables (the `comments`
 *    collection is locked to clients), so a naive UI waits a full round-trip —
 *    including cold starts — before anything shows. Instead we apply the change
 *    locally first and reconcile against the next server snapshot, rolling back
 *    on failure. This is what makes the thread feel instant.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  onSnapshot,
  getDocs,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { db } from "../firebase";
import { commentsApi } from "../api/comments";
import { useAuth } from "../contexts/AuthContext";
import { toDateOrNull } from "../utils";
import type { CommentDoc, CommentThreadType } from "../types";

/** Emoji reactions a comment may carry. Keep in sync with commentOps.ts. */
export const REACTION_EMOJI = ["👍", "🔥", "😂", "⛳", "💀"] as const;

/** Newest messages kept on the live listener; also the older-page size. */
const PAGE_SIZE = 50;

export interface UseCommentsResult {
  comments: CommentDoc[];
  loading: boolean;
  error: string | null;
  /** True while older history may still exist below the loaded window. */
  hasMore: boolean;
  /** True while an older page is being fetched. */
  loadingOlder: boolean;
  /** Pull the next older page (one-time read); no-op if none remain or already loading. */
  loadOlder: () => void;
}

/**
 * Subscribe to a comment thread, oldest first, bounded to the newest PAGE_SIZE
 * messages. Older history is pulled on demand via cursor-based one-time reads
 * (`loadOlder`) — the live listener only ever carries the newest page, so reads
 * and renders stay bounded no matter how large the thread grows (mirrors the
 * live/settled split in useBets). Trade-off: a reaction/delete on a message that
 * has scrolled out of the newest-PAGE_SIZE live window (i.e. only present via a
 * loaded older page) won't update in real time until the thread is reopened.
 */
export function useComments(threadId: string | undefined): UseCommentsResult {
  const [liveDocs, setLiveDocs] = useState<CommentDoc[]>([]);
  const [olderDocs, setOlderDocs] = useState<CommentDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [reachedEnd, setReachedEnd] = useState(false);
  const [liveFull, setLiveFull] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Oldest snapshot in each region, kept as `startAfter` cursors for loadOlder.
  const liveOldestRef = useRef<QueryDocumentSnapshot | null>(null);
  const olderOldestRef = useRef<QueryDocumentSnapshot | null>(null);

  useEffect(() => {
    // Reset paged state whenever the thread changes.
    setOlderDocs([]);
    setReachedEnd(false);
    olderOldestRef.current = null;
    liveOldestRef.current = null;

    if (!threadId) {
      setLiveDocs([]);
      setLiveFull(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = onSnapshot(
      query(
        collection(db, "comments"),
        where("threadId", "==", threadId),
        orderBy("createdAt", "desc"),
        limit(PAGE_SIZE)
      ),
      (snap) => {
        // Query is newest-first; reverse to oldest-first for display.
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() } as CommentDoc)).reverse();
        liveOldestRef.current = snap.docs.length ? snap.docs[snap.docs.length - 1] : null;
        setLiveFull(snap.docs.length >= PAGE_SIZE);
        setLiveDocs(rows);
        setLoading(false);
      },
      (err) => {
        console.error("Comments subscription error:", err);
        setError("Unable to load comments.");
        setLoading(false);
      }
    );
    return () => unsub();
  }, [threadId]);

  const loadOlder = useCallback(() => {
    if (!threadId || loadingOlder || reachedEnd) return;
    const cursor = olderOldestRef.current ?? liveOldestRef.current;
    if (!cursor) return;
    setLoadingOlder(true);
    getDocs(
      query(
        collection(db, "comments"),
        where("threadId", "==", threadId),
        orderBy("createdAt", "desc"),
        startAfter(cursor),
        limit(PAGE_SIZE)
      )
    )
      .then((snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() } as CommentDoc)).reverse();
        if (snap.docs.length) olderOldestRef.current = snap.docs[snap.docs.length - 1];
        if (snap.docs.length < PAGE_SIZE) setReachedEnd(true);
        // Prepend: older rows sort ahead of everything already loaded.
        setOlderDocs((prev) => [...rows, ...prev]);
      })
      .catch((err) => console.error("Older comments fetch error:", err))
      .finally(() => setLoadingOlder(false));
  }, [threadId, loadingOlder, reachedEnd]);

  // Common case (no older pages loaded): the live window is already sorted asc.
  // Otherwise merge, deduping by id with the live (fresher) copy winning, since a
  // deletion can slide an already-loaded older message back into the live window.
  const comments = useMemo(() => {
    if (olderDocs.length === 0) return liveDocs;
    const byId = new Map<string, CommentDoc>();
    for (const c of olderDocs) byId.set(c.id, c);
    for (const c of liveDocs) byId.set(c.id, c);
    return [...byId.values()].sort((a, b) => commentMillis(a) - commentMillis(b));
  }, [olderDocs, liveDocs]);

  return { comments, loading, error, hasMore: liveFull && !reachedEnd, loadingOlder, loadOlder };
}

// ============================================================================
// OPTIMISTIC CONTROLLER
// ============================================================================

/** A comment shaped for rendering. `pending` marks a local post still in flight. */
export type DisplayComment = CommentDoc & { pending?: boolean };

/** A locally-added post awaiting (and then reconciling against) the snapshot. */
interface PendingPost {
  tempId: string;
  realId?: string; // set once postComment returns its id
  authorId: string;
  authorName: string;
  text: string;
  createdAt: Date;
}

export interface UseCommentThreadResult {
  comments: DisplayComment[];
  loading: boolean;
  error: string | null;
  /** True while older history may still exist below the loaded window. */
  hasMore: boolean;
  /** True while an older page is being fetched. */
  loadingOlder: boolean;
  /** Pull the next older page of history (one-time read). */
  loadOlder: () => void;
  /** True once a player is logged in and can post/react. */
  canInteract: boolean;
  /** Optimistically post; resolves when the server accepts, rejects (after rollback) otherwise. */
  post: (text: string) => Promise<void>;
  /** Optimistically toggle the caller's reaction; rejects (after rollback) on failure. */
  react: (commentId: string, emoji: string) => Promise<void>;
  /** Optimistically delete; rejects (after rollback) on failure. */
  remove: (commentId: string) => Promise<void>;
  /** Whether the caller may delete a given comment (author or admin). */
  canDelete: (comment: CommentDoc) => boolean;
}

export interface UseCommentThreadArgs {
  tournamentId: string;
  threadType: CommentThreadType;
  threadId: string;
}

const reactionKey = (commentId: string, emoji: string) => `${commentId}::${emoji}`;

export function useCommentThread({
  tournamentId,
  threadType,
  threadId,
}: UseCommentThreadArgs): UseCommentThreadResult {
  const { player } = useAuth();
  const { comments: server, loading, error, hasMore, loadingOlder, loadOlder } = useComments(threadId);

  const meId = player?.id;
  const myName = player?.displayName || player?.id || "";

  // Optimistic overlays applied on top of the server snapshot.
  const [pending, setPending] = useState<PendingPost[]>([]);
  const [removing, setRemoving] = useState<Set<string>>(() => new Set());
  // Reaction overrides: key -> whether the caller should appear in that reaction.
  const [reactionOverrides, setReactionOverrides] = useState<Map<string, boolean>>(() => new Map());

  // Latest server state, read by action handlers without re-binding them.
  const serverRef = useRef<CommentDoc[]>(server);
  useEffect(() => {
    serverRef.current = server;
  }, [server]);

  // We deliberately don't prune overlays in an effect (synchronous setState in an
  // effect causes cascading renders). The merge below already hides an overlay
  // once the server snapshot reflects it, and an overlay that matches server truth
  // is a no-op — so correctness never depends on pruning. The pending list is the
  // only overlay that grows with use, so `post` trims it opportunistically.

  const post = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !meId) return;
      const tempId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `tmp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const optimistic: PendingPost = {
        tempId,
        authorId: meId,
        authorName: myName,
        text: trimmed,
        createdAt: new Date(),
      };
      // Append the optimistic post, dropping earlier ones the snapshot now has.
      setPending((prev) => {
        const liveIds = new Set(serverRef.current.map((c) => c.id));
        const live = prev.filter((p) => !(p.realId && liveIds.has(p.realId)));
        return [...live, optimistic];
      });
      try {
        const res = await commentsApi.postComment({ tournamentId, threadType, threadId, text: trimmed });
        const realId = res?.commentId;
        if (realId) {
          setPending((prev) => prev.map((p) => (p.tempId === tempId ? { ...p, realId } : p)));
        }
      } catch (e) {
        setPending((prev) => prev.filter((p) => p.tempId !== tempId));
        throw e;
      }
    },
    [meId, myName, tournamentId, threadType, threadId]
  );

  const react = useCallback(
    async (commentId: string, emoji: string) => {
      if (!meId) return;
      const key = reactionKey(commentId, emoji);
      setReactionOverrides((prev) => {
        const serverHas = (
          serverRef.current.find((c) => c.id === commentId)?.reactions?.[emoji] ?? []
        ).includes(meId);
        const effective = prev.has(key) ? (prev.get(key) as boolean) : serverHas;
        const next = new Map(prev);
        next.set(key, !effective);
        return next;
      });
      try {
        await commentsApi.toggleReaction({ commentId, emoji });
      } catch (e) {
        setReactionOverrides((prev) => {
          const next = new Map(prev);
          next.delete(key);
          return next;
        });
        throw e;
      }
    },
    [meId]
  );

  const remove = useCallback(async (commentId: string) => {
    setRemoving((prev) => new Set(prev).add(commentId));
    try {
      await commentsApi.deleteComment({ commentId });
    } catch (e) {
      setRemoving((prev) => {
        const next = new Set(prev);
        next.delete(commentId);
        return next;
      });
      throw e;
    }
  }, []);

  const canDelete = useCallback(
    (comment: CommentDoc) => !!player && (player.id === comment.authorId || !!player.isAdmin),
    [player]
  );

  // Merge server truth with the optimistic overlays into one sorted list.
  const comments = useMemo<DisplayComment[]>(() => {
    const liveIds = new Set(server.map((c) => c.id));
    const fromServer: DisplayComment[] = server
      .filter((c) => !removing.has(c.id))
      .map((c) => applyReactionOverrides(c, reactionOverrides, meId));
    const fromPending: DisplayComment[] = pending
      .filter((p) => !(p.realId && liveIds.has(p.realId)))
      .map((p) => ({
        id: p.tempId,
        tournamentId,
        threadType,
        threadId,
        authorId: p.authorId,
        authorName: p.authorName,
        text: p.text,
        reactions: {},
        createdAt: p.createdAt,
        pending: true,
      }));
    return [...fromServer, ...fromPending].sort((a, b) => displayMillis(a) - displayMillis(b));
  }, [server, pending, removing, reactionOverrides, meId, tournamentId, threadType, threadId]);

  return {
    comments,
    loading,
    error,
    hasMore,
    loadingOlder,
    loadOlder,
    canInteract: !!player,
    post,
    react,
    remove,
    canDelete,
  };
}

/** Force the caller's membership in a comment's reactions per local overrides. */
function applyReactionOverrides(
  comment: CommentDoc,
  overrides: Map<string, boolean>,
  meId: string | undefined
): DisplayComment {
  if (overrides.size === 0 || !meId) return comment;
  let next: Record<string, string[]> | undefined;
  for (const emoji of REACTION_EMOJI) {
    const intended = overrides.get(reactionKey(comment.id, emoji));
    if (intended === undefined) continue;
    const base = comment.reactions?.[emoji] ?? [];
    if (base.includes(meId) === intended) continue;
    next ??= { ...(comment.reactions ?? {}) };
    const updated = intended ? [...base, meId] : base.filter((id) => id !== meId);
    if (updated.length === 0) delete next[emoji];
    else next[emoji] = updated;
  }
  return next ? { ...comment, reactions: next } : comment;
}

function commentMillis(c: CommentDoc): number {
  return toDateOrNull(c.createdAt)?.getTime() ?? 0;
}

/**
 * Sort key for the merged list. Unlike the raw subscription we treat a missing
 * timestamp as "now" (Infinity), so a freshly-posted comment whose server
 * timestamp hasn't resolved sorts to the *bottom* rather than jumping to the top.
 */
function displayMillis(c: DisplayComment): number {
  return toDateOrNull(c.createdAt)?.getTime() ?? Number.POSITIVE_INFINITY;
}
