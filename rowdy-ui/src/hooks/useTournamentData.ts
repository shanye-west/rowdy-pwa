/**
 * useTournamentData - Shared hook for tournament data fetching
 * 
 * Consolidates the common pattern of fetching:
 * - Tournament (by ID or active tournament)
 * - Rounds (for the tournament)
 * - Matches (grouped by roundId)
 * - Courses (lookup by courseId)
 * - Computed stats (finalScores, pendingScores, roundStats)
 */

import { useEffect, useMemo, useState } from "react";
import { collection, doc, query, where, onSnapshot, limit, documentId } from "firebase/firestore";
import { db } from "../firebase";
import type { TournamentDoc, RoundDoc, MatchDoc, CourseDoc } from "../types";
import { ensureTournamentTeamColors } from "../utils/teamColors";

// ============================================================================
// TYPES
// ============================================================================

export interface TournamentStats {
  /** Team A's confirmed (closed match) points */
  teamAConfirmed: number;
  /** Team B's confirmed (closed match) points */
  teamBConfirmed: number;
  /** Team A's pending (in-progress match) points */
  teamAPending: number;
  /** Team B's pending (in-progress match) points */
  teamBPending: number;
}

export interface RoundStats {
  teamAConfirmed: number;
  teamBConfirmed: number;
  teamAPending: number;
  teamBPending: number;
}

export interface UseTournamentDataResult {
  /** Loading state - true until initial data is fetched */
  loading: boolean;
  /** Error message if something failed */
  error: string | null;
  /** The tournament document */
  tournament: TournamentDoc | null;
  /** Rounds sorted by day */
  rounds: RoundDoc[];
  /** Matches grouped by roundId */
  matchesByRound: Record<string, MatchDoc[]>;
  /** Courses lookup by courseId */
  courses: Record<string, CourseDoc>;
  /** Courses lookup by roundId (convenience) */
  coursesByRound: Record<string, CourseDoc | null>;
  /** Aggregated tournament stats */
  stats: TournamentStats;
  /** Per-round stats */
  roundStats: Record<string, RoundStats>;
  /** Total points available in tournament */
  totalPointsAvailable: number;
}

export interface UseTournamentDataOptions {
  /** Fetch the active tournament (ignores tournamentId) */
  fetchActive?: boolean;
  /** Specific tournament ID to fetch */
  tournamentId?: string;
}

// ============================================================================
// HOOK
// ============================================================================

