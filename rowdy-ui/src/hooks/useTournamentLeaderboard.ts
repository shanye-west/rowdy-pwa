import { useEffect, useMemo, useState } from "react";
import { collectionGroup, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { usePlayers } from "../contexts/TournamentContext";
import type { TournamentDoc } from "../types";

export interface LeaderboardRow {
  playerId: string;
  points: number;
  wins: number;
  losses: number;
  halves: number;
  matchesPlayed: number;
  birdies: number;
}

function rosterIdsOf(t: TournamentDoc | null): string[] {
  if (!t) return [];
  const a = Object.values(t.teamA?.rosterByTier || {}).flat();
  const b = Object.values(t.teamB?.rosterByTier || {}).flat();
  return [...a, ...b];
}

/** Rank by points, then wins, then fewest losses. */
function sortRows(a: LeaderboardRow, b: LeaderboardRow): number {
  if (b.points !== a.points) return b.points - a.points;
  if (b.wins !== a.wins) return b.wins - a.wins;
  return a.losses - b.losses;
}

/**
 * Individual leaderboard for the current tournament. Reuses the same one-time
 * `byTournament` collection-group query that Teams.tsx runs (no new index), plus
 * a chunked player-name fetch. Names + roster ids are returned so callers can
 * also drive an all-time (bySeries) view via useSeriesLeaderboard.
 */
export function useTournamentLeaderboard(tournament: TournamentDoc | null) {
  const rosterIds = useMemo(() => rosterIdsOf(tournament), [tournament]);
  const rosterKey = rosterIds.join(",");
  const tournamentId = tournament?.id;

  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Player display names come from the shared cache (roster is warmed once per
  // session), so this no longer issues its own chunked `in` query.
  const { players } = usePlayers(rosterIds);
  const nameById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const id of rosterIds) {
      const p = players[id];
      if (p) map[id] = p.displayName || "Unknown";
    }
    return map;
  }, [players, rosterKey]); // eslint-disable-line react-hooks/exhaustive-deps -- rosterKey encodes rosterIds

  // byTournament aggregates for this tournament.
  useEffect(() => {
    if (!tournamentId) {
      setRows([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getDocs(query(collectionGroup(db, "byTournament"), where("tournamentId", "==", tournamentId)))
      .then((snap) => {
        if (cancelled) return;
        const list: LeaderboardRow[] = [];
        snap.docs.forEach((d) => {
          const data = d.data() as Record<string, unknown>;
          const playerId = data.playerId as string | undefined;
          if (!playerId) return;
          const wins = Number(data.wins) || 0;
          const losses = Number(data.losses) || 0;
          const halves = Number(data.halves) || 0;
          list.push({
            playerId,
            wins,
            losses,
            halves,
            points: typeof data.points === "number" ? data.points : wins + 0.5 * halves,
            matchesPlayed: Number(data.matchesPlayed) || wins + losses + halves,
            birdies: Number(data.birdies) || 0,
          });
        });
        list.sort(sortRows);
        setRows(list);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setRows([]);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [tournamentId]);

  return { rows, nameById, rosterIds, loading };
}
