import { useState, useEffect, useMemo } from "react";
import { onSnapshot, doc } from "firebase/firestore";
import { db } from "../firebase";
import { getDocCacheFirst } from "../utils/firestoreReads";
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
  
  const [roundLoaded, setRoundLoaded] = useState(false);
  const [tournamentLoaded, setTournamentLoaded] = useState(false);
  const [skinsLoaded, setSkinsLoaded] = useState(false);

  // Try to get tournament from shared context first
  const tournamentContext = useTournamentContextOptional();

  // Use prefetched round if available, otherwise subscribe
  const round = prefetchedRound ?? localRound;

  // Subscribe to round ONLY if no prefetched round is provided
  useEffect(() => {
    // Skip subscription if we have a prefetched round
    if (prefetchedRound !== undefined) {
      setRoundLoaded(true);
      return;
    }

    if (!roundId) {
      setRoundLoaded(true);
      return;
    }

    setRoundLoaded(false);

    // Self-detaching: a locked round is static, so drop the realtime listener
    // once the server confirms it's locked (not on a cache-only snapshot, which
    // could pin a round that was since unlocked). Same pattern as useMatchData.
    let unsub: (() => void) | undefined = onSnapshot(
      doc(db, "rounds", roundId),
      (snap) => {
        if (snap.exists()) {
          const rData = { id: snap.id, ...snap.data() } as RoundDoc;
          setLocalRound(rData);
          setRoundLoaded(true);
          if (rData.locked === true && !snap.metadata.fromCache) {
            unsub?.();
            unsub = undefined;
          }
        } else {
          setLocalRound(null);
          setError("Round not found");
          setRoundLoaded(true);
        }
      },
      (err) => {
        console.error("Error loading round:", err);
        setError("Failed to load round");
        setRoundLoaded(true);
      }
    );

    return () => unsub?.();
  }, [roundId, prefetchedRound]);

  // Get tournament from context cache or fetch once
  useEffect(() => {
    if (!round?.tournamentId) {
      setTournamentLoaded(true);
      return;
    }
    
    if (!roundLoaded) return;

    const tournamentId = round.tournamentId;

    // Check if context has this tournament as the main tournament
    if (tournamentContext?.tournament?.id === tournamentId) {
      setLocalTournament(tournamentContext.tournament);
      setTournamentLoaded(true);
      return;
    }

    // Check if it's in the context cache
    const cachedTournament = tournamentContext?.getTournamentById(tournamentId);
    if (cachedTournament) {
      setLocalTournament(cachedTournament);
      setTournamentLoaded(true);
      return;
    }

    // Not in cache - fetch it (cache-first: tournaments referenced here are
    // effectively static, so IndexedDB usually answers without a billed read)
    setTournamentLoaded(false);
    let cancelled = false;
    async function fetchTournament() {
      try {
        const snap = await getDocCacheFirst(doc(db, "tournaments", tournamentId));
        if (cancelled) return;
        if (snap.exists()) {
          const tournament = ensureTournamentTeamColors({ id: snap.id, ...snap.data() } as TournamentDoc);
          setLocalTournament(tournament);
          // Add to context cache for future use
          if (tournament) {
            tournamentContext?.addTournament(tournament);
          }
        }
        setTournamentLoaded(true);
      } catch (err) {
        console.error("Error fetching tournament:", err);
        setTournamentLoaded(true);
      }
    }
    fetchTournament();

    return () => { cancelled = true; };
  }, [round?.tournamentId, tournamentContext?.tournament, roundLoaded]);

  // Check if skins are enabled and format is valid. Computed before the results
  // effect below so the subscription can be skipped entirely for non-skins rounds.
  const skinsEnabled = useMemo(() => {
    const hasGross = (round?.skinsGrossPot ?? 0) > 0;
    const hasNet = (round?.skinsNetPot ?? 0) > 0;
    const validFormat = round?.format === "singles" || round?.format === "twoManBestBall";
    return validFormat && (hasGross || hasNet);
  }, [round]);
  const roundLocked = round?.locked === true;

  // Read the pre-computed skins results — but only for rounds that actually
  // have skins (this hook mounts on every match view). Locked rounds get a
  // one-shot cache-first read (results are final); live rounds subscribe.
  useEffect(() => {
    if (!roundId) {
      setSkinsResult(null);
      setSkinsLoaded(true);
      return;
    }
    if (!roundLoaded) return; // need the round to know whether skins exist

    if (!skinsEnabled) {
      setSkinsResult(null);
      setSkinsLoaded(true);
      return;
    }

    setSkinsLoaded(false);

    if (roundLocked) {
      let cancelled = false;
      getDocCacheFirst(doc(db, "rounds", roundId, "skinsResults", "computed"))
        .then((snap) => {
          if (cancelled) return;
          setSkinsResult(snap.exists() ? (snap.data() as SkinsResultDoc) : null);
          setSkinsLoaded(true);
        })
        .catch((err) => {
          if (cancelled) return;
          console.error("Error loading skins results:", err);
          setSkinsResult(null);
          setSkinsLoaded(true);
        });
      return () => { cancelled = true; };
    }

    const unsub = onSnapshot(
      doc(db, "rounds", roundId, "skinsResults", "computed"),
      (snap) => {
        if (snap.exists()) {
          setSkinsResult(snap.data() as SkinsResultDoc);
        } else {
          setSkinsResult(null);
        }
        setSkinsLoaded(true);
      },
      (err) => {
        console.error("Error loading skins results:", err);
        // Don't set error - skins may just not be configured yet
        setSkinsResult(null);
        setSkinsLoaded(true);
      }
    );

    return () => unsub();
  }, [roundId, roundLoaded, skinsEnabled, roundLocked]);

  // Coordinate all loading states
  useEffect(() => {
    const allLoaded = roundLoaded && tournamentLoaded && skinsLoaded;
    setLoading(!allLoaded);
  }, [roundLoaded, tournamentLoaded, skinsLoaded]);

  // Use tournament from context if available, otherwise use local fetch
  const tournament = (tournamentContext?.tournament?.id === round?.tournamentId && tournamentContext?.tournament)
    ? tournamentContext.tournament 
    : localTournament;

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
