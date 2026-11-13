import type { UseTournamentDataResult } from '../hooks/useTournamentData';
import type { StandingsSnapshot } from './standings';
export interface WatchSnapshot {
  standings: StandingsSnapshot;
  matches: { id: string; title: string; status: string }[];
}
/** Display server-computed match status; never calculate score winners here. */
export function watchSnapshot(data: { rounds: Pick<UseTournamentDataResult['rounds'][number], 'id' | 'day'>[]; matchesByRound: UseTournamentDataResult['matchesByRound'] }, standings: StandingsSnapshot): WatchSnapshot {
  const names = { teamA: standings.teamA || 'Team A', teamB: standings.teamB || 'Team B' };
  return { standings, matches: data.rounds.flatMap(round =>
    [...(data.matchesByRound[round.id] ?? [])].sort((a, b) => (a.matchNumber ?? 0) - (b.matchNumber ?? 0)).map(match => {
      const s = match.status;
      let status = 'Not started';
      if (s?.closed) {
        const winner = match.result?.winner;
        status = winner === 'AS' ? 'Halved · Final' : winner
          ? `${names[winner]} ${s.thru >= 18 ? `${s.margin} UP` : `${s.margin}&${18 - s.thru}`} · Final`
          : 'Final · Result unavailable';
      } else if (s && s.thru > 0) {
        status = `${s.leader ? `${names[s.leader]} ${s.margin} UP` : 'All square'} · Thru ${s.thru}${s.dormie ? ' · Dormie' : ''}`;
      }
      return { id: match.id, title: `Day ${round.day} · Match ${match.matchNumber ?? '—'}`, status };
    })) };
}
