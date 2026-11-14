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

import { useEffect, useMemo, useState, useRef } from "react";
import { collection, doc, query, where, onSnapshot, limit, documentId, type QuerySnapshot, type DocumentData } from "firebase/firestore";
import { db } from "../firebase";
import type { TournamentDoc, RoundDoc, MatchDoc, CourseDoc } from "../types";
import { ensureTournamentTeamColors } from "../utils/teamColors";
import { useResolvedLoading } from "./useResolvedLoading";
import { getDocsCacheFirst, getDocsByIdCacheFirst } from "../utils/firestoreReads";
import { FIRESTORE_IN_QUERY_LIMIT } from "../constants";

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
  /**
   * A tournament the caller already subscribes to (e.g. from TournamentContext).
   * When provided, this hook uses it directly instead of opening a second
   * subscription to the same document. `null` is a valid value (no active
   * tournament); pass `undefined` (omit) to let the hook subscribe itself.
   */
  prefetchedTournament?: TournamentDoc | null;
  /**
   * Prefer the denormalized `round.pointTotals` (written server-side) for the
   * aggregate stats. When every round carries totals, the hook skips the
   * all-matches subscription entirely — a large read reduction for spectator
   * views. Falls back to the matches subscription for rounds without totals.
   */
  preferDenormalizedTotals?: boolean;
  /**
   * For callers that need per-match data (so can't use denormalized totals):
   * fetch matches of locked rounds once, cache-first (they're static), and keep
   * a live subscription only on matches of unlocked rounds. Mirrors the
   * locked/unlocked split in useRoundData. With every round locked, no live
   * match listener remains at all.
   */
  splitLockedRounds?: boolean;
}

// ============================================================================
// HOOK
// ============================================================================