export function useTournamentData(options: UseTournamentDataOptions = {}): UseTournamentDataResult {
  const { fetchActive = false, tournamentId } = options;

  // State
  const [tournament, setTournament] = useState<TournamentDoc | null>(null);
  const [rounds, setRounds] = useState<RoundDoc[]>([]);
  const [matchesByRound, setMatchesByRound] = useState<Record<string, MatchDoc[]>>({});
  const [courses, setCourses] = useState<Record<string, CourseDoc>>({});
  const [error, setError] = useState<string | null>(null);

  // Loading states for coordination
  const [tournamentLoaded, setTournamentLoaded] = useState(false);
  const [roundsLoaded, setRoundsLoaded] = useState(false);
  const [matchesLoaded, setMatchesLoaded] = useState(false);

  // Derived loading state
  const loading = !tournamentLoaded || (tournament !== null && (!roundsLoaded || !matchesLoaded));

  // -------------------------------------------------------------------------
  // 1) Subscribe to tournament
  // -------------------------------------------------------------------------
  useEffect(() => {
    // Reset state when options change
    setTournament(null);
    setRounds([]);
    setMatchesByRound({});
    setTournamentLoaded(false);
    setRoundsLoaded(false);
    setMatchesLoaded(false);
    setError(null);

    if (fetchActive) {
      // Fetch the active tournament
      const unsub = onSnapshot(
        query(collection(db, "tournaments"), where("active", "==", true), limit(1)),
        (snap) => {
          if (snap.empty) {
            setTournament(null);
          } else {
            const d = snap.docs[0];
            setTournament(ensureTournamentTeamColors({ id: d.id, ...d.data() } as TournamentDoc));
          }
          setTournamentLoaded(true);
        },
        (err) => {
          console.error("Tournament subscription error:", err);
          setError("Unable to load tournament.");
          setTournamentLoaded(true);
        }
      );
      return () => unsub();
    } else if (tournamentId) {
      // Fetch specific tournament by ID
      const unsub = onSnapshot(
        doc(db, "tournaments", tournamentId),
        (snap) => {
            if (snap.exists()) {
            setTournament(ensureTournamentTeamColors({ id: snap.id, ...snap.data() } as TournamentDoc));
          } else {
            setTournament(null);
            setError("Tournament not found.");
          }
          setTournamentLoaded(true);
        },
        (err) => {
          console.error("Tournament subscription error:", err);
          setError("Unable to load tournament.");
          setTournamentLoaded(true);
        }
      );
      return () => unsub();
    } else {
      // No tournament to fetch
      setTournamentLoaded(true);
      setRoundsLoaded(true);
      setMatchesLoaded(true);
    }
  }, [fetchActive, tournamentId]);

  // -------------------------------------------------------------------------
  // 2) Subscribe to rounds when tournament is loaded
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!tournament?.id) {
      setRounds([]);
      if (tournamentLoaded) setRoundsLoaded(true);
      return;
    }

    const unsub = onSnapshot(
      query(collection(db, "rounds"), where("tournamentId", "==", tournament.id)),
      (snap) => {
        let rds = snap.docs.map(d => ({ id: d.id, ...d.data() } as RoundDoc));
        // Sort by day, then by id for consistency
        rds = rds.sort((a, b) => (a.day ?? 0) - (b.day ?? 0) || a.id.localeCompare(b.id));
        setRounds(rds);
        setRoundsLoaded(true);
      },
      (err) => {
        console.error("Rounds subscription error:", err);
        setRoundsLoaded(true);
      }
    );
    return () => unsub();
  }, [tournament?.id, tournamentLoaded]);

  // -------------------------------------------------------------------------
  // 3) Subscribe to matches for the tournament (grouped by roundId)
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!tournament?.id) {
      setMatchesByRound({});
      if (tournamentLoaded) setMatchesLoaded(true);
      return;
    }

    const unsub = onSnapshot(
      query(collection(db, "matches"), where("tournamentId", "==", tournament.id)),
      (snap) => {
        const bucket: Record<string, MatchDoc[]> = {};
        snap.docs.forEach(d => {
          const match = { id: d.id, ...d.data() } as MatchDoc;
          if (match.roundId) {
            if (!bucket[match.roundId]) bucket[match.roundId] = [];
            bucket[match.roundId].push(match);
          }
        });
        // Sort matches within each round by matchNumber
        Object.values(bucket).forEach(arr => {
          arr.sort((a, b) => (a.matchNumber ?? 0) - (b.matchNumber ?? 0) || a.id.localeCompare(b.id));
        });
        setMatchesByRound(bucket);
        setMatchesLoaded(true);
      },
      (err) => {
        console.error("Matches subscription error:", err);
        setMatchesLoaded(true);
      }
    );
    return () => unsub();
  }, [tournament?.id, tournamentLoaded]);

  // -------------------------------------------------------------------------
  // 4) Subscribe to only courses needed by current tournament rounds
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (rounds.length === 0) {
      setCourses({});
      return;
    }
    
    // Extract unique courseIds from rounds
    const courseIds = [...new Set(rounds.map(r => r.courseId).filter(Boolean) as string[])];
    if (courseIds.length === 0) {
      setCourses({});
      return;
    }
    
    // Batch courseIds into groups of 10 (Firestore 'in' query limit)
    const batches: string[][] = [];
    for (let i = 0; i < courseIds.length; i += 10) {
      batches.push(courseIds.slice(i, i + 10));
    }
    
    const unsubscribers: (() => void)[] = [];
    
    batches.forEach(batch => {
      const unsub = onSnapshot(
        query(collection(db, "courses"), where(documentId(), "in", batch)),
        (snap) => {
          setCourses(prev => {
            const updated = { ...prev };
            snap.docs.forEach(d => {
              updated[d.id] = { id: d.id, ...d.data() } as CourseDoc;
            });
            return updated;
          });
        },
        (err) => console.error("Courses subscription error:", err)
      );
      unsubscribers.push(unsub);
    });
    
    return () => unsubscribers.forEach(u => u());
  }, [rounds]);

  // -------------------------------------------------------------------------
  // Derived: coursesByRound lookup
  // -------------------------------------------------------------------------
  const coursesByRound = useMemo(() => {
    const result: Record<string, CourseDoc | null> = {};
    rounds.forEach(r => {
      result[r.id] = r.courseId ? (courses[r.courseId] || null) : null;
    });
    return result;
  }, [rounds, courses]);

  // -------------------------------------------------------------------------
  // Derived: Stats calculation
  // -------------------------------------------------------------------------
  const { stats, roundStats, totalPointsAvailable } = useMemo(() => {
    let fA = 0, fB = 0, pA = 0, pB = 0;
    let totalPts = 0;
    const rStats: Record<string, RoundStats> = {};

    // Build pointsValue lookup
    const roundPvLookup: Record<string, number> = {};
    rounds.forEach(r => {
      rStats[r.id] = { teamAConfirmed: 0, teamBConfirmed: 0, teamAPending: 0, teamBPending: 0 };
      roundPvLookup[r.id] = r.pointsValue ?? 1;
    });

    const allMatches = Object.values(matchesByRound).flat();

    for (const m of allMatches) {
      const pv = m.roundId ? (roundPvLookup[m.roundId] ?? 1) : 1;
      const w = m.result?.winner;

      const ptsA = w === "teamA" ? pv : w === "AS" ? pv / 2 : 0;
      const ptsB = w === "teamB" ? pv : w === "AS" ? pv / 2 : 0;

      const isClosed = m.status?.closed === true;
      const isStarted = (m.status?.thru ?? 0) > 0;

      if (isClosed) {
        fA += ptsA;
        fB += ptsB;
      } else if (isStarted) {
        pA += ptsA;
        pB += ptsB;
      }

      if (m.roundId && rStats[m.roundId]) {
        if (isClosed) {
          rStats[m.roundId].teamAConfirmed += ptsA;
          rStats[m.roundId].teamBConfirmed += ptsB;
        } else if (isStarted) {
          rStats[m.roundId].teamAPending += ptsA;
          rStats[m.roundId].teamBPending += ptsB;
        }
      }

      totalPts += pv;
    }

    // Use tournament.totalPointsAvailable if set, otherwise calculated
    const finalTotalPts = tournament?.totalPointsAvailable ?? totalPts;

    return {
      stats: {
        teamAConfirmed: fA,
        teamBConfirmed: fB,
        teamAPending: pA,
        teamBPending: pB,
      },
      roundStats: rStats,
      totalPointsAvailable: finalTotalPts,
    };
  }, [matchesByRound, rounds, tournament?.totalPointsAvailable]);

  return {
    loading,
    error,
    tournament,
    rounds,
    matchesByRound,
    courses,
    coursesByRound,
    stats,
    roundStats,
    totalPointsAvailable,
  };
}
