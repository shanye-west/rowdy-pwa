import { useEffect, useState } from "react";
import { doc, onSnapshot, type FirestoreError } from "firebase/firestore";
import { db } from "../firebase";
import type { TeamDraftDoc } from "../types";

export interface UseTeamDraftResult {
  /** The live draft doc, or null if the draft hasn't been started. */
  draft: TeamDraftDoc | null;
  loading: boolean;
  /** True when the read was rejected — the viewer isn't a captain or admin. */
  denied: boolean;
  error: string | null;
}

/**
 * Live subscription to `teamDrafts/{tournamentId}`. The rules only let the
 * captains/co-captains and admins stamped into `authorizedUids` read it, so
 * anyone else gets `denied`. A missing doc is `draft: null` (not started).
 */
export function useTeamDraft(tournamentId: string | null | undefined): UseTeamDraftResult {
  const [draft, setDraft] = useState<TeamDraftDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tournamentId) {
      setDraft(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setDenied(false);
    setError(null);

    const unsub = onSnapshot(
      doc(db, "teamDrafts", tournamentId),
      (snap) => {
        setDraft(snap.exists() ? (snap.data() as TeamDraftDoc) : null);
        setDenied(false);
        setLoading(false);
      },
      (err: FirestoreError) => {
        if (err.code === "permission-denied") {
          setDenied(true);
          setDraft(null);
        } else {
          console.error("Team draft subscription error:", err);
          setError(err.message);
        }
        setLoading(false);
      }
    );
    return () => unsub();
  }, [tournamentId]);

  return { draft, loading, denied, error };
}
