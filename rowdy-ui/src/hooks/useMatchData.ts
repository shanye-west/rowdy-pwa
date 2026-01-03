import { useEffect, useState, useRef, useMemo } from "react";
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
  
  const [matchLoaded, setMatchLoaded] = useState(false);
  const [roundLoaded, setRoundLoaded] = useState(false);
  const [courseLoaded, setCourseLoaded] = useState(false);
  const [tournamentLoaded, setTournamentLoaded] = useState(false);
  const [playersLoaded, setPlayersLoaded] = useState(false);
  const [factsLoaded, setFactsLoaded] = useState(false);

  // Try to get tournament from shared context
  const tournamentContext = useTournamentContextOptional();
  const { getTournamentById, addTournament } = tournamentContext || {};
  
  // Cache refs to avoid re-fetching the same tournament/course
  const fetchedTournamentIdRef = useRef<string | undefined>(undefined);
  const fetchedCourseIdRef = useRef<string | undefined>(undefined);

  // 1. Listen to MATCH (optimized for completed matches)
  // Completed+closed matches use one-time read; active matches use real-time subscription
  useEffect(() => {
    if (!matchId) {
      setMatchLoaded(true);
      return;
    }
    
    // Reset ALL loaded states when matchId changes to prevent stale "loaded" flags
    setMatchLoaded(false);
    setRoundLoaded(false);
    setCourseLoaded(false);
    setTournamentLoaded(false);
    setPlayersLoaded(false);
    setFactsLoaded(false);
    
    setError(null);
    // Clear stale data from previous match
    // NOTE: We intentionally keep localTournament to prevent header color flash
    // during navigation within the same tournament. It will be overwritten when
    // the new tournament data loads.
    setMatch(null);
    setRound(null);
    setCourse(null);
    setPlayers({});
    setMatchFacts([]);

    let unsub: (() => void) | undefined;
    
    // Check if match is static (completed + closed) to use one-time read
    const initializeMatch = async () => {
      try {
        const snap = await getDoc(doc(db, "matches", matchId));
        if (!snap.exists()) {
          setMatch(null);
          setMatchLoaded(true);
          return;
        }
        
        const mData = { id: snap.id, ...(snap.data() as any) } as MatchDoc;
        const isStatic = mData.completed && mData.status?.closed;
        
        if (isStatic) {
          // One-time read for static/historical matches (reduces reads by ~80%)
          setMatch(mData);
          setMatchLoaded(true);
          return;
        }
        
        // Real-time subscription for active/in-progress matches
        unsub = onSnapshot(
          doc(db, "matches", matchId),
          (mSnap) => {
            if (!mSnap.exists()) { 
              setMatch(null); 
              setMatchLoaded(true);
              return; 
            }
            
            const updated = { id: mSnap.id, ...(mSnap.data() as any) } as MatchDoc;
            setMatch(updated);
            setMatchLoaded(true);
          },
          (err) => {
            setError(`Failed to load match: ${err.message}`);
            setMatchLoaded(true);
          }
        );
      } catch (err: any) {
        setError(`Failed to load match: ${err.message}`);
        setMatchLoaded(true);
      }
    };
    
    initializeMatch();

    return () => unsub?.();
  }, [matchId]);

  // 2. Subscribe to players once match loads
  // Use stable player IDs string to avoid re-fetching on every match update
  const playerIdsString = match ? 
    Array.from(new Set([
      ...(match.teamAPlayers || []).map((p) => p.playerId).filter(Boolean),
      ...(match.teamBPlayers || []).map((p) => p.playerId).filter(Boolean),
    ])).sort().join(',') : '';
  
  useEffect(() => {
    // Don't mark as loaded until match is loaded
    if (!matchLoaded) return;
    
    if (!match || !playerIdsString) {
      // Match loaded but has no players - this is the "loaded with no players" case
      setPlayersLoaded(true);
      return;
    }

    // Extract unique player IDs from both teams
    const ids = playerIdsString.split(',').filter(Boolean);
    
    if (ids.length === 0) {
      setPlayersLoaded(true);
      return;
    }
    
    setPlayersLoaded(false);

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
        setPlayersLoaded(true);
      })
      .catch(err => {
        if (cancelled) return;
        setError(`Failed to load players: ${err.message}`);
        setPlayersLoaded(true);
      });
    
    return () => { cancelled = true; };
  }, [playerIdsString, matchLoaded]);

  // 3. Listen to ROUND (real-time for score updates)
  const roundId = match?.roundId;
  
  useEffect(() => {
    // Don't mark as loaded until match is loaded
    if (!matchLoaded) return;
    
    if (!roundId) {
      // Match loaded but has no roundId - this is the "loaded with no round" case
      setRoundLoaded(true);
      return;
    }
    
    setRoundLoaded(false);
    
    const unsub = onSnapshot(
      doc(db, "rounds", roundId),
      (rSnap) => {
        if (!rSnap.exists()) {
          setRoundLoaded(true);
          return;
        }
        const rData = { id: rSnap.id, ...(rSnap.data() as any) } as RoundDoc;
        setRound(rData);
        setRoundLoaded(true);
      },
      (err) => {
        setError(`Failed to load round: ${err.message}`);
        setRoundLoaded(true);
      }
    );
    
    return () => unsub();
  }, [roundId, matchLoaded]);

  // 4. Fetch tournament (from context or one-time fetch, cached by ID)
  const tournamentId = round?.tournamentId;
  
  useEffect(() => {
    // Don't mark as loaded until we know the tournamentId (after round loads)
    if (!roundLoaded) return;
    
    if (!tournamentId) {
      // Round loaded but has no tournament - this is the "loaded with no tournament" case
      setTournamentLoaded(true);
      return;
    }
    
    // Check if context has this tournament
    if (tournamentContext?.tournament?.id === tournamentId) {
      setLocalTournament(tournamentContext.tournament);
      setTournamentLoaded(true);
      return;
    }
    
    // Check if it's in the context cache
    const cachedTournament = getTournamentById?.(tournamentId);
    if (cachedTournament) {
      setLocalTournament(cachedTournament);
      fetchedTournamentIdRef.current = tournamentId;
      setTournamentLoaded(true);
      return;
    }
    
    // Skip if we already fetched this tournament
    if (fetchedTournamentIdRef.current === tournamentId && localTournament?.id === tournamentId) {
      setTournamentLoaded(true);
      return;
    }
    
    setTournamentLoaded(false);
    let cancelled = false;
    const tournamentIdToFetch = tournamentId; // Capture for closure
    async function fetchTournament() {
      try {
        const tSnap = await getDoc(doc(db, "tournaments", tournamentIdToFetch));
        if (cancelled) return;
        if (tSnap.exists()) {
          const tournament = ensureTournamentTeamColors({ id: tSnap.id, ...tSnap.data() } as TournamentDoc);
          setLocalTournament(tournament);
          fetchedTournamentIdRef.current = tournamentIdToFetch;
          // Add to context cache for future use
          if (tournament) {
            addTournament?.(tournament);
          }
        }
        setTournamentLoaded(true);
      } catch (err: any) {
        console.error("Failed to fetch tournament:", err);
        setTournamentLoaded(true);
      }
    }
    fetchTournament();
    
    return () => { cancelled = true; };
  }, [tournamentId, tournamentContext?.tournament?.id, roundLoaded]);

  // 5. Fetch course (one-time fetch, cached by ID)
  const courseId = round?.courseId;
  
  useEffect(() => {
    // Don't mark as loaded until we know the courseId (after round loads)
    if (!roundLoaded) return;
    
    if (!courseId) {
      // Round loaded but has no course - this is the "loaded with no course" case
      setCourseLoaded(true);
      return;
    }
    
    // Skip if we already fetched this course
    if (fetchedCourseIdRef.current === courseId && course?.id === courseId) {
      setCourseLoaded(true);
      return;
    }
    
    // Check if context has this course cached (prioritize context cache)
    if (tournamentContext?.courses[courseId]) {
      const cachedCourse = tournamentContext.courses[courseId];
      setCourse(cachedCourse);
      fetchedCourseIdRef.current = courseId;
      setCourseLoaded(true);
      return;
    }
    
    setCourseLoaded(false);
    let cancelled = false;
    const courseIdToFetch = courseId; // Capture for closure
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
        setCourseLoaded(true);
      } catch (err: any) {
        console.error("Failed to fetch course:", err);
        setCourseLoaded(true);
      }
    }
    fetchCourse();
    
    return () => { cancelled = true; };
  }, [courseId, roundLoaded]);

  // 6. Fetch match facts when match closes
  const matchClosed = match?.status?.closed ?? false;
  const factMatchId = match?.id;
  
  useEffect(() => {
    // Don't mark as loaded until match is loaded
    if (!matchLoaded) return;
    
    if (!factMatchId || !matchClosed) {
      // Match loaded but not closed - no facts needed
      setMatchFacts([]);
      setFactsLoaded(true);
      return;
    }
    
    setFactsLoaded(false);
    let cancelled = false;
    async function fetchFacts() {
      try {
        const snap = await getDocs(query(collection(db, "playerMatchFacts"), where("matchId", "==", factMatchId)));
        if (cancelled) return;
        const facts = snap.docs.map(d => ({ ...d.data(), id: d.id } as unknown as PlayerMatchFact));
        setMatchFacts(facts);
        setFactsLoaded(true);
      } catch (err: any) {
        console.error("Failed to fetch match facts:", err);
        setFactsLoaded(true);
      }
    }
    fetchFacts();
    
    return () => { cancelled = true; };
  }, [factMatchId, matchClosed, matchLoaded]);

  // Coordinate all loading states
  useEffect(() => {
    const allLoaded = matchLoaded && roundLoaded && courseLoaded && tournamentLoaded && playersLoaded && factsLoaded;
    setLoading(!allLoaded);
  }, [matchLoaded, roundLoaded, courseLoaded, tournamentLoaded, playersLoaded, factsLoaded]);

  // Use tournament from context if available, otherwise check cache, then local fetch
  // During initial load, use context's tournament as fallback to prevent header flash
  const tournament = useMemo(() => {
    const tournamentId = round?.tournamentId;
    
    // If we have a specific tournamentId, try to find the matching tournament
    if (tournamentId) {
      // Check if context has this tournament as the main tournament
      if (tournamentContext?.tournament?.id === tournamentId) {
        return tournamentContext.tournament;
      }
      
      // Check cache synchronously
      const cached = getTournamentById?.(tournamentId);
      if (cached) {
        return cached;
      }
      
      // Fall back to local fetch result
      if (localTournament) {
        return localTournament;
      }
    }
    
    // During loading (no tournamentId yet), use any available tournament data:
    // 1. Preserved localTournament from previous match in same tournament
    // 2. Context's active tournament (most common navigation case)
    // This prevents header flash with default colors during navigation
    return localTournament ?? tournamentContext?.tournament ?? null;
  }, [round?.tournamentId, tournamentContext?.tournament, getTournamentById, localTournament]);

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
