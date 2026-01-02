import { useEffect, useMemo, useState, useRef } from "react";
import { collection, doc, query, where, documentId, onSnapshot, getDoc, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import type { RoundDoc, TournamentDoc, MatchDoc, PlayerDoc, CourseDoc } from "../types";
import { ensureTournamentTeamColors } from "../utils/teamColors";
import { FIRESTORE_IN_QUERY_LIMIT } from "../constants";
import { useTournamentContextOptional } from "../contexts/TournamentContext";

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
  
  // Try to get tournament from shared context
  const tournamentContext = useTournamentContextOptional();
  
  // Initialize localTournament from context if available (to avoid flashing)
  const [localTournament, setLocalTournament] = useState<TournamentDoc | null>(
    tournamentContext?.tournament || null
  );
  const [course, setCourse] = useState<CourseDoc | null>(null);
  const [matches, setMatches] = useState<MatchDoc[]>([]);
  const [players, setPlayers] = useState<Record<string, PlayerDoc>>({});
  
  // Cache refs to avoid re-fetching
  const fetchedCourseIdRef = useRef<string | undefined>(undefined);

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

  // 2) Get tournament from context or fetch once (not subscribe)
  useEffect(() => {
    if (!round?.tournamentId) {
      setLocalTournament(null);
      return;
    }

    // Check if context has this tournament - use it immediately
    if (tournamentContext?.tournament?.id === round.tournamentId) {
      setLocalTournament(tournamentContext.tournament);
      return;
    }

    // Context doesn't have it - do a one-time fetch
    let cancelled = false;
    async function fetchTournament() {
      try {
        const snap = await getDoc(doc(db, "tournaments", round!.tournamentId));
        if (cancelled) return;
        if (snap.exists()) {
          setLocalTournament(ensureTournamentTeamColors({ id: snap.id, ...snap.data() } as TournamentDoc));
        } else {
          setLocalTournament(null);
        }
      } catch (err) {
        console.error("Tournament fetch error:", err);
        setLocalTournament(null);
      }
    }
    fetchTournament();

    return () => { cancelled = true; };
  }, [round?.tournamentId, tournamentContext?.tournament]);

  // 3) Fetch course once (courses don't change during session)
  useEffect(() => {
    if (!round?.courseId) {
      setCourse(null);
      return;
    }

    // Skip if already fetched this course
    if (fetchedCourseIdRef.current === round.courseId && course?.id === round.courseId) {
      return;
    }

    // Check context cache first
    if (tournamentContext?.courses[round.courseId]) {
      const cachedCourse = tournamentContext.courses[round.courseId];
      setCourse(cachedCourse);
      fetchedCourseIdRef.current = round.courseId;
      return;
    }

    let cancelled = false;
    const courseIdToFetch = round.courseId;
    async function fetchCourse() {
      try {
        const snap = await getDoc(doc(db, "courses", courseIdToFetch));
        if (cancelled) return;
        if (snap.exists()) {
          const courseData = { id: snap.id, ...snap.data() } as CourseDoc;
          setCourse(courseData);
          fetchedCourseIdRef.current = courseIdToFetch;
          // Add to context cache if available
          tournamentContext?.addCourse(courseData);
        }
      } catch (err) {
        console.error("Course fetch error:", err);
      }
    }
    fetchCourse();

    return () => { cancelled = true; };
  }, [round?.courseId, tournamentContext?.courses]);

  // 4) Subscribe to matches for this round (optimized for locked rounds)
  // Locked rounds use one-time batch read; active rounds use real-time subscription
  useEffect(() => {
    if (!roundId || !round) return;

    let unsub: (() => void) | undefined;
    
    // If round is locked, use one-time batch read (static data)
    if (round.locked) {
      const fetchStaticMatches = async () => {
        try {
          const snap = await getDocs(
            query(collection(db, "matches"), where("roundId", "==", roundId))
          );
          const ms = snap.docs
            .map(d => ({ id: d.id, ...d.data() } as MatchDoc))
            .sort((a, b) => (a.matchNumber ?? 0) - (b.matchNumber ?? 0) || a.id.localeCompare(b.id));
          setMatches(ms);
          setMatchesLoaded(true);
        } catch (err) {
          console.error("Matches fetch error:", err);
          setMatchesLoaded(true);
        }
      };
      fetchStaticMatches();
      return;
    }
    
    // Real-time subscription for active/unlocked rounds
    unsub = onSnapshot(
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
    return () => unsub?.();
  }, [roundId, round?.locked]);

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

    // Fetch all player chunks at once (one-time read)
    Promise.all(
      chunks.map(chunk => {
        return getDocs(
          query(collection(db, "players"), where(documentId(), "in", chunk))
        );
      })
    )
      .then(snapshots => {
        const allPlayers: Record<string, PlayerDoc> = {};
        snapshots.forEach(snap => {
          snap.forEach(d => {
            allPlayers[d.id] = { id: d.id, ...d.data() } as PlayerDoc;
          });
        });
        setPlayers(allPlayers);
      })
      .catch(err => {
        console.error("Players fetch error:", err);
      });

    return () => {};
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

  // Use tournament from context if available (prioritize context for consistency)
  const tournament = useMemo(() => {
    // If context has the tournament we need, use it
    const contextTournament = tournamentContext?.tournament;
    if (contextTournament?.id === round?.tournamentId) {
      return contextTournament;
    }
    // Otherwise use the local fetch result
    return localTournament;
  }, [tournamentContext?.tournament, round?.tournamentId, localTournament]);

  return {
    loading,
    error,
    round,
    tournament: tournament || null,
    course,
    matches,
    players,
    stats,
  };
}
