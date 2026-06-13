import { useEffect, useState } from "react";
import { doc, onSnapshot, type FirestoreError } from "firebase/firestore";
import { db } from "../firebase";
import type { PairingDraftDoc } from "../types";

export interface UsePairingDraftResult {
  /** The live draft doc, or null if none exists yet. */
  draft: PairingDraftDoc | null;
  loading: boolean;
  /** True when the read was rejected — the viewer isn't a captain or admin. */
  denied: boolean;
  error: string | null;
}

/**
 * Live subscription to `pairingDrafts/{roundId}`. Reads are gated by the
 * security rules to captains/co-captains and admins, so an unauthorized viewer
 * gets `denied: true` (rather than data). A missing doc is `draft: null` with
 * no error (the round simply has no draft yet).
 */
export function usePairingDraft(roundId: string | null | undefined): UsePairingDraftResult {
  const [draft, setDraft] = useState<PairingDraftDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!roundId) {
      setDraft(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setDenied(false);
    setError(null);

    const unsub = onSnapshot(
      doc(db, "pairingDrafts", roundId),
      (snap) => {
        setDraft(snap.exists() ? ({ ...snap.data() } as PairingDraftDoc) : null);
        setLoading(false);
      },
      (err: FirestoreError) => {
        // permission-denied = not a captain/admin (or the doc doesn't exist yet,
        // which Firestore also reports as denied under a conditional read rule).
        if (err.code === "permission-denied") {
          setDenied(true);
          setDraft(null);
        } else {
          console.error("Pairing draft subscription error:", err);
          setError(err.message);
        }
        setLoading(false);
      }
    );

    return () => unsub();
  }, [roundId]);

  return { draft, loading, denied, error };
}
