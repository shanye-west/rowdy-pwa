import { useEffect, useState } from "react";
import { doc, onSnapshot, type FirestoreError } from "firebase/firestore";
import { db } from "../firebase";
import type { PairingPlanDoc } from "../types";

export interface UsePairingPlanResult {
  /** The viewer's own plan, or null when they haven't saved one yet. */
  plan: PairingPlanDoc | null;
  loading: boolean;
  /**
   * True when the read was rejected. The rule tests `resource.data`, so a
   * MISSING doc also reports permission-denied — for your own plan that just
   * means "nothing saved yet", which is how the page reads it.
   */
  denied: boolean;
  error: string | null;
}

/** Deterministic plan doc id — mirrors `planDocId` in functions/pairingPlanOps. */
export function pairingPlanId(roundId: string, ownerPlayerId: string): string {
  return `${roundId}__${ownerPlayerId}`;
}

/**
 * Live subscription to ONE PERSON's pairing plan. Plans are per-owner, so this
 * only ever loads the viewer's own; live rather than one-shot so a plan edited
 * on a phone shows up on an iPad without a reload.
 */
export function usePairingPlan(
  roundId: string | null | undefined,
  ownerPlayerId: string | null | undefined
): UsePairingPlanResult {
  const [plan, setPlan] = useState<PairingPlanDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!roundId || !ownerPlayerId) {
      setPlan(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setDenied(false);
    setError(null);
    setPlan(null);

    const unsub = onSnapshot(
      doc(db, "pairingPlans", pairingPlanId(roundId, ownerPlayerId)),
      (snap) => {
        setPlan(snap.exists() ? ({ ...snap.data() } as PairingPlanDoc) : null);
        setLoading(false);
      },
      (err: FirestoreError) => {
        if (err.code === "permission-denied") {
          setDenied(true);
          setPlan(null);
        } else {
          console.error("Pairing plan subscription error:", err);
          setError(err.message);
        }
        setLoading(false);
      }
    );

    return () => unsub();
  }, [roundId, ownerPlayerId]);

  return { plan, loading, denied, error };
}
