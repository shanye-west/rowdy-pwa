/**
 * usePlayerStats Hook
 * 
 * Fetches aggregated player stats by tournament series from Firestore.
 * 
 * Usage:
 *   const { stats, loading, error } = usePlayerStats(playerId, "rowdyCup");
 *   const { allSeriesStats, loading } = usePlayerStatsBySeries(playerId);
 */

import { useState, useEffect } from "react";
import { doc, collection, collectionGroup, onSnapshot, query, where, getDocs, type QuerySnapshot } from "firebase/firestore";
import { db } from "../firebase";
import { getDocsCacheFirst } from "../utils/firestoreReads";
import type { PlayerStatsBySeries, TournamentSeries } from "../types";

/**
 * Fetch stats for a single player in a specific series
 */
export function usePlayerStats(playerId: string | undefined, series: TournamentSeries) {
  const [stats, setStats] = useState<PlayerStatsBySeries | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!playerId || !series) {
      setStats(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    const docRef = doc(db, "playerStats", playerId, "bySeries", series);
    
    const unsub = onSnapshot(
      docRef,
      (snap) => {
        if (snap.exists()) {
          setStats({ ...snap.data(), playerId, series } as PlayerStatsBySeries);
        } else {
          setStats(null);
        }
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error("Error fetching player stats:", err);
        setError(err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [playerId, series]);

  return { stats, loading, error };
}

/**
 * Fetch stats for a single player across all series.
 *
 * Career stats only change after a post-match recompute, so a live listener is
 * overkill — read cache-first for an instant paint and refresh once from the
 * server in the background (stale-while-revalidate) instead of holding a
 * subscription open for the whole page visit.
 */
export function usePlayerStatsBySeries(playerId: string | undefined) {
  const [allSeriesStats, setAllSeriesStats] = useState<PlayerStatsBySeries[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!playerId) {
      setAllSeriesStats([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    let cancelled = false;

    const apply = (snap: QuerySnapshot) => {
      if (cancelled) return;
      const stats: PlayerStatsBySeries[] = [];
      snap.forEach((doc) => {
        stats.push({ ...doc.data(), playerId, series: doc.id } as PlayerStatsBySeries);
      });
      setAllSeriesStats(stats);
      setLoading(false);
      setError(null);
    };

    getDocsCacheFirst(query(collection(db, "playerStats", playerId, "bySeries")), apply)
      .then(apply)
      .catch((err) => {
        console.error("Error fetching player stats by series:", err);
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [playerId]);

  return { allSeriesStats, loading, error };
}

/**
 * All-time leaderboard for a series across EVERY player who has ever played in
 * it — not limited to the current tournament roster (retired players, guests,
 * and anyone no longer on a team still appear). Test accounts are excluded:
 * their ids are `_`-prefixed (real players are `p`-prefixed), which is the
 * comprehensive filter — the `_testSeed` flag only covers newer seeds, and all
 * seeded test players are `_`-prefixed regardless.
 *
 * A single `collectionGroup("bySeries")` query (filtered to this series) reads
 * only players who actually have a record for it — no whole-`players` scan and
 * no N round-trips, replacing the previous 1+N read pattern. It relies on the
 * existing `bySeries.series` COLLECTION_GROUP field override (firestore.indexes.json),
 * so no new index is required. `enabled` defers the read until the tab is opened.
 *
 * The player's name is denormalized onto the stats doc (`displayName`, written by
 * `aggregatePlayerStats`), so the returned `names` map needs no second lookup.
 * Pre-backfill docs without `displayName` fall back to the playerId.
 */
export function useAllTimeLeaderboard(series: TournamentSeries | undefined, enabled: boolean) {
  const [leaderboard, setLeaderboard] = useState<PlayerStatsBySeries[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!series || !enabled) {
      setLeaderboard([]);
      setNames({});
      setLoading(false);
      return;
    }

    setLoading(true);
    let cancelled = false;

    (async () => {
      try {
        const snap = await getDocs(
          query(collectionGroup(db, "bySeries"), where("series", "==", series))
        );
        if (cancelled) return;

        const nameMap: Record<string, string> = {};
        const stats: PlayerStatsBySeries[] = [];
        snap.docs.forEach((d) => {
          // playerId is the grandparent doc id: playerStats/{playerId}/bySeries/{series}
          const playerId = d.ref.parent.parent?.id;
          if (!playerId || playerId.startsWith("_")) return; // skip test accounts
          const data = d.data();
          nameMap[playerId] = (data.displayName as string) || playerId;
          stats.push({ ...data, playerId, series } as PlayerStatsBySeries);
        });

        // Sort by points descending (small list; client-side keeps it index-free)
        stats.sort((a, b) => b.points - a.points);
        setLeaderboard(stats);
        setNames(nameMap);
        setLoading(false);
      } catch (err) {
        console.error("Error fetching all-time leaderboard:", err);
        if (!cancelled) {
          setLeaderboard([]);
          setNames({});
          setLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [series, enabled]);

  return { leaderboard, names, loading };
}
