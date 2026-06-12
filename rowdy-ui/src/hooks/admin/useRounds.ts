import { useCallback, useEffect, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../../firebase";
import { getErrorMessage } from "../../api/errors";
import type { RoundDoc } from "../../types";

/** Rounds for a tournament, sorted by day. Pass null/"" to clear. */
export function useRounds(tournamentId: string | null | undefined) {
  const [rounds, setRounds] = useState<RoundDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!tournamentId) {
      setRounds([]);
      return;
    }
    setLoading(true);
    try {
      const snap = await getDocs(
        query(collection(db, "rounds"), where("tournamentId", "==", tournamentId))
      );
      const data = snap.docs.map((d) => ({ id: d.id, ...d.data() } as RoundDoc));
      setRounds(data.sort((a, b) => (a.day ?? 0) - (b.day ?? 0)));
      setError(null);
    } catch (err) {
      console.error("Error fetching rounds:", err);
      setError(getErrorMessage(err, "Failed to load rounds"));
    } finally {
      setLoading(false);
    }
  }, [tournamentId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { rounds, loading, error, refresh };
}
