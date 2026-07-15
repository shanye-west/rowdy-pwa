import { useEffect, useState } from "react";
import { doc, onSnapshot, type FirestoreError } from "firebase/firestore";
import { db } from "../firebase";
import type { PairingDraftDoc, RoundDoc } from "../types";

/**
 * Live map of `roundId → pairingDraft` for the given round ids (one per-doc
 * listener each). Reads of `pairingDrafts` are open to any signed-in user, so
 * `denied` only flips true when logged out. A missing draft is simply absent
 * from the map. Shared by the /pairings-tv board and the Home "live" banner.
 */
export function useRoundDrafts(roundIds: string[]): {
  drafts: Record<string, PairingDraftDoc>;
  denied: boolean;
} {
  const [drafts, setDrafts] = useState<Record<string, PairingDraftDoc>>({});
  const [denied, setDenied] = useState(false);
  const key = roundIds.join(",");

  useEffect(() => {
    if (!key) {
      setDrafts({});
      return;
    }
    const ids = key.split(",");
    const unsubs = ids.map((rid) =>
      onSnapshot(
        doc(db, "pairingDrafts", rid),
        (snap) => {
          setDrafts((prev) => {
            const next = { ...prev };
            if (snap.exists()) next[rid] = { ...snap.data() } as PairingDraftDoc;
            else delete next[rid];
            return next;
          });
        },
        (err: FirestoreError) => {
          if (err.code === "permission-denied") setDenied(true);
          else console.error("Pairing draft subscription error:", err);
        }
      )
    );
    return () => unsubs.forEach((u) => u());
  }, [key]);

  return { drafts, denied };
}

export interface LivePairing {
  round: RoundDoc;
  /** 1-based round number (matches the app's "Round N"); requires day-sorted rounds. */
  number: number;
  draft: PairingDraftDoc;
}

/**
 * The round with an *in-progress* pairings draft — one that's still drafting or
 * awaiting admin confirmation (i.e. NOT finalized), or null if none. Prefers a
 * drafting round over a review one, and the latest round on ties. `rounds` must
 * be sorted by day so `number` lines up with the displayed "Round N". Returns
 * null once the admin finalizes, so callers auto-hide any "live" affordance.
 */
export function findLivePairing(rounds: RoundDoc[], drafts: Record<string, PairingDraftDoc>): LivePairing | null {
  const rank = (d: PairingDraftDoc) => (d.phase === "drafting" ? 0 : 1); // drafting beats review
  let bestIdx = -1;
  rounds.forEach((r, idx) => {
    const d = drafts[r.id];
    if (!d || d.phase === "finalized") return;
    if (bestIdx === -1) {
      bestIdx = idx;
      return;
    }
    const bd = drafts[rounds[bestIdx].id];
    if (!bd || rank(d) < rank(bd) || (rank(d) === rank(bd) && idx > bestIdx)) {
      bestIdx = idx;
    }
  });
  if (bestIdx === -1) return null;
  return { round: rounds[bestIdx], number: bestIdx + 1, draft: drafts[rounds[bestIdx].id] };
}
