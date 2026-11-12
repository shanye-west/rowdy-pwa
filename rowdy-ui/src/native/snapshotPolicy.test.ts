import { describe, expect, it, vi } from 'vitest';
import type { UseTournamentDataResult } from '../hooks/useTournamentData';
import { snapshotForSave } from './snapshotPolicy';
import { nativeTask } from './standings';
// Fixture uses the relevant tournament shape; the shared hook supplies the rest.
const data = {
  loading: false, error: null, standingsUpdatedAt: 1700000000000,
  tournament: { id: 'cup', name: 'Cup', teamA: { name: 'A' }, teamB: { name: 'B' } },
  stats: { teamAConfirmed: 2.5, teamBConfirmed: 1, teamAPending: 3, teamBPending: 2 },
} as UseTournamentDataResult;
describe('native standings freshness', () => {
  it('uses confirmed totals and the source timestamp, not pending points or the current time', () => {
    expect(snapshotForSave(data, 'cup')).toMatchObject({ pointsA: 2.5, pointsB: 1, updatedAt: 1700000000000 });
  });
  it('does not overwrite saved timestamps with cached or missing data', () => {
    expect(snapshotForSave({ ...data, standingsUpdatedAt: null }, 'cup')).toBeNull();
    expect(snapshotForSave({ ...data, tournament: null }, 'cup')).toBeNull();
    expect(snapshotForSave({ ...data, loading: true }, 'cup')).toBeNull();
    expect(snapshotForSave({ ...data, error: 'offline' }, 'cup')).toBeNull();
  });
  it('rejects previous tournament data during a switch', () => {
    expect(snapshotForSave(data, 'different-cup')).toBeNull();
  });
  it('serializes saves before logout/switch clearing and recovers after a failed call', async () => {
    const calls: string[] = [];
    let release = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    const save = nativeTask(async () => { await gate; calls.push('save'); });
    const clear = nativeTask(async () => { calls.push('clear'); });
    expect(calls).toEqual([]); release(); await Promise.all([save, clear]);
    expect(calls).toEqual(['save', 'clear']);
    await expect(nativeTask(async () => { throw new Error('failed'); })).rejects.toThrow('failed');
    const read = vi.fn(async () => null); await nativeTask(read); expect(read).toHaveBeenCalledOnce();
  });
});
