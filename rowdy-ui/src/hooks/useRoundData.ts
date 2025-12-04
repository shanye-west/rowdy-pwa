import { useEffect, useMemo, useState } from "react";
import { collection, doc, query, where, documentId, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import type { RoundDoc, TournamentDoc, MatchDoc, PlayerDoc, CourseDoc } from "../types";
import { FIRESTORE_IN_QUERY_LIMIT } from "../constants";

interface UseRoundDataResult {
  loading: boolean;
  error: string | null;
  round: RoundDoc | null;
  tournament: TournamentDoc | null;
  course: CourseDoc | null;
  matches: MatchDoc[];
  players: Record<string, PlayerDoc>;
  stats: {
    finalTeamA: number;
    finalTeamB: number;
    projectedTeamA: number;
    projectedTeamB: number;
  };
}

/**
 * Hook to fetch all data for a single round view.
 * Handles cascading subscriptions: round → tournament/course → matches → players
 */
export function useRoundData(roundId: string | undefined): UseRoundDataResult {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [round, setRound] = useState<RoundDoc | null>(null);
  const [tournament, setTournament] = useState<TournamentDoc | null>(null);
  const [course, setCourse] = useState<CourseDoc | null>(null);
  const [matches, setMatches] = useState<MatchDoc[]>([]);
  const [players, setPlayers] = useState<Record<string, PlayerDoc>>({});

  // Track loading states for coordinated display
  const [roundLoaded, setRoundLoaded] = useState(false);
  const [matchesLoaded, setMatchesLoaded] = useState(false);

  // 1) Subscribe to round document
  useEffect(() => {
    if (!roundId) {
      setLoading(false);
      setError("Round ID is missing.");
      return;
    }

    setLoading(true);
    setError(null);
    setRoundLoaded(false);
    setMatchesLoaded(false);

    const unsub = onSnapshot(
      doc(db, "rounds", roundId),
      (snap) => {
        if (!snap.exists()) {
          setError("Round not found.");
          setRound(null);
        } else {
          setRound({ id: snap.id, ...snap.data() } as RoundDoc);
        }
        setRoundLoaded(true);
      },
      (err) => {
        console.error("Round subscription error:", err);
        setError("Unable to load round data.");
        setRoundLoaded(true);
      }
    );
    return () => unsub();
  }, [roundId]);

  // 2) Subscribe to tournament when round is loaded
  useEffect(() => {
    if (!round?.tournamentId) return;

    const unsub = onSnapshot(
      doc(db, "tournaments", round.tournamentId),
      (snap) => {
        if (snap.exists()) {
          setTournament({ id: snap.id, ...snap.data() } as TournamentDoc);
        }
      },
      (err) => console.error("Tournament subscription error:", err)
    );
    return () => unsub();
  }, [round?.tournamentId]);

  // 3) Subscribe to course when round is loaded
  useEffect(() => {
    if (!round?.courseId) {
      setCourse(null);
      return;
    }

    const unsub = onSnapshot(
      doc(db, "courses", round.courseId),
      (snap) => {
        if (snap.exists()) {
          setCourse({ id: snap.id, ...snap.data() } as CourseDoc);
        }
      },
      (err) => console.error("Course subscription error:", err)
    );
    return () => unsub();
  }, [round?.courseId]);

  // 4) Subscribe to matches for this round
  useEffect(() => {
    if (!roundId) return;

    const unsub = onSnapshot(
      query(collection(db, "matches"), where("roundId", "==", roundId)),
      (snap) => {
        const ms = snap.docs
          .map(d => ({ id: d.id, ...d.data() } as MatchDoc))
          .sort((a, b) => (a.matchNumber ?? 0) - (b.matchNumber ?? 0) || a.id.localeCompare(b.id));
        setMatches(ms);
        setMatchesLoaded(true);
      },
      (err) => {
        console.error("Matches subscription error:", err);
        setMatchesLoaded(true);
      }
    );
    return () => unsub();
  }, [roundId]);

  // 5) Subscribe to players when matches change
  useEffect(() => {
    if (matches.length === 0) {
      setPlayers({});
      return;
    }

    const playerIds = new Set<string>();
    matches.forEach(m => {
      m.teamAPlayers?.forEach(p => p.playerId && playerIds.add(p.playerId));
      m.teamBPlayers?.forEach(p => p.playerId && playerIds.add(p.playerId));
    });

    if (playerIds.size === 0) {
      setPlayers({});
      return;
    }

    const pIds = Array.from(playerIds);
    // Firestore 'in' query limit
    const chunks: string[][] = [];
    for (let i = 0; i < pIds.length; i += FIRESTORE_IN_QUERY_LIMIT) {
      chunks.push(pIds.slice(i, i + FIRESTORE_IN_QUERY_LIMIT));
    }

    // Track players from all chunks
    const playersByChunk: Record<number, Record<string, PlayerDoc>> = {};
    const unsubscribers: (() => void)[] = [];

    chunks.forEach((chunk, chunkIndex) => {
      const unsub = onSnapshot(
        query(collection(db, "players"), where(documentId(), "in", chunk)),
        (snap) => {
          const chunkPlayers: Record<string, PlayerDoc> = {};
          snap.forEach(d => {
            chunkPlayers[d.id] = { id: d.id, ...d.data() } as PlayerDoc;
          });
          playersByChunk[chunkIndex] = chunkPlayers;
          
          // Merge all chunks into players state
          const merged: Record<string, PlayerDoc> = {};
          Object.values(playersByChunk).forEach(chunkData => {
            Object.assign(merged, chunkData);
          });
          setPlayers(merged);
        },
        (err) => {
          console.error("Players subscription error:", err);
        }
      );
      unsubscribers.push(unsub);
    });

    return () => {
      unsubscribers.forEach(unsub => unsub());
    };
  }, [matches]);

  // Coordinated loading state
  useEffect(() => {
    if (roundLoaded && matchesLoaded) {
      setLoading(false);
    }
  }, [roundLoaded, matchesLoaded]);

  // Compute round stats
  const stats = useMemo(() => {
    let finalTeamA = 0, finalTeamB = 0, projectedTeamA = 0, projectedTeamB = 0;
    const pv = round?.pointsValue ?? 1;
    
    for (const m of matches) {
      const w = m.result?.winner;
      const ptsA = w === "teamA" ? pv : w === "AS" ? pv / 2 : 0;
      const ptsB = w === "teamB" ? pv : w === "AS" ? pv / 2 : 0;
      const isClosed = m.status?.closed === true;
      const isStarted = (m.status?.thru ?? 0) > 0;

      if (isClosed) {
        finalTeamA += ptsA;
        finalTeamB += ptsB;
      } else if (isStarted) {
        projectedTeamA += ptsA;
        projectedTeamB += ptsB;
      }
    }
    
    return { finalTeamA, finalTeamB, projectedTeamA, projectedTeamB };
  }, [matches, round]);

  return {
    loading,
    error,
    round,
    tournament,
    course,
    matches,
    players,
    stats,
  };
}
