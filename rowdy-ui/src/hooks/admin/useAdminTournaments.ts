import { useCallback, useEffect, useState } from "react";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "../../firebase";
import { getErrorMessage } from "../../api/errors";
import type { TournamentDoc } from "../../types";

interface UseAdminTournamentsOptions {
  /** Include tournaments flagged `archived: true` (default false). */
  includeArchived?: boolean;
}

/**
 * All tournaments, newest year first, for admin pickers and lists.
 * Standardizes the per-page tournament queries (active+test merge, year sort)
 * into one fetch — admins may work with any tournament, not just the active one.
 */
export function useAdminTournaments(options: UseAdminTournamentsOptions = {}) {
  const { includeArchived = false } = options;
  const [tournaments, setTournaments] = useState<TournamentDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const snap = await getDocs(query(collection(db, "tournaments"), orderBy("year", "desc")));
      const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() } as TournamentDoc));
      setTournaments(
        includeArchived
          ? docs
          : docs.filter((t) => !(t as TournamentDoc & { archived?: boolean }).archived)
      );
      setError(null);
    } catch (err) {
      console.error("Failed to load tournaments:", err);
      setError(getErrorMessage(err, "Failed to load tournaments"));
    } finally {
      setLoading(false);
    }
  }, [includeArchived]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { tournaments, loading, error, refresh };
}
