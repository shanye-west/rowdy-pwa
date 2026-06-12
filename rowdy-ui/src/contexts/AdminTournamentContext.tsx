/**
 * Admin-scoped tournament context. Unlike the global TournamentContext (which
 * is pinned to the single *active* tournament for public pages), this loads
 * whatever tournament the admin navigated to — including test and archived
 * ones — once per layout mount, so child admin pages never re-select it.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import { useRosterPlayers } from "../hooks/admin/useRosterPlayers";
import { useRounds } from "../hooks/admin/useRounds";
import type { PlayerDoc, RoundDoc, TournamentDoc } from "../types";

interface AdminTournamentContextValue {
  tournamentId: string;
  tournament: TournamentDoc | null;
  /** Player docs rostered on either team. */
  players: PlayerDoc[];
  rounds: RoundDoc[];
  loading: boolean;
  error: string | null;
  refreshRounds: () => Promise<void>;
}

const AdminTournamentContext = createContext<AdminTournamentContextValue | null>(null);

export function AdminTournamentProvider({
  tournamentId,
  children,
}: {
  tournamentId: string;
  children: ReactNode;
}) {
  const [tournament, setTournament] = useState<TournamentDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The layout route remounts this provider per tournament (key={tournamentId}),
  // so initial state covers the reset and the effect only subscribes.
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, "tournaments", tournamentId),
      (snap) => {
        if (snap.exists()) {
          setTournament({ id: snap.id, ...snap.data() } as TournamentDoc);
          setError(null);
        } else {
          setTournament(null);
          setError("Tournament not found");
        }
        setLoading(false);
      },
      (err) => {
        console.error("Tournament subscription failed:", err);
        setError(err.message);
        setLoading(false);
      }
    );
    return unsub;
  }, [tournamentId]);

  const { players } = useRosterPlayers(tournament);
  const { rounds, refresh: refreshRounds, error: roundsError } = useRounds(tournamentId);

  return (
    <AdminTournamentContext.Provider
      value={{
        tournamentId,
        tournament,
        players,
        rounds,
        loading,
        error: error ?? roundsError,
        refreshRounds,
      }}
    >
      {children}
    </AdminTournamentContext.Provider>
  );
}

export function useAdminTournament(): AdminTournamentContextValue {
  const ctx = useContext(AdminTournamentContext);
  if (!ctx) {
    throw new Error("useAdminTournament must be used inside AdminTournamentProvider");
  }
  return ctx;
}
