import { useEffect, useState } from "react";
import { doc, onSnapshot, type FirestoreError } from "firebase/firestore";
import { db } from "../firebase";
import type { PairingDraftDoc, RoundDoc } from "../types";

/**
 * How long to wait before re-subscribing to a draft that read as denied. A
 * denied listener is terminal in the SDK, so without this a viewer who had the
 * board open while a round was private would sit on a dead page even after the
 * admin shares it — and "share it live afterwards" is the whole point.
 */
const HIDDEN_RETRY_MS = 15_000;

/**
 * Live map of `roundId → pairingDraft` for the given round ids (one per-doc
 * listener each). A missing draft is simply absent from the map. Shared by the
 * /pairings-tv board and the Home "live" banner.
 *
 * A round whose draft is `private` reads as permission-denied for anyone outside
 * its captains/admins — that's the feature working, not a failure — so those
 * round ids come back in `hiddenIds` instead of the map, and callers can tell
 * "being drafted behind closed doors" apart from "no draft yet". Hidden rounds
 * are retried on a slow timer so the board lights up on its own the moment an
 * admin reveals it.
 */
export function useRoundDrafts(roundIds: string[]): {
  drafts: Record<string, PairingDraftDoc>;
  hiddenIds: Set<string>;
} {
  const [drafts, setDrafts] = useState<Record<string, PairingDraftDoc>>({});
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());
  const key = roundIds.join(",");

  useEffect(() => {
    if (!key) {
      setDrafts({});
      setHiddenIds(new Set());
      return;
    }
    const ids = key.split(",");
    let cancelled = false;
    const unsubs = new Map<string, () => void>();
    const timers = new Map<string, ReturnType<typeof setTimeout>>();

    const subscribe = (rid: string) => {
      if (cancelled) return;
      timers.delete(rid);
      const unsub = onSnapshot(
        doc(db, "pairingDrafts", rid),
        (snap) => {
          // Resolving again (revealed, or the viewer is a captain after all)
          // means this round is no longer hidden.
          setHiddenIds((prev) => {
            if (!prev.has(rid)) return prev;
            const next = new Set(prev);
            next.delete(rid);
            return next;
          });
          setDrafts((prev) => {
            const next = { ...prev };
            if (snap.exists()) next[rid] = { ...snap.data() } as PairingDraftDoc;
            else delete next[rid];
            return next;
          });
        },
        (err: FirestoreError) => {
          unsubs.delete(rid); // the SDK has already torn this listener down
          if (err.code !== "permission-denied") {
            console.error("Pairing draft subscription error:", err);
            return;
          }
          setHiddenIds((prev) => (prev.has(rid) ? prev : new Set(prev).add(rid)));
          setDrafts((prev) => {
            if (!(rid in prev)) return prev;
            const next = { ...prev };
            delete next[rid];
            return next;
          });
          if (!cancelled) timers.set(rid, setTimeout(() => subscribe(rid), HIDDEN_RETRY_MS));
        }
      );
      unsubs.set(rid, unsub);
    };

    ids.forEach(subscribe);

    return () => {
      cancelled = true;
      timers.forEach((t) => clearTimeout(t));
      unsubs.forEach((u) => u());
    };
  }, [key]);

  return { drafts, hiddenIds };
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
 *
 * A `staging` draft doesn't count: availability is set but nobody's picking, so
 * announcing it as live would send the whole group to an empty board.
 */
export function findLivePairing(rounds: RoundDoc[], drafts: Record<string, PairingDraftDoc>): LivePairing | null {
  const rank = (d: PairingDraftDoc) => (d.phase === "drafting" ? 0 : 1); // drafting beats review
  let bestIdx = -1;
  rounds.forEach((r, idx) => {
    const d = drafts[r.id];
    if (!d || d.phase === "finalized" || d.phase === "staging") return;
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
