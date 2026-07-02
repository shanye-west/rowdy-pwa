/**
 * TournamentContext - Provides shared tournament data to avoid duplicate subscriptions
 * 
 * This context subscribes once to the active tournament (or a specific tournament by ID)
 * and shares the data with all child components. This prevents multiple components
 * from creating duplicate Firestore subscriptions to the same tournament document.
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState, useMemo, type ReactNode } from "react";
import { doc, onSnapshot, collection, query, where, limit, documentId, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import type { TournamentDoc, CourseDoc, PlayerDoc } from "../types";
import { ensureTournamentTeamColors } from "../utils/teamColors";
import { rosterPlayerIds } from "../utils/roster";
import { FIRESTORE_IN_QUERY_LIMIT } from "../constants";
import { useResolvedLoading } from "../hooks/useResolvedLoading";

export type PlayerLookup = Record<string, PlayerDoc>;

/** Batch-fetch player docs by id, chunked to Firestore's `in` limit (one-time read). */
async function fetchPlayersByIds(ids: string[]): Promise<PlayerLookup> {
  const out: PlayerLookup = {};
  if (ids.length === 0) return out;
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += FIRESTORE_IN_QUERY_LIMIT) {
    batches.push(ids.slice(i, i + FIRESTORE_IN_QUERY_LIMIT));
  }
  const snaps = await Promise.all(
    batches.map((batch) => getDocs(query(collection(db, "players"), where(documentId(), "in", batch))))
  );
  snaps.forEach((snap) => snap.forEach((d) => { out[d.id] = { id: d.id, ...d.data() } as PlayerDoc; }));
  return out;
}

// ============================================================================
// TYPES
// ============================================================================

interface TournamentContextValue {
  /** The active tournament (or specific tournament if tournamentId is set) */
  tournament: TournamentDoc | null;
  /** Loading state */
  loading: boolean;
  /** Error message if something failed */
  error: string | null;
  /** Courses cache - shared across components */
  courses: Record<string, CourseDoc>;
  /** Add a course to the shared cache */
  addCourse: (course: CourseDoc) => void;
  /** Shared player cache (by id) - avoids re-fetching the roster on every route */
  players: PlayerLookup;
  /** Ids whose fetch has been attempted (found or not), so callers can tell when loading is done */
  resolvedPlayerIds: Record<string, true>;
  /** Fetch + cache any of `ids` not already loaded/in-flight (deduped, batched) */
  ensurePlayers: (ids: string[]) => void;
  /** Get or subscribe to a specific tournament by ID (for non-active tournaments) */
  getTournamentById: (id: string) => TournamentDoc | null;
  /** Add a tournament to the shared cache (for historical tournaments) */
  addTournament: (tournament: TournamentDoc) => void;
}

const TournamentContext = createContext<TournamentContextValue | null>(null);

// ============================================================================
// PROVIDER
// ============================================================================

interface TournamentProviderProps {
  children: ReactNode;
  /** Optional specific tournament ID to fetch instead of active tournament */
  tournamentId?: string;
}

