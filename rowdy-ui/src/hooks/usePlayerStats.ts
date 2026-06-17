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
import { doc, collection, collectionGroup, onSnapshot, query, where, getDocs } from "firebase/firestore";
import { db } from "../firebase";
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
 * Fetch stats for a single player across all series
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
    const colRef = collection(db, "playerStats", playerId, "bySeries");
    
    const unsub = onSnapshot(
      query(colRef),
      (snap) => {
        const stats: PlayerStatsBySeries[] = [];
        snap.forEach((doc) => {
          stats.push({ ...doc.data(), playerId, series: doc.id } as PlayerStatsBySeries);
        });
        setAllSeriesStats(stats);
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error("Error fetching player stats by series:", err);
        setError(err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [playerId]);

  return { allSeriesStats, loading, error };
}

/**
 * All-time leaderboard for a series across EVERY player who has ever played in
 * it — not limited to the current tournament roster (retired players, guests,
 * and anyone no longer on a team still appear).
 *
 * Uses a single collection-group query on `bySeries` filtered by the `series`
 * field (backed by the COLLECTION_GROUP index in firestore.indexes.json), so it
 * costs one query regardless of how many players exist. `enabled` lets callers
 * defer the read until the all-time tab is actually opened.
 */
export function useAllTimeLeaderboard(series: TournamentSeries | undefined, enabled: boolean) {
  const [leaderboard, setLeaderboard] = useState<PlayerStatsBySeries[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!series || !enabled) {
      setLeaderboard([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    let cancelled = false;

    getDocs(query(collectionGroup(db, "bySeries"), where("series", "==", series)))
      .then((snap) => {
        if (cancelled) return;
        const stats: PlayerStatsBySeries[] = snap.docs.map((d) => {
          const data = d.data();
          // Prefer the stored playerId; fall back to the parent doc id
          // (playerStats/{playerId}/bySeries/{series}).
          const playerId = (data.playerId as string) || d.ref.parent.parent?.id || "";
          return { ...data, playerId, series } as PlayerStatsBySeries;
        });
        // Sort by points descending
        stats.sort((a, b) => b.points - a.points);
        setLeaderboard(stats);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Error fetching all-time leaderboard:", err);
        if (!cancelled) {
          setLeaderboard([]);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [series, enabled]);

  return { leaderboard, loading };
}
