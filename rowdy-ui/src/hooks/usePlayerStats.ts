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
import { doc, collection, onSnapshot, query, getDoc, getDocs } from "firebase/firestore";
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
 * and anyone no longer on a team still appear). Test accounts are excluded:
 * their ids are `_`-prefixed (real players are `p`-prefixed). The `_testSeed`
 * flag alone is insufficient — older seeded test players predate it.
 *
 * Reads the `players` collection once, then fetches each real player's
 * `bySeries/{series}` doc by path. This deliberately avoids a `bySeries`
 * collection-group query so it needs no extra Firestore index — only a hosting
 * deploy. `enabled` defers the reads until the all-time tab is opened.
 *
 * Returns a `names` map (playerId → displayName) sourced from the same players
 * read, so callers don't need a second name lookup.
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
        // All real players (skip test accounts: `_`-prefixed ids / _testSeed).
        const playersSnap = await getDocs(collection(db, "players"));
        if (cancelled) return;
        const realPlayers = playersSnap.docs.filter(
          (d) => !d.id.startsWith("_") && d.data()._testSeed !== true
        );

        const nameMap: Record<string, string> = {};
        realPlayers.forEach((d) => {
          nameMap[d.id] = (d.data().displayName as string) || "Unknown";
        });

        // Each real player's all-time stats for this series (skip never-played).
        const results = await Promise.all(
          realPlayers.map(async (p) => {
            const snap = await getDoc(doc(db, "playerStats", p.id, "bySeries", series));
            return snap.exists()
              ? ({ ...snap.data(), playerId: p.id, series } as PlayerStatsBySeries)
              : null;
          })
        );
        if (cancelled) return;

        const stats = results.filter((s): s is PlayerStatsBySeries => s !== null);
        // Sort by points descending
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