export function TournamentProvider({ children, tournamentId }: TournamentProviderProps) {
  const [tournament, setTournament] = useState<TournamentDoc | null>(null);
  const [rawLoading, setRawLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [courses, setCourses] = useState<Record<string, CourseDoc>>({});
  
  // Cache for tournaments fetched by ID (for historical/non-active tournaments)
  const [tournamentsById, setTournamentsById] = useState<Record<string, TournamentDoc>>({});

  // Shared player cache. Populated lazily via ensurePlayers and shared across every
  // route, so the roster is fetched ~once per session instead of once per navigation.
  const [players, setPlayers] = useState<PlayerLookup>({});
  const [resolvedPlayerIds, setResolvedPlayerIds] = useState<Record<string, true>>({});
  // Ids already fetched or in-flight — dedupes concurrent requests without a re-render.
  const requestedPlayerIdsRef = useRef<Set<string>>(new Set());

  const ensurePlayers = useCallback((ids: string[]) => {
    const missing = ids.filter((id) => id && !requestedPlayerIdsRef.current.has(id));
    if (missing.length === 0) return;
    missing.forEach((id) => requestedPlayerIdsRef.current.add(id));
    fetchPlayersByIds(missing)
      .then((fetched) => {
        if (Object.keys(fetched).length > 0) setPlayers((prev) => ({ ...prev, ...fetched }));
        // Mark every requested id resolved (even ones with no doc) so loaded flags settle.
        setResolvedPlayerIds((prev) => {
          const next = { ...prev };
          for (const id of missing) next[id] = true;
          return next;
        });
      })
      .catch((err) => {
        console.error("ensurePlayers fetch error:", err);
        // Un-mark so a later request can retry.
        for (const id of missing) requestedPlayerIdsRef.current.delete(id);
      });
  }, []);

  // Subscribe to the active tournament (or specific one if tournamentId provided)
  useEffect(() => {
    setRawLoading(true);
    setError(null);

    if (tournamentId) {
      // Specific tournament by ID
      const unsub = onSnapshot(
        doc(db, "tournaments", tournamentId),
        (snap) => {
          if (snap.exists()) {
            const t = ensureTournamentTeamColors({ id: snap.id, ...snap.data() } as TournamentDoc);
            setTournament(t);
            if (t) setTournamentsById(prev => ({ ...prev, [snap.id]: t }));
          } else {
            setTournament(null);
            setError("Tournament not found.");
          }
          setRawLoading(false);
        },
        (err) => {
          console.error("Tournament subscription error:", err);
          setError("Unable to load tournament.");
          setRawLoading(false);
        }
      );
      return () => unsub();
    } else {
      // Active tournament
      const unsub = onSnapshot(
        query(collection(db, "tournaments"), where("active", "==", true), limit(1)),
        (snap) => {
          if (snap.empty) {
            setTournament(null);
          } else {
            const d = snap.docs[0];
            const t = ensureTournamentTeamColors({ id: d.id, ...d.data() } as TournamentDoc);
            setTournament(t);
            if (t) setTournamentsById(prev => ({ ...prev, [d.id]: t }));
          }
          setRawLoading(false);
        },
        (err) => {
          console.error("Tournament subscription error:", err);
          setError("Unable to load tournament.");
          setRawLoading(false);
        }
      );
      return () => unsub();
    }
  }, [tournamentId]);

  // The tournament uses a cache-first onSnapshot, so returning users resolve
  // from IndexedDB instantly. The watchdog backstops a wedged connection: once
  // a (cached) tournament is in hand it stops blocking after the timeout, so the
  // app renders instead of spinning forever. With no tournament at all it keeps
  // spinning, letting LoadingScreen surface its manual Reload/Reset escape.
  const loading = useResolvedLoading(rawLoading, tournament !== null);

  // Warm the cache with the active tournament's roster as soon as it loads, so
  // player names are ready before any route that needs them mounts. ensurePlayers
  // dedupes, so re-running on tournament updates is a cheap no-op.
  const rosterKey = tournament ? rosterPlayerIds(tournament).join(",") : "";
  useEffect(() => {
    if (rosterKey) ensurePlayers(rosterKey.split(","));
  }, [rosterKey, ensurePlayers]);

  // Cache helpers are useCallback-stable so the context value only changes when
  // actual data does — otherwise every consumer re-renders each time a roster
  // batch resolves or the provider re-renders for any reason.
  const addCourse = useCallback((course: CourseDoc) => {
    if (course.id) {
      setCourses(prev => {
        if (prev[course.id]) return prev; // Already cached
        return { ...prev, [course.id]: course };
      });
    }
  }, []);

  // Get tournament by ID from cache (for components that need a non-active tournament)
  const getTournamentById = useCallback((id: string): TournamentDoc | null => {
    return tournamentsById[id] || null;
  }, [tournamentsById]);

  // Add tournament to cache (for components that fetch historical tournaments)
  const addTournament = useCallback((tournament: TournamentDoc) => {
    if (tournament.id) {
      setTournamentsById(prev => {
        if (prev[tournament.id]) return prev; // Already cached
        return { ...prev, [tournament.id]: tournament };
      });
    }
  }, []);

  const value = useMemo(
    () => ({ tournament, loading, error, courses, addCourse, getTournamentById, addTournament, players, resolvedPlayerIds, ensurePlayers }),
    [tournament, loading, error, courses, addCourse, getTournamentById, addTournament, players, resolvedPlayerIds, ensurePlayers]
  );

  return (
    <TournamentContext.Provider value={value}>
      {children}
    </TournamentContext.Provider>
  );
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Access the shared tournament context.
 * Must be used within a TournamentProvider.
 */
export function useTournamentContext(): TournamentContextValue {
  const ctx = useContext(TournamentContext);
  if (!ctx) {
    throw new Error("useTournamentContext must be used within a TournamentProvider");
  }
  return ctx;
}

/**
 * Optional hook that returns null if not within a provider (instead of throwing)
 * Useful for components that can work with or without context.
 */
export function useTournamentContextOptional(): TournamentContextValue | null {
  return useContext(TournamentContext);
}

/**
 * Resolve player docs for `ids` from the shared cache, fetching any that are
 * missing. Returns the requested subset plus `loaded` (true once every id has
 * been fetched — found or not). Falls back to a local one-time fetch when used
 * outside a TournamentProvider (e.g. isolated tests).
 */
export function usePlayers(ids: readonly string[]): { players: PlayerLookup; loaded: boolean } {
  const ctx = useContext(TournamentContext);

  // Stable, de-duped, sorted key so the effect only re-runs when the id set changes.
  const key = useMemo(() => [...new Set(ids.filter(Boolean))].sort().join(","), [ids]);
  const idList = useMemo(() => (key ? key.split(",") : []), [key]);

  const ensurePlayers = ctx?.ensurePlayers;
  const ctxPlayers = ctx?.players;
  const ctxResolved = ctx?.resolvedPlayerIds;

  // Local fallback state, only used when rendered outside a provider.
  const [localPlayers, setLocalPlayers] = useState<PlayerLookup>({});
  const [localLoaded, setLocalLoaded] = useState(false);

  useEffect(() => {
    if (ensurePlayers) {
      ensurePlayers(idList);
      return;
    }
    if (idList.length === 0) {
      setLocalPlayers({});
      setLocalLoaded(true);
      return;
    }
    let cancelled = false;
    setLocalLoaded(false);
    fetchPlayersByIds(idList)
      .then((fetched) => { if (!cancelled) { setLocalPlayers(fetched); setLocalLoaded(true); } })
      .catch(() => { if (!cancelled) setLocalLoaded(true); });
    return () => { cancelled = true; };
    // idList is derived from key; depend on key to avoid array-identity churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ensurePlayers]);

  const players = useMemo(() => {
    const src = ctx ? (ctxPlayers ?? {}) : localPlayers;
    const out: PlayerLookup = {};
    for (const id of idList) { const p = src[id]; if (p) out[id] = p; }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ctxPlayers, localPlayers, ctx]);

  const loaded = ctx
    ? idList.every((id) => !!ctxResolved?.[id])
    : idList.length === 0 || localLoaded;

  return { players, loaded };
}
