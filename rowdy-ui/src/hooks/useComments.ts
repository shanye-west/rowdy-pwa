/**
 * Comments data hook (match threads + the sportsbook trash-talk feed).
 *
 * A thread's volume is small, so a single onSnapshot subscription filtered by
 * `threadId` backs the view; we sort oldest -> newest client-side (a thread
 * reads top-to-bottom), mirroring the approach in useBets. `threadId` is a
 * single-field equality filter, so no composite index is required.
 */

import { useEffect, useState } from "react";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import { toDateOrNull } from "../utils";
import type { CommentDoc } from "../types";

export interface UseCommentsResult {
  comments: CommentDoc[];
  loading: boolean;
  error: string | null;
}

/** Subscribe to a single comment thread, oldest first. */
export function useComments(threadId: string | undefined): UseCommentsResult {
  const [comments, setComments] = useState<CommentDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!threadId) {
      setComments([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = onSnapshot(
      query(collection(db, "comments"), where("threadId", "==", threadId)),
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() } as CommentDoc));
        rows.sort((a, b) => commentMillis(a) - commentMillis(b));
        setComments(rows);
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

  return { comments, loading, error };
}

function commentMillis(c: CommentDoc): number {
  return toDateOrNull(c.createdAt)?.getTime() ?? 0;
}
