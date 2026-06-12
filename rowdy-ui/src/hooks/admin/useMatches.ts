import { useCallback, useEffect, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../../firebase";
import { getErrorMessage } from "../../api/errors";
import type { MatchDoc } from "../../types";

/** Matches for a round, sorted by matchNumber. Pass null/"" to clear. */
export function useMatches(roundId: string | null | undefined) {
  const [matches, setMatches] = useState<MatchDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!roundId) {
      setMatches([]);
      return;
    }
    setLoading(true);
    try {
      const snap = await getDocs(query(collection(db, "matches"), where("roundId", "==", roundId)));
      const data = snap.docs.map((d) => ({ id: d.id, ...d.data() } as MatchDoc));
      setMatches(data.sort((a, b) => (a.matchNumber ?? 0) - (b.matchNumber ?? 0)));
      setError(null);
    } catch (err) {
      console.error("Error fetching matches:", err);
      setError(getErrorMessage(err, "Failed to load matches"));
    } finally {
      setLoading(false);
    }
  }, [roundId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { matches, loading, error, refresh };
}
