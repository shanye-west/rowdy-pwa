import { useEffect, useState, useRef, useMemo } from "react";
import { doc, onSnapshot, collection, where, query } from "firebase/firestore";
import { db } from "../firebase";
import type { TournamentDoc, PlayerDoc, MatchDoc, RoundDoc, CourseDoc, PlayerMatchFact } from "../types";
import { ensureTournamentTeamColors } from "../utils/teamColors";
import { useTournamentContextOptional, usePlayers } from "../contexts/TournamentContext";
import { getDocCacheFirst, getDocsCacheFirst } from "../utils/firestoreReads";
import { useResolvedLoading } from "./useResolvedLoading";

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
  /**
   * True when the match doc has local writes not yet acknowledged by the
   * server (i.e. queued offline / mid-sync). Sourced from Firestore snapshot
   * metadata; only meaningful for active matches (static reads are never dirty).
   */
  hasPendingWrites: boolean;
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
  const [matchFacts, setMatchFacts] = useState<PlayerMatchFact[]>([]);
  const [rawLoading, setRawLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasPendingWrites, setHasPendingWrites] = useState(false);
  
  const [matchLoaded, setMatchLoaded] = useState(false);
  const [roundLoaded, setRoundLoaded] = useState(false);
  const [courseLoaded, setCourseLoaded] = useState(false);
  const [tournamentLoaded, setTournamentLoaded] = useState(false);
  const [factsLoaded, setFactsLoaded] = useState(false);

  // Try to get tournament from shared context
  const tournamentContext = useTournamentContextOptional();
  const { getTournamentById, addTournament } = tournamentContext || {};
  
  // Cache refs to avoid re-fetching the same tournament/course
  const fetchedTournamentIdRef = useRef<string | undefined>(undefined);
  const fetchedCourseIdRef = useRef<string | undefined>(undefined);

  // Holds the last match document data we pushed to state (serialized). Lets us
  // skip metadata-only snapshots (hasPendingWrites flips) where the document
  // payload is unchanged, so the scorecard doesn't re-render every sync tick.
  const lastMatchJsonRef = useRef<string | null>(null);

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
    setFactsLoaded(false);
    
    setError(null);
    // Clear stale data from previous match
    // NOTE: We intentionally keep localTournament to prevent header color flash
    // during navigation within the same tournament. It will be overwritten when
    // the new tournament data loads.
    setMatch(null);
    setRound(null);
    setCourse(null);
    setMatchFacts([]);
    setHasPendingWrites(false);
    lastMatchJsonRef.current = null;

    // Attach the listener directly — onSnapshot is cache-first, so the first
    // emission arrives instantly from IndexedDB (no blocking server round-trip).
    // includeMetadataChanges lets us surface hasPendingWrites (queued writes not
    // yet acked by the server) so the UI can confirm sync state, and lets us see
    // the cache→server transition. For static (completed + closed) matches we
    // drop the listener once the server confirms it, so historical matches don't
    // hold an open subscription (the ~80% read win) — read cost matches the old
    // one-time fetch while still painting instantly from cache.
    let unsub: (() => void) | undefined = onSnapshot(
      doc(db, "matches", matchId),
      { includeMetadataChanges: true },
      (mSnap) => {
        if (!mSnap.exists()) {
          setMatch(null);
          lastMatchJsonRef.current = null;
          setMatchLoaded(true);
          setHasPendingWrites(false);
          return;
        }

        const mData = { id: mSnap.id, ...(mSnap.data() as any) } as MatchDoc;

        // Sync-state always tracks the latest snapshot...
        setHasPendingWrites(mSnap.metadata.hasPendingWrites);
        setMatchLoaded(true);

        // ...but only push new match state when the document payload actually
        // changed. includeMetadataChanges fires this listener on every
        // pending-write flip; skipping no-op data updates stops the scorecard
        // from re-rendering ~1-2x/sec during active scoring.
        const dataJson = JSON.stringify(mSnap.data());
        if (dataJson !== lastMatchJsonRef.current) {
          lastMatchJsonRef.current = dataJson;
          setMatch(mData);
        }

        // Static/historical match → drop the realtime listener, but only once the
        // server has confirmed it (not on a cache-only snapshot, which could pin
        // us to a stale copy if the match was reopened server-side). onSnapshot
        // resolves the synchronously-returned `unsub` before any callback fires,
        // so it's safe to call here; the effect cleanup then no-ops.
        if (mData.completed && mData.status?.closed && !mSnap.metadata.fromCache) {
          unsub?.();
          unsub = undefined;
        }
      },
      (err) => {
        setError(`Failed to load match: ${err.message}`);
        setMatchLoaded(true);
      }
    );

    return () => unsub?.();
  }, [matchId]);

  // 2. Resolve player docs from the shared cache once the match loads. The
  // match's players are usually already warmed from the tournament roster, so
  // this typically resolves from cache without a read.
  const matchPlayerIds = useMemo(
    () =>
      match
        ? Array.from(
            new Set([
              ...(match.teamAPlayers || []).map((p) => p.playerId).filter(Boolean),
              ...(match.teamBPlayers || []).map((p) => p.playerId).filter(Boolean),
            ])
          )
        : [],
    [match]
  );
  const { players, loaded: playersLoaded } = usePlayers(matchPlayerIds);

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
        // Cache-first: a non-active/historical tournament is effectively static
        // for the session, so the cached copy is fine and won't block on a slow
        // connection. The active tournament stays fresh via the context.
        const tSnap = await getDocCacheFirst(doc(db, "tournaments", tournamentIdToFetch));
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
        // Courses are static during a tournament — cache-first avoids blocking
        // the scorecard on a slow connection for data we already have.
        const cSnap = await getDocCacheFirst(doc(db, "courses", courseIdToFetch));
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
        const snap = await getDocsCacheFirst(query(collection(db, "playerMatchFacts"), where("matchId", "==", factMatchId)));
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
    setRawLoading(!allLoaded);
  }, [matchLoaded, roundLoaded, courseLoaded, tournamentLoaded, playersLoaded, factsLoaded]);

  // Never spin forever: once we have the match loaded, a wedged secondary read
  // (course/facts on a stalled connection) stops blocking after the timeout so
  // the scorecard renders with cached/partial data instead of an endless spinner.
  const loading = useResolvedLoading(rawLoading, match !== null);

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
    hasPendingWrites,
  };
}

export default useMatchData;