export function useTournamentData(options: UseTournamentDataOptions = {}): UseTournamentDataResult {
  const { fetchActive = false, tournamentId, prefetchedTournament, preferDenormalizedTotals = false, splitLockedRounds = false } = options;

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

  // Derived loading state. The tournament/rounds/matches all use cache-first
  // onSnapshot, so returning users resolve from IndexedDB instantly; the
  // watchdog backstops a wedged connection so we render cached/partial data
  // rather than spinning forever once a tournament is in hand.
  // When the caller hands in its tournament, there is one render between the
  // prop arriving and effect 1 copying it into state. During it the flags still
  // describe the PREVIOUS (usually "no tournament", fully loaded) state, so the
  // page rendered for a frame, mounted its children — Home's captains' match
  // opened and immediately dropped a billed listener — then fell back to the
  // skeleton. Treat a prop/state mismatch as still loading.
  const prefetchPending =
    prefetchedTournament !== undefined && (prefetchedTournament?.id ?? null) !== (tournament?.id ?? null);
  const rawLoading = prefetchPending || !tournamentLoaded || (tournament !== null && (!roundsLoaded || !matchesLoaded));
  const loading = useResolvedLoading(rawLoading, tournament !== null);

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

    // #3: caller already subscribes to this tournament (e.g. TournamentContext).
    // Use it directly rather than opening a duplicate subscription on the same doc.
    if (prefetchedTournament !== undefined) {
      setTournament(prefetchedTournament);
      setTournamentLoaded(true);
      return;
    }

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
  }, [fetchActive, tournamentId, prefetchedTournament]);

  // -------------------------------------------------------------------------
  // 2) Subscribe to rounds when tournament is loaded
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!tournament?.id) {
      setRounds([]);
      if (tournamentLoaded) setRoundsLoaded(true);
      return;
    }

    // The tournament doc carries a server-maintained list of its rounds
    // (linkRoundToTournament / deleteRound). When that list is empty there is
    // nothing to query — and querying anyway is slow as well as a billed read:
    // Firestore won't serve an EMPTY result from cache while online, so the
    // page sat on its skeleton until the server answered (measured ~1–1.5 s on
    // Home for a tournament with only a captains' match). A round created later
    // updates roundIds, which re-runs this effect and attaches the listener.
    // Only an empty list is trusted; a missing or non-empty one still queries.
    const noRounds = Array.isArray(tournament.roundIds) && tournament.roundIds.length === 0;
    if (noRounds) {
      setRounds([]);
      setRoundsLoaded(true);
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
    // Keyed on whether the list is empty, not its contents: the listener itself
    // tracks round changes once attached.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournament?.id, tournamentLoaded, Array.isArray(tournament?.roundIds) && tournament.roundIds.length === 0]);

  // Whether every loaded round carries denormalized totals. When so (and the
  // caller opted in), aggregate stats come straight from the rounds collection
  // and the matches subscription below is skipped entirely.
  const hasRounds = rounds.length > 0;
  const allRoundsHaveTotals = hasRounds && rounds.every(r => r.pointTotals !== undefined);
  const useDenormalized = preferDenormalizedTotals && allRoundsHaveTotals;

  // Stable signatures of the locked/unlocked round-id sets. The rounds snapshot
  // fires on every score change (pointTotals is denormalized live), so keying
  // the matches effect on these strings — not the rounds array — keeps a round
  // doc update from tearing down and recreating the match listeners.
  //
  // Rounds whose (server-maintained) matchIds list is empty are left out: they
  // have no matches to read, and an empty query is both a billed read and slow
  // — Firestore won't serve an empty result from cache while online, so the
  // page waited on the server (e.g. Bets before a round's pairings exist).
  // Seeding the first match adds to matchIds, which changes these keys and
  // attaches the query.
  const hasMatches = (r: RoundDoc) => !Array.isArray(r.matchIds) || r.matchIds.length > 0;
  const lockedRoundIdsKey = useMemo(
    () => rounds.filter(r => r.locked && hasMatches(r)).map(r => r.id).sort().join(","),
    [rounds]
  );
  const unlockedRoundIdsKey = useMemo(
    () => rounds.filter(r => !r.locked && hasMatches(r)).map(r => r.id).sort().join(","),
    [rounds]
  );

  // -------------------------------------------------------------------------
  // 3) Subscribe to matches for the tournament (grouped by roundId)
  // Skipped when denormalized round totals are available — the big read win.
  // With `splitLockedRounds`, locked rounds are read once (cache-first) and
  // only unlocked rounds keep a live subscription.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!tournament?.id) {
      setMatchesByRound({});
      if (tournamentLoaded) setMatchesLoaded(true);
      return;
    }

    // When the caller prefers denormalized totals, wait until rounds are known
    // before deciding whether to subscribe — this avoids an initial matches read
    // burst that we'd immediately discard once totals are confirmed present.
    if (preferDenormalizedTotals) {
      if (!roundsLoaded) return; // still loading rounds; keep matches "not loaded"
      // No rounds means nothing to total — don't hold a listener on an empty
      // result (e.g. a tournament that so far only has a captains' match).
      if (useDenormalized || !hasRounds) {
        setMatchesByRound({});
        setMatchesLoaded(true);
        return;
      }
    }

    const bucketSnap = (snap: QuerySnapshot<DocumentData>) => {
      const bucket: Record<string, MatchDoc[]> = {};
      snap.docs.forEach(d => {
        const match = { id: d.id, ...d.data() } as MatchDoc;
        if (match.roundId) {
          if (!bucket[match.roundId]) bucket[match.roundId] = [];
          bucket[match.roundId].push(match);
        }
      });
      Object.values(bucket).forEach(arr => {
        arr.sort((a, b) => (a.matchNumber ?? 0) - (b.matchNumber ?? 0) || a.id.localeCompare(b.id));
      });
      return bucket;
    };

    if (splitLockedRounds) {
      if (!roundsLoaded) return; // need the lock state of each round first
      const lockedIds = lockedRoundIdsKey ? lockedRoundIdsKey.split(",") : [];
      const unlockedIds = unlockedRoundIdsKey ? unlockedRoundIdsKey.split(",") : [];

      if (lockedIds.length === 0 && unlockedIds.length === 0) {
        setMatchesByRound({});
        setMatchesLoaded(true);
        return;
      }

      let cancelled = false;
      const unsubs: Array<() => void> = [];
      // Locked and unlocked cover disjoint roundIds, and each `in` chunk covers
      // disjoint roundIds within its source, so merging by key is safe.
      const staticBucket: Record<string, MatchDoc[]> = {};
      const liveBuckets: Record<number, Record<string, MatchDoc[]>> = {};
      let staticPending = lockedIds.length > 0 ? 1 : 0;
      let livePending = 0;

      const publish = () => {
        if (cancelled) return;
        const merged: Record<string, MatchDoc[]> = { ...staticBucket };
        Object.values(liveBuckets).forEach(chunkBucket => {
          Object.assign(merged, chunkBucket);
        });
        setMatchesByRound(merged);
        if (staticPending === 0 && livePending === 0) setMatchesLoaded(true);
      };

      const chunk = (ids: string[]) => {
        const out: string[][] = [];
        for (let i = 0; i < ids.length; i += FIRESTORE_IN_QUERY_LIMIT) {
          out.push(ids.slice(i, i + FIRESTORE_IN_QUERY_LIMIT));
        }
        return out;
      };

      if (lockedIds.length > 0) {
        // Locked rounds = static result sets → one-time cache-first reads.
        Promise.all(
          chunk(lockedIds).map(async ids => {
            const snap = await getDocsCacheFirst(
              query(collection(db, "matches"), where("roundId", "in", ids))
            );
            Object.assign(staticBucket, bucketSnap(snap));
          })
        )
          .catch(err => console.error("Locked-round matches fetch error:", err))
          .finally(() => {
            staticPending = 0;
            publish();
          });
      }

      chunk(unlockedIds).forEach((ids, i) => {
        livePending += 1;
        let delivered = false;
        unsubs.push(
          onSnapshot(
            query(collection(db, "matches"), where("roundId", "in", ids)),
            (snap) => {
              liveBuckets[i] = bucketSnap(snap);
              if (!delivered) {
                delivered = true;
                livePending -= 1;
              }
              publish();
            },
            (err) => {
              console.error("Matches subscription error:", err);
              if (!delivered) {
                delivered = true;
                livePending -= 1;
              }
              publish();
            }
          )
        );
      });

      return () => {
        cancelled = true;
        unsubs.forEach(u => u());
      };
    }

    const unsub = onSnapshot(
      query(collection(db, "matches"), where("tournamentId", "==", tournament.id)),
      (snap) => {
        setMatchesByRound(bucketSnap(snap));
        setMatchesLoaded(true);
      },
      (err) => {
        console.error("Matches subscription error:", err);
        setMatchesLoaded(true);
      }
    );
    return () => unsub();
  }, [tournament?.id, tournamentLoaded, preferDenormalizedTotals, roundsLoaded, useDenormalized, hasRounds, splitLockedRounds, lockedRoundIdsKey, unlockedRoundIdsKey]);

  // -------------------------------------------------------------------------
  // 4) Fetch courses needed by current tournament rounds (ONE-TIME, not subscription)
  // Course data is static during a tournament, so real-time updates are unnecessary.
  // This optimization reduces Firestore reads by eliminating persistent subscriptions.
  // -------------------------------------------------------------------------
  const fetchedCourseIdsRef = useRef<Set<string>>(new Set());
  
  useEffect(() => {
    if (rounds.length === 0) {
      setCourses({});
      return;
    }
    
    // Extract unique courseIds from rounds that haven't been fetched yet
    const allCourseIds = [...new Set(rounds.map(r => r.courseId).filter(Boolean) as string[])];
    const courseIdsToFetch = allCourseIds.filter(id => !fetchedCourseIdsRef.current.has(id));
    
    if (courseIdsToFetch.length === 0) {
      return; // All courses already fetched
    }
    
    let cancelled = false;
    
    async function fetchCourses() {
      try {
        // Batch courseIds into groups of 10 (Firestore 'in' query limit)
        const batches: string[][] = [];
        for (let i = 0; i < courseIdsToFetch.length; i += 10) {
          batches.push(courseIdsToFetch.slice(i, i + 10));
        }
        
        const fetchedCourses: Record<string, CourseDoc> = {};
        const toCourses = (snap: QuerySnapshot<DocumentData>) => {
          const out: Record<string, CourseDoc> = {};
          snap.docs.forEach(d => { out[d.id] = { id: d.id, ...d.data() } as CourseDoc; });
          return out;
        };

        // Cache-first (trusted only when every course in the batch is cached):
        // courses are effectively static, and a server-first read left the
        // schedule's course names waiting on the network at every cold start.
        // The background revalidation still picks up an edited course.
        await Promise.all(batches.map(async (batch) => {
          const snap = await getDocsByIdCacheFirst(
            query(collection(db, "courses"), where(documentId(), "in", batch)),
            batch,
            (fresh) => {
              if (cancelled) return;
              const freshCourses = toCourses(fresh);
              setCourses(prev => {
                const changed = Object.entries(freshCourses).some(
                  ([id, c]) => JSON.stringify(prev[id]) !== JSON.stringify(c)
                );
                return changed ? { ...prev, ...freshCourses } : prev;
              });
            },
          );
          Object.assign(fetchedCourses, toCourses(snap));
        }));
        
        if (cancelled) return;

        // Mark fetched only once the result is actually applied: marking before
        // the cancel check meant a rounds update landing mid-fetch dropped the
        // courses AND stopped them ever being requested again.
        Object.keys(fetchedCourses).forEach(id => fetchedCourseIdsRef.current.add(id));
        setCourses(prev => ({ ...prev, ...fetchedCourses }));
      } catch (err) {
        console.error("Courses fetch error:", err);
      }
    }
    
    fetchCourses();
    
    return () => { cancelled = true; };
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

    // Denormalized path: read per-round totals straight off the round docs (no
    // matches subscription needed). Mirrors the match-based math below exactly.
    if (useDenormalized) {
      rounds.forEach(r => {
        const pt = r.pointTotals!;
        rStats[r.id] = {
          teamAConfirmed: pt.teamAConfirmed,
          teamBConfirmed: pt.teamBConfirmed,
          teamAPending: pt.teamAPending,
          teamBPending: pt.teamBPending,
        };
        fA += pt.teamAConfirmed;
        fB += pt.teamBConfirmed;
        pA += pt.teamAPending;
        pB += pt.teamBPending;
        totalPts += (r.pointsValue ?? 1) * (pt.matchCount ?? 0);
      });

      const finalTotalPts = tournament?.totalPointsAvailable ?? totalPts;
      return {
        stats: { teamAConfirmed: fA, teamBConfirmed: fB, teamAPending: pA, teamBPending: pB },
        roundStats: rStats,
        totalPointsAvailable: finalTotalPts,
      };
    }

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
  }, [matchesByRound, rounds, tournament?.totalPointsAvailable, useDenormalized]);

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
