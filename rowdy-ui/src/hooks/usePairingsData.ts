/**
 * Shared data plumbing for the two captain-facing pairings screens — the live
 * draft (`/round/:id/pairings`) and the private plan (`/round/:id/plan`). Both
 * need the same round/tournament/course bundle and the same player lookups, so
 * they live here instead of being re-derived on each page.
 */

import { useEffect, useMemo, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import { getErrorMessage } from "../api/errors";
import { calculateCourseHandicap } from "../utils/ghin";
import { playerTierLookup, type Tier } from "../utils/roster";
import { isScrambleFormat, isShambleFormat } from "../types";
import type { PairingsMeta } from "../components/pairings/types";
import type {
  CourseDoc,
  DraftTeamKey,
  PlayerDoc,
  RoundDoc,
  RoundFormat,
  TournamentDoc,
} from "../types";

const TEAM_FALLBACK: Record<DraftTeamKey, string> = { teamA: "Team A", teamB: "Team B" };

/** Players per side for a round format (2 for every current pairs format). */
export function formatPlayersPerSide(format: RoundFormat | null | undefined): number {
  if (format === "singles") return 1;
  if (format === "fourManScramble") return 4;
  return 2;
}

export interface RoundPairingData {
  round: RoundDoc | null;
  tournament: TournamentDoc | null;
  course: CourseDoc | null;
  loading: boolean;
  error: string | null;
}

/** One-shot load of a round plus its tournament and course (all public-read). */
export function useRoundPairingData(roundId: string | null | undefined): RoundPairingData {
  const [round, setRound] = useState<RoundDoc | null>(null);
  const [tournament, setTournament] = useState<TournamentDoc | null>(null);
  const [course, setCourse] = useState<CourseDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!roundId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const rSnap = await getDoc(doc(db, "rounds", roundId));
        if (!rSnap.exists()) {
          if (!cancelled) setError("Round not found");
          return;
        }
        const r = { id: rSnap.id, ...rSnap.data() } as RoundDoc;
        const [tSnap, cSnap] = await Promise.all([
          r.tournamentId ? getDoc(doc(db, "tournaments", r.tournamentId)) : Promise.resolve(null),
          r.courseId ? getDoc(doc(db, "courses", r.courseId)) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setRound(r);
        setTournament(tSnap?.exists() ? ({ id: tSnap.id, ...tSnap.data() } as TournamentDoc) : null);
        setCourse(cSnap?.exists() ? ({ id: cSnap.id, ...cSnap.data() } as CourseDoc) : null);
      } catch (e) {
        if (!cancelled) setError(getErrorMessage(e, "Failed to load round"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roundId]);

  return { round, tournament, course, loading, error };
}

export interface PairingsMetaOptions {
  tournament: TournamentDoc | null;
  course: CourseDoc | null;
  players: PlayerDoc[];
  format: RoundFormat | null | undefined;
  /** The draft's frozen tier snapshot; falls back to the tournament's rosters. */
  tierByPlayer?: Record<string, "A" | "B" | "C" | "D"> | null;
}

/** The shared view-model the pairings components render from. */
export function usePairingsMeta({
  tournament,
  course,
  players,
  format,
  tierByPlayer,
}: PairingsMetaOptions): PairingsMeta {
  const handicapByPlayer = useMemo(
    () => ({ ...(tournament?.teamA?.handicapByPlayer || {}), ...(tournament?.teamB?.handicapByPlayer || {}) }),
    [tournament]
  );
  const courseParams = useMemo(() => {
    if (!course) return null;
    return {
      slope: course.slope ?? 113,
      rating: typeof course.rating === "number" ? course.rating : course.par ?? 72,
      par: course.par ?? 72,
    };
  }, [course]);
  const tierLookup = useMemo(
    () => tierByPlayer ?? playerTierLookup(tournament),
    [tierByPlayer, tournament]
  );
  const nameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of players) m.set(p.id, p.displayName || p.id);
    return m;
  }, [players]);

  return useMemo(
    () => ({
      players,
      nameOf: (pid: string) => nameMap.get(pid) ?? pid,
      chOf: (pid: string) => {
        if (!courseParams) return null;
        const hi = handicapByPlayer[pid];
        if (typeof hi !== "number") return null;
        return Math.round(calculateCourseHandicap(hi, courseParams.slope, courseParams.rating, courseParams.par));
      },
      tierOf: (pid: string) => tierLookup[pid] as Tier | undefined,
      teamName: (team: DraftTeamKey) => tournament?.[team]?.name || TEAM_FALLBACK[team],
      teamColor: (team: DraftTeamKey) =>
        tournament?.[team]?.color || (team === "teamA" ? "var(--team-a-default)" : "var(--team-b-default)"),
      teamLogo: (team: DraftTeamKey) => tournament?.[team]?.logo,
      grossOnly: isScrambleFormat(format) || isShambleFormat(format),
    }),
    [players, nameMap, courseParams, handicapByPlayer, tierLookup, tournament, format]
  );
}

/**
 * Which team (if either) the signed-in player captains. Co-captains count; an
 * admin who captains neither team gets null — captaincy, not admin rights, is
 * what these screens key off.
 */
export function captainTeamOf(
  playerId: string | null | undefined,
  tournament: TournamentDoc | null
): DraftTeamKey | null {
  if (!playerId || !tournament) return null;
  const inTeam = (team: DraftTeamKey) =>
    [tournament[team]?.captainId, tournament[team]?.coCaptainId].filter(Boolean).includes(playerId);
  if (inTeam("teamA")) return "teamA";
  if (inTeam("teamB")) return "teamB";
  return null;
}
