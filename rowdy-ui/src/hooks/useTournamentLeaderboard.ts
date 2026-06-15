import { useEffect, useMemo, useState } from "react";
import { collection, collectionGroup, documentId, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase";
import type { PlayerDoc, TournamentDoc } from "../types";

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

  const [nameById, setNameById] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Player display names (chunked `in` query — Firestore caps `in` at 30).
  // Empty roster flows through to an empty map via the resolved promise.
  useEffect(() => {
    let cancelled = false;
    const chunks: string[][] = [];
    for (let i = 0; i < rosterIds.length; i += 30) chunks.push(rosterIds.slice(i, i + 30));
    Promise.all(
      chunks.map((c) => getDocs(query(collection(db, "players"), where(documentId(), "in", c))))
    )
      .then((snaps) => {
        if (cancelled) return;
        const map: Record<string, string> = {};
        snaps.forEach((snap) =>
          snap.forEach((d) => {
            map[d.id] = (d.data() as PlayerDoc).displayName || "Unknown";
          })
        );
        setNameById(map);
      })
      .catch(() => {
        if (!cancelled) setNameById({});
      });
    return () => {
      cancelled = true;
    };
  }, [rosterKey]); // eslint-disable-line react-hooks/exhaustive-deps -- rosterKey encodes rosterIds

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
