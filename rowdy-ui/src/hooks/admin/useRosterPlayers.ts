import { useEffect, useState } from "react";
import { collection, documentId, getDocs, query, where } from "firebase/firestore";
import { db } from "../../firebase";
import { rosterPlayerIds } from "../../utils/roster";
import type { PlayerDoc, TournamentDoc } from "../../types";

export { rosterPlayerIds, tierPlayerIds } from "../../utils/roster";

/**
 * Fetch the player docs rostered on a tournament (both teams), batched into
 * 30-id `in` queries (Firestore's per-query limit). Replaces the duplicated
 * roster-fetch logic in the admin match pages.
 */
export function useRosterPlayers(tournament: TournamentDoc | null | undefined) {
  const [players, setPlayers] = useState<PlayerDoc[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const allIds = rosterPlayerIds(tournament);
    if (allIds.length === 0) {
      setPlayers([]);
      return;
    }

    let cancelled = false;
    const fetchRosterPlayers = async () => {
      setLoading(true);
      try {
        const batches: string[][] = [];
        for (let i = 0; i < allIds.length; i += 30) {
          batches.push(allIds.slice(i, i + 30));
        }
        const results = await Promise.all(
          batches.map((batch) =>
            getDocs(query(collection(db, "players"), where(documentId(), "in", batch)))
          )
        );
        if (cancelled) return;
        const fetched: PlayerDoc[] = [];
        results.forEach((snap) =>
          snap.docs.forEach((d) => fetched.push({ id: d.id, ...d.data() } as PlayerDoc))
        );
        setPlayers(fetched);
      } catch (err) {
        console.error("Error fetching roster players:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchRosterPlayers();
    return () => {
      cancelled = true;
    };
  }, [tournament]);

  return { players, loading };
}
