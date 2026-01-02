import { useEffect, useState, useRef } from "react";
import { doc, onSnapshot, getDoc, getDocs, collection, where, query, documentId } from "firebase/firestore";
import { db } from "../firebase";
import type { TournamentDoc, PlayerDoc, MatchDoc, RoundDoc, CourseDoc, PlayerMatchFact } from "../types";
import { ensureTournamentTeamColors } from "../utils/teamColors";
import { useTournamentContextOptional } from "../contexts/TournamentContext";

export type PlayerLookup = Record<string, PlayerDoc>;

export interface UseMatchDataResult {
  match: MatchDoc | null;
  round: RoundDoc | null;
  course: CourseDoc | null;
  tournament: TournamentDoc | null;
  players: PlayerLookup;
  matchFacts: PlayerMatchFact[];
  loading: boolean;
  error: string | null;
}

/**
 * Custom hook for fetching all match-related data with real-time updates.
 * 
 * Sets up listeners for:
 * 1. Match document (real-time)
 * 2. Round document (real-time, depends on match.roundId)
 * 3. Tournament document (from context or one-time fetch, cached by ID)
 * 4. Course document (one-time fetch, cached by ID)
 * 5. Player documents (batch fetch when match loads)
 * 6. PlayerMatchFacts (fetch when match closes)
 */
