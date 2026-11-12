import type { UseTournamentDataResult } from '../hooks/useTournamentData';
import type { StandingsSnapshot } from './standings';
/** Never manufacture a fresh timestamp from cached/offline standings. */
export function snapshotForSave(data: UseTournamentDataResult, tournamentId: string): StandingsSnapshot | null {
  const t = data.tournament;
  if (data.loading || data.error || !data.standingsUpdatedAt || !t || t.id !== tournamentId) return null;
  return {
    tournamentId: t.id, tournamentName: t.name,
    teamA: t.teamA.name, teamB: t.teamB.name,
    pointsA: data.stats.teamAConfirmed, pointsB: data.stats.teamBConfirmed,
    updatedAt: data.standingsUpdatedAt,
  };
}
