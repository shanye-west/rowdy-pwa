import { useEffect, useState } from "react";
import { doc, onSnapshot, type FirestoreError } from "firebase/firestore";
import { db } from "../firebase";
import type { DraftTeamKey, PairingPlanDoc } from "../types";

export interface UsePairingPlanResult {
  /** The live plan doc, or null when the team hasn't saved one yet. */
  plan: PairingPlanDoc | null;
  loading: boolean;
  /**
   * True when the read was rejected. The rule tests `resource.data`, so a
   * MISSING doc also reports permission-denied — callers that already know the
   * viewer captains this team should read this as "no plan saved yet".
   */
  denied: boolean;
  error: string | null;
}

/** Deterministic plan doc id — mirrors `planDocId` in functions/pairingPlanOps. */
export function pairingPlanId(roundId: string, team: DraftTeamKey): string {
  return `${roundId}__${team}`;
}

/**
 * Live subscription to one team's private pairing plan. Live rather than
 * one-shot so a captain and co-captain planning at the same time see each
 * other's saves land instead of silently overwriting blind.
 */
export function usePairingPlan(
  roundId: string | null | undefined,
  team: DraftTeamKey | null | undefined
): UsePairingPlanResult {
  const [plan, setPlan] = useState<PairingPlanDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!roundId || !team) {
      setPlan(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setDenied(false);
    setError(null);
    // Drop the previous doc up front: an admin switching teams must never see
    // the other side's plan bleed through while the new one loads.
    setPlan(null);

    const unsub = onSnapshot(
      doc(db, "pairingPlans", pairingPlanId(roundId, team)),
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
  }, [roundId, team]);

  return { plan, loading, denied, error };
}
