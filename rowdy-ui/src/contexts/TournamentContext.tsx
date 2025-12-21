/**
 * TournamentContext - Provides shared tournament data to avoid duplicate subscriptions
 * 
 * This context subscribes once to the active tournament (or a specific tournament by ID)
 * and shares the data with all child components. This prevents multiple components
 * from creating duplicate Firestore subscriptions to the same tournament document.
 */

import { createContext, useContext, useEffect, useState, useMemo, type ReactNode } from "react";
import { doc, onSnapshot, collection, query, where, limit } from "firebase/firestore";
import { db } from "../firebase";
import type { TournamentDoc, CourseDoc } from "../types";
import { ensureTournamentTeamColors } from "../utils/teamColors";

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
  /** Get or subscribe to a specific tournament by ID (for non-active tournaments) */
  getTournamentById: (id: string) => TournamentDoc | null;
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [courses, setCourses] = useState<Record<string, CourseDoc>>({});
  
  // Cache for tournaments fetched by ID (for historical/non-active tournaments)
  const [tournamentsById, setTournamentsById] = useState<Record<string, TournamentDoc>>({});

  // Subscribe to the active tournament (or specific one if tournamentId provided)
  useEffect(() => {
    setLoading(true);
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
          setLoading(false);
        },
        (err) => {
          console.error("Tournament subscription error:", err);
          setError("Unable to load tournament.");
          setLoading(false);
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
          setLoading(false);
        },
        (err) => {
          console.error("Tournament subscription error:", err);
          setError("Unable to load tournament.");
          setLoading(false);
        }
      );
      return () => unsub();
    }
  }, [tournamentId]);

  // Utility to add courses to shared cache
  const addCourse = (course: CourseDoc) => {
    if (course.id) {
      setCourses(prev => {
        if (prev[course.id]) return prev; // Already cached
        return { ...prev, [course.id]: course };
      });
    }
  };

  // Get tournament by ID from cache (for components that need a non-active tournament)
  const getTournamentById = (id: string): TournamentDoc | null => {
    return tournamentsById[id] || null;
  };

  const value = useMemo(
    () => ({ tournament, loading, error, courses, addCourse, getTournamentById }),
    [tournament, loading, error, courses, tournamentsById]
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
