import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
export interface StandingsSnapshot {
  tournamentId: string; tournamentName: string;
  teamA: string; teamB: string; pointsA: number; pointsB: number; updatedAt: number;
}
export interface NativeState { snapshot: StandingsSnapshot | null; active: boolean; watch?: { paired: boolean; installed: boolean; reachable: boolean } }
export const RowdyNative = registerPlugin<{
  addListener(event: "openStandings", listener: () => void): Promise<PluginListenerHandle>;
  takeOpenStandings(): Promise<{ open: boolean }>;
  setContext(options: { context: string }): Promise<void>;
  save(options: { context: string; snapshot: StandingsSnapshot }): Promise<void>;
  haptic(options: { kind: 'selection' | 'success' | 'queued' | 'error' }): Promise<void>;
  saveWatch(options: { context: string; snapshot: import('./watchSnapshot').WatchSnapshot }): Promise<void>;
  read(): Promise<NativeState>;
  start(): Promise<void>;
  end(): Promise<void>;
  openExternal(options: { url: string }): Promise<void>;
}>('RowdyNative');
// Serializing calls ensures logout/switch clears cannot race a previous save.
let pending: Promise<unknown> = Promise.resolve();
export function nativeTask<T>(task: () => Promise<T>): Promise<T> {
  const next = pending.then(task, task);
  pending = next.catch(() => {});
  return next;
}