export function useMatchData(matchId: string | undefined): UseMatchDataResult {
  const [match, setMatch] = useState<MatchDoc | null>(null);
  const [round, setRound] = useState<RoundDoc | null>(null);
  const [course, setCourse] = useState<CourseDoc | null>(null);
  const [localTournament, setLocalTournament] = useState<TournamentDoc | null>(null);
  const [players, setPlayers] = useState<PlayerLookup>({});
  const [matchFacts, setMatchFacts] = useState<PlayerMatchFact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Try to get tournament from shared context
  const tournamentContext = useTournamentContextOptional();
  
  // Cache refs to avoid re-fetching the same tournament/course
  const fetchedTournamentIdRef = useRef<string | undefined>(undefined);
  const fetchedCourseIdRef = useRef<string | undefined>(undefined);

  // 1. Listen to MATCH (optimized for completed matches)
  // Completed+closed matches use one-time read; active matches use real-time subscription
  useEffect(() => {
    if (!matchId) return;
    setLoading(true);
    setError(null);

    let unsub: (() => void) | undefined;
    
    // Check if match is static (completed + closed) to use one-time read
    const initializeMatch = async () => {
      try {
        const snap = await getDoc(doc(db, "matches", matchId));
        if (!snap.exists()) {
          setMatch(null);
          setLoading(false);
          return;
        }
        
        const mData = { id: snap.id, ...(snap.data() as any) } as MatchDoc;
        const isStatic = mData.completed && mData.status?.closed;
        
        if (isStatic) {
          // One-time read for static/historical matches (reduces reads by ~80%)
          setMatch(mData);
          return;
        }
        
        // Real-time subscription for active/in-progress matches
        unsub = onSnapshot(
          doc(db, "matches", matchId),
          (mSnap) => {
            if (!mSnap.exists()) { 
              setMatch(null); 
              setLoading(false); 
              return; 
            }
            
            const updated = { id: mSnap.id, ...(mSnap.data() as any) } as MatchDoc;
            setMatch(updated);
          },
          (err) => {
            setError(`Failed to load match: ${err.message}`);
            setLoading(false);
          }
        );
      } catch (err: any) {
        setError(`Failed to load match: ${err.message}`);
        setLoading(false);
      }
    };
    
    initializeMatch();

    return () => unsub?.();
  }, [matchId]);

  // 2. Subscribe to players once match loads
  useEffect(() => {
    if (!match) return;

    // Extract unique player IDs from both teams
    const ids = Array.from(new Set([
      ...(match.teamAPlayers || []).map((p) => p.playerId).filter(Boolean),
      ...(match.teamBPlayers || []).map((p) => p.playerId).filter(Boolean),
    ]));
    
    if (ids.length === 0) {
      setLoading(false);
      return;
    }

    // Batch subscribe to players using onSnapshot for offline cache benefit
    // Split into batches of 10 (Firestore 'in' query limit)
    const batches: string[][] = [];
    for (let i = 0; i < ids.length; i += 10) {
      batches.push(ids.slice(i, i + 10));
    }
    
    // Track if effect has been cleaned up to prevent stale state updates
    let cancelled = false;
    
    // Fetch all player batches at once (one-time read)
    Promise.all(
      batches.map(batch => {
        const q = query(collection(db, "players"), where(documentId(), "in", batch));
        return getDocs(q);
      })
    )
      .then(snapshots => {
        if (cancelled) return; // Prevent stale updates if matchId changed
        const allPlayers: Record<string, PlayerDoc> = {};
        snapshots.forEach(snap => {
          snap.forEach(d => {
            allPlayers[d.id] = { id: d.id, ...d.data() } as PlayerDoc;
          });
        });
        setPlayers(allPlayers);
        setLoading(false);
      })
      .catch(err => {
        if (cancelled) return;
        setError(`Failed to load players: ${err.message}`);
        setLoading(false);
      });
    
    return () => { cancelled = true; };
  }, [match]);

  // 3. Listen to ROUND (real-time for score updates)
  useEffect(() => {
    if (!match?.roundId) return;
    
    const unsub = onSnapshot(
      doc(db, "rounds", match.roundId),
      (rSnap) => {
        if (!rSnap.exists()) return;
        const rData = { id: rSnap.id, ...(rSnap.data() as any) } as RoundDoc;
        setRound(rData);
      },
      (err) => {
        setError(`Failed to load round: ${err.message}`);
      }
    );
    
    return () => unsub();
  }, [match?.roundId]);

  // 4. Fetch tournament (from context or one-time fetch, cached by ID)
  useEffect(() => {
    if (!round?.tournamentId) return;
    
    // Check if context has this tournament
    if (tournamentContext?.tournament?.id === round.tournamentId) {
      setLocalTournament(tournamentContext.tournament);
      return;
    }
    
    // Skip if we already fetched this tournament
    if (fetchedTournamentIdRef.current === round.tournamentId && localTournament?.id === round.tournamentId) {
      return;
    }
    
    let cancelled = false;
    async function fetchTournament() {
      try {
        const tSnap = await getDoc(doc(db, "tournaments", round!.tournamentId));
        if (cancelled) return;
        if (tSnap.exists()) {
          setLocalTournament(ensureTournamentTeamColors({ id: tSnap.id, ...tSnap.data() } as TournamentDoc));
          fetchedTournamentIdRef.current = round!.tournamentId;
        }
      } catch (err: any) {
        console.error("Failed to fetch tournament:", err);
      }
    }
    fetchTournament();
    
    return () => { cancelled = true; };
  }, [round?.tournamentId, tournamentContext?.tournament, localTournament?.id]);

  // 5. Fetch course (one-time fetch, cached by ID)
  useEffect(() => {
    if (!round?.courseId) return;
    
    // Skip if we already fetched this course
    if (fetchedCourseIdRef.current === round.courseId && course?.id === round.courseId) {
      return;
    }
    
    // Check if context has this course cached (prioritize context cache)
    if (tournamentContext?.courses[round.courseId]) {
      const cachedCourse = tournamentContext.courses[round.courseId];
      setCourse(cachedCourse);
      fetchedCourseIdRef.current = round.courseId;
      return;
    }
    
    let cancelled = false;
    const courseIdToFetch = round.courseId; // Capture for closure
    async function fetchCourse() {
      try {
        const cSnap = await getDoc(doc(db, "courses", courseIdToFetch));
        if (cancelled) return;
        if (cSnap.exists()) {
          const courseData = { id: cSnap.id, ...cSnap.data() } as CourseDoc;
          setCourse(courseData);
          fetchedCourseIdRef.current = courseIdToFetch;
          // Add to context cache if available
          tournamentContext?.addCourse(courseData);
        }
      } catch (err: any) {
        console.error("Failed to fetch course:", err);
      }
    }
    fetchCourse();
    
    return () => { cancelled = true; };
  }, [round?.courseId, tournamentContext?.courses]);

  // 6. Fetch match facts when match closes
  useEffect(() => {
    if (!match?.id || !match?.status?.closed) {
      setMatchFacts([]);
      return;
    }
    
    let cancelled = false;
    async function fetchFacts() {
      try {
        const snap = await getDocs(query(collection(db, "playerMatchFacts"), where("matchId", "==", match!.id)));
        if (cancelled) return;
        const facts = snap.docs.map(d => ({ ...d.data(), id: d.id } as unknown as PlayerMatchFact));
        setMatchFacts(facts);
      } catch (err: any) {
        console.error("Failed to fetch match facts:", err);
      }
    }
    fetchFacts();
    
    return () => { cancelled = true; };
  }, [match?.id, match?.status?.closed]);

  // Use tournament from context if available, otherwise use local fetch
  const tournament = (tournamentContext?.tournament?.id === round?.tournamentId && tournamentContext?.tournament)
    ? tournamentContext.tournament 
    : localTournament;

  return {
    match,
    round,
    course,
    tournament,
    players,
    matchFacts,
    loading,
    error,
  };
}

export default useMatchData;
