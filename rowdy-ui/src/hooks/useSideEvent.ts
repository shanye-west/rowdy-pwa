import { useEffect, useMemo, useRef, useState } from "react";
import { collection, doc, query, where, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import type { CourseDoc, PlayerDoc, SideEventDoc, SideEventTeamDoc, TournamentDoc } from "../types";
import { useTournamentContextOptional, usePlayers } from "../contexts/TournamentContext";
import { getDocCacheFirst, getDocsCacheFirst } from "../utils/firestoreReads";
import { useResolvedLoading } from "./useResolvedLoading";
import {
  assignSideEventPayouts,
  holeNumbersForNine,
  rankSideEventTeams,
  type RankedSideEventTeam,
  type SideEventTeamPayout,
} from "../utils/sideEventScoring";

interface UseSideEventResult {
  loading: boolean;
  error: string | null;
  event: SideEventDoc | null;
  tournament: TournamentDoc | null;
  course: CourseDoc | null;
  teams: SideEventTeamDoc[];
  players: Record<string, PlayerDoc>;
  /** The nine real course hole numbers this event plays. */
  holeNumbers: number[];
  /** Course hole number -> par; empty when the event has no course. */
  parByHole: Record<number, number>;
  /** Leaderboard order, best first. */
  leaderboard: RankedSideEventTeam[];
  /** teamId -> payout, for teams in the money. */
  payoutsByTeam: Record<string, SideEventTeamPayout>;
}

/**
 * All data for one side event (the optional, for-fun 9-hole game).
 *
 * Mirrors useRoundData's cascade — event → tournament/course → teams → players
 * — including the locked-means-static read optimization. The leaderboard is
 * derived client-side by pure functions in utils/sideEventScoring; there is no
 * server-side computation for side events, by design.
 */
export function useSideEvent(sideEventId: string | undefined): UseSideEventResult {
  const [rawLoading, setRawLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [event, setEvent] = useState<SideEventDoc | null>(null);
  const [teams, setTeams] = useState<SideEventTeamDoc[]>([]);
  const [course, setCourse] = useState<CourseDoc | null>(null);
  const [localTournament, setLocalTournament] = useState<TournamentDoc | null>(null);

  const tournamentContext = useTournamentContextOptional();
  const fetchedCourseIdRef = useRef<string | undefined>(undefined);

  const [eventLoaded, setEventLoaded] = useState(false);
  const [teamsLoaded, setTeamsLoaded] = useState(false);

  // 1) Subscribe to the side event doc
  useEffect(() => {
    if (!sideEventId) {
      setRawLoading(false);
      setError("Side event ID is missing.");
      return;
    }

    setRawLoading(true);
    setError(null);
    setEventLoaded(false);
    setTeamsLoaded(false);
    setEvent(null);
    setTeams([]);
    setCourse(null);

    const unsub = onSnapshot(
      doc(db, "sideEvents", sideEventId),
      (snap) => {
        if (!snap.exists()) {
          setError("Side event not found.");
          setEvent(null);
        } else {
          setEvent({ id: snap.id, ...snap.data() } as SideEventDoc);
        }
        setEventLoaded(true);
      },
      (err) => {
        console.error("Side event subscription error:", err);
        setError("Unable to load this event.");
        setEventLoaded(true);
      }
    );
    return () => unsub();
  }, [sideEventId]);

  // 2) Tournament — reuse the shared context whenever it already has it.
  useEffect(() => {
    const tournamentId = event?.tournamentId;
    if (!tournamentId) {
      setLocalTournament(null);
      return;
    }
    if (tournamentContext?.tournament?.id === tournamentId) {
      setLocalTournament(tournamentContext.tournament);
      return;
    }
    const cached = tournamentContext?.getTournamentById(tournamentId);
    if (cached) {
      setLocalTournament(cached);
      return;
    }
    let cancelled = false;
    getDocCacheFirst(doc(db, "tournaments", tournamentId))
      .then((snap) => {
        if (cancelled || !snap.exists()) return;
        const t = { id: snap.id, ...snap.data() } as TournamentDoc;
        setLocalTournament(t);
        tournamentContext?.addTournament(t);
      })
      .catch((err) => console.error("Tournament fetch error:", err));
    return () => { cancelled = true; };
  }, [event?.tournamentId, tournamentContext?.tournament]);

  // 3) Course — static for the session, cache-first, shared cache first of all.
  useEffect(() => {
    const courseId = event?.courseId;
    if (!courseId) {
      setCourse(null);
      return;
    }
    if (fetchedCourseIdRef.current === courseId && course?.id === courseId) return;

    const cached = tournamentContext?.courses[courseId];
    if (cached) {
      setCourse(cached);
      fetchedCourseIdRef.current = courseId;
      return;
    }

    let cancelled = false;
    getDocCacheFirst(doc(db, "courses", courseId))
      .then((snap) => {
        if (cancelled || !snap.exists()) return;
        const c = { id: snap.id, ...snap.data() } as CourseDoc;
        setCourse(c);
        fetchedCourseIdRef.current = courseId;
        tournamentContext?.addCourse(c);
      })
      .catch((err) => console.error("Course fetch error:", err));
    return () => { cancelled = true; };
  }, [event?.courseId, tournamentContext?.courses]);

  // 4) Teams. A locked event is a finished result set, so it reads once
  //    cache-first instead of holding a live listener (same trade-off the round
  //    page makes for locked rounds).
  // Depend on primitives only: `event` is a fresh object on every snapshot, so
  // depending on it would tear down and rebuild the teams listener on each
  // event-doc write (e.g. an admin nudging the payouts mid-round).
  const locked = event?.locked === true;
  const eventExists = event !== null;
  useEffect(() => {
    if (!sideEventId || !eventExists) return;

    const teamsQuery = query(
      collection(db, "sideEventTeams"),
      where("sideEventId", "==", sideEventId)
    );
    const toTeams = (docs: { id: string; data: () => Record<string, unknown> }[]) =>
      docs
        .map((d) => ({ id: d.id, ...d.data() } as SideEventTeamDoc))
        .sort((a, b) => (a.teamNumber ?? 0) - (b.teamNumber ?? 0) || a.id.localeCompare(b.id));

    if (locked) {
      let cancelled = false;
      getDocsCacheFirst(teamsQuery)
        .then((snap) => {
          if (cancelled) return;
          setTeams(toTeams(snap.docs));
          setTeamsLoaded(true);
        })
        .catch((err) => {
          console.error("Side event teams fetch error:", err);
          setTeamsLoaded(true);
        });
      return () => { cancelled = true; };
    }

    const unsub = onSnapshot(
      teamsQuery,
      (snap) => {
        setTeams(toTeams(snap.docs));
        setTeamsLoaded(true);
      },
      (err) => {
        console.error("Side event teams subscription error:", err);
        setTeamsLoaded(true);
      }
    );
    return () => unsub();
  }, [sideEventId, eventExists, locked]);

  // 5) Player docs — usually already warm from the tournament roster, but a
  //    side event can include anyone, so ask for exactly who is playing.
  const teamPlayerIds = useMemo(() => {
    const ids = new Set<string>();
    teams.forEach((t) => t.playerIds?.forEach((pid) => pid && ids.add(pid)));
    return Array.from(ids);
  }, [teams]);
  const { players, loaded: playersResolved } = usePlayers(teamPlayerIds);
  const playersLoaded = teamsLoaded && playersResolved;

  useEffect(() => {
    setRawLoading(!(eventLoaded && teamsLoaded && playersLoaded));
  }, [eventLoaded, teamsLoaded, playersLoaded]);

  // Once the event doc is in hand, don't let a wedged secondary read spin forever.
  const loading = useResolvedLoading(rawLoading, event !== null);

  const nine = event?.nine === "back" ? "back" : "front";

  const holeNumbers = useMemo(() => holeNumbersForNine(nine), [nine]);

  const parByHole = useMemo(() => {
    const map: Record<number, number> = {};
    course?.holes?.forEach((h) => {
      if (typeof h?.number === "number" && typeof h?.par === "number") map[h.number] = h.par;
    });
    return map;
  }, [course]);

  const leaderboard = useMemo(
    () => rankSideEventTeams(teams, parByHole, nine),
    [teams, parByHole, nine]
  );

  const payoutsByTeam = useMemo(
    () => assignSideEventPayouts(leaderboard, event?.payouts),
    [leaderboard, event?.payouts]
  );

  const tournament = useMemo(() => {
    const contextTournament = tournamentContext?.tournament;
    if (contextTournament?.id === event?.tournamentId) return contextTournament;
    return localTournament;
  }, [tournamentContext?.tournament, event?.tournamentId, localTournament]);

  return {
    loading,
    error,
    event,
    tournament: tournament || null,
    course,
    teams,
    players,
    holeNumbers,
    parByHole,
    leaderboard,
    payoutsByTeam,
  };
}
