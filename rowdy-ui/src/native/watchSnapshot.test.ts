import { describe, expect, it } from 'vitest';
import { watchSnapshot } from './watchSnapshot';
import type { MatchDoc } from '../types';
const standings = { tournamentId: 'cup', tournamentName: 'Cup', teamA: '', teamB: 'Blue', pointsA: 2, pointsB: 1.5, updatedAt: 1700000000000 };
function data(matches: MatchDoc[]): Parameters<typeof watchSnapshot>[0] {
  return { rounds: [{ id: 'r', day: 1 }], matchesByRound: { r: matches } };
}
function match(overrides: Partial<MatchDoc>): MatchDoc { return { id: 'm', roundId: 'r', matchNumber: 1, ...overrides }; }
describe('Watch saved match status', () => {
  it('preserves source timestamp and confirmed totals, including an empty schedule', () => {
    expect(watchSnapshot(data([]), standings)).toEqual({ standings, matches: [] });
  });
  it('shows scheduled, all-square, leading and final server states', () => {
    const statuses = watchSnapshot(data([
      match({}),
      match({ status: { leader: null, margin: 0, thru: 4, closed: false, dormie: false } }),
      match({ status: { leader: 'teamA', margin: 2, thru: 16, closed: false, dormie: true } }),
      match({ status: { leader: 'teamB', margin: 3, thru: 16, closed: true, dormie: false }, result: { winner: 'teamB' } }),
      match({ status: { leader: null, margin: 0, thru: 18, closed: true, dormie: false }, result: { winner: 'AS' } }),
    ]), standings).matches.map(m => m.status);
    expect(statuses).toEqual(['Not started', 'All square · Thru 4', 'Team A 2 UP · Thru 16 · Dormie', 'Blue 3&2 · Final', 'Halved · Final']);
  });
});
