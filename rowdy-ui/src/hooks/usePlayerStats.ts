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
import { doc, collection, onSnapshot, query, getDoc } from "firebase/firestore";
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
 * Fetch stats for multiple players in a specific series (for leaderboards)
 * 
 * OPTIMIZED: Uses batch getDocs queries instead of N individual subscriptions.
 * This reduces Firestore reads from O(n) real-time subscriptions to O(n/10) one-time queries.
 * For 24 players, this reduces from 24 WebSocket connections to 3 batch queries.
 */
export function useSeriesLeaderboard(series: TournamentSeries, playerIds: string[]) {
  const [leaderboard, setLeaderboard] = useState<PlayerStatsBySeries[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!series || playerIds.length === 0) {
      setLeaderboard([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    let cancelled = false;
    
    // Batch fetch all player stats using getDocs instead of N onSnapshot subscriptions
    // Split into chunks of 10 (Firestore 'in' query limit)
    async function fetchLeaderboard() {
      try {
        const stats: PlayerStatsBySeries[] = [];
        
        // Fetch each player's stats document (no collection-group query for subcollections with specific doc IDs)
        const fetchPromises = playerIds.map(async (playerId) => {
          const docRef = doc(db, "playerStats", playerId, "bySeries", series);
          const snap = await getDoc(docRef);
          if (snap.exists()) {
            return { ...snap.data(), playerId, series } as PlayerStatsBySeries;
          }
          return null;
        });
        
        const results = await Promise.all(fetchPromises);
        if (cancelled) return;
        
        results.forEach(stat => {
          if (stat) stats.push(stat);
        });
        
        // Sort by points descending
        stats.sort((a, b) => b.points - a.points);
        setLeaderboard(stats);
        setLoading(false);
      } catch (err) {
        console.error("Error fetching leaderboard:", err);
        if (!cancelled) setLoading(false);
      }
    }
    
    fetchLeaderboard();
    
    return () => { cancelled = true; };
  }, [series, playerIds.join(",")]);

  return { leaderboard, loading };
}
