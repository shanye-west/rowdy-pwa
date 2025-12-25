import { useState, useEffect, useMemo } from "react";
import { onSnapshot, doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import type { 
  RoundDoc, 
  TournamentDoc, 
  HoleSkinData, 
  PlayerSkinsTotal, 
  SkinsResultDoc 
} from "../types";
import { ensureTournamentTeamColors } from "../utils/teamColors";
import { useTournamentContextOptional } from "../contexts/TournamentContext";

export type SkinType = "gross" | "net";

// Re-export types for consumers (Skins.tsx, Match.tsx)
export type { HoleSkinData, PlayerSkinsTotal, PlayerHoleScore } from "../types";

interface UseSkinsDataOptions {
  /** Pre-fetched round data to avoid duplicate subscriptions */
  prefetchedRound?: RoundDoc | null;
}

/**
 * Hook for fetching skins data for a round.
 * 
 * OPTIMIZED: Accepts optional prefetchedRound to avoid duplicate round subscriptions.
 * When called from Match.tsx, pass the round from useMatchData to eliminate 1 subscription.
 */
export function useSkinsData(roundId: string | undefined, options: UseSkinsDataOptions = {}) {
  const { prefetchedRound } = options;
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [localRound, setLocalRound] = useState<RoundDoc | null>(null);
  const [localTournament, setLocalTournament] = useState<TournamentDoc | null>(null);
  const [skinsResult, setSkinsResult] = useState<SkinsResultDoc | null>(null);

  // Try to get tournament from shared context first
  const tournamentContext = useTournamentContextOptional();

  // Use prefetched round if available, otherwise subscribe
  const round = prefetchedRound ?? localRound;

  // Subscribe to round ONLY if no prefetched round is provided
  useEffect(() => {
    // Skip subscription if we have a prefetched round
    if (prefetchedRound !== undefined) {
      return;
    }
    
    if (!roundId) {
      setLoading(false);
      return;
    }

    const unsub = onSnapshot(
      doc(db, "rounds", roundId),
      (snap) => {
        if (snap.exists()) {
          setLocalRound({ id: snap.id, ...snap.data() } as RoundDoc);
        } else {
          setLocalRound(null);
          setError("Round not found");
          setLoading(false);
        }
      },
      (err) => {
        console.error("Error loading round:", err);
        setError("Failed to load round");
        setLoading(false);
      }
    );

    return () => unsub();
  }, [roundId, prefetchedRound]);

  // Get tournament from context or fetch once (not subscribe) if context doesn't have it
  useEffect(() => {
    if (!round?.tournamentId) return;

    // Check if context has this tournament
    if (tournamentContext?.tournament?.id === round.tournamentId) {
      setLocalTournament(tournamentContext.tournament);
      return;
    }

    // Context doesn't have it - do a one-time fetch instead of subscribing
    // Tournament data rarely changes during a session
    let cancelled = false;
    async function fetchTournament() {
      try {
        const snap = await getDoc(doc(db, "tournaments", round!.tournamentId));
        if (cancelled) return;
        if (snap.exists()) {
          setLocalTournament(ensureTournamentTeamColors({ id: snap.id, ...snap.data() } as TournamentDoc));
        }
      } catch (err) {
        console.error("Error fetching tournament:", err);
      }
    }
    fetchTournament();

    return () => { cancelled = true; };
  }, [round?.tournamentId, tournamentContext?.tournament]);

  // Subscribe to pre-computed skins results
  useEffect(() => {
    if (!roundId) return;

    const unsub = onSnapshot(
      doc(db, "rounds", roundId, "skinsResults", "computed"),
      (snap) => {
        if (snap.exists()) {
          setSkinsResult(snap.data() as SkinsResultDoc);
        } else {
          setSkinsResult(null);
        }
        setLoading(false);
      },
      (err) => {
        console.error("Error loading skins results:", err);
        // Don't set error - skins may just not be configured yet
        setSkinsResult(null);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [roundId]);

  // Use tournament from context if available, otherwise use local fetch
  const tournament = (tournamentContext?.tournament?.id === round?.tournamentId && tournamentContext?.tournament)
    ? tournamentContext.tournament 
    : localTournament;

  // Check if skins are enabled and format is valid
  const skinsEnabled = useMemo(() => {
    const hasGross = (round?.skinsGrossPot ?? 0) > 0;
    const hasNet = (round?.skinsNetPot ?? 0) > 0;
    const validFormat = round?.format === "singles" || round?.format === "twoManBestBall";
    return validFormat && (hasGross || hasNet);
  }, [round]);

  // Get hole-by-hole skins data from pre-computed results
  const holeSkinsData = useMemo((): HoleSkinData[] => {
    if (!skinsEnabled || !skinsResult) return [];
    return skinsResult.holeSkinsData || [];
  }, [skinsEnabled, skinsResult]);

  // Get player totals from pre-computed results
  const playerTotals = useMemo((): PlayerSkinsTotal[] => {
    if (!skinsEnabled || !skinsResult) return [];
    return skinsResult.playerTotals || [];
  }, [skinsEnabled, skinsResult]);

  return {
    loading,
    error,
    round,
    tournament,
    skinsEnabled,
    holeSkinsData,
    playerTotals,
  };
}
