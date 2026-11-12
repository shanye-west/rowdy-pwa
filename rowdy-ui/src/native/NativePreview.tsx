import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTournamentContext } from '../contexts/TournamentContext';
import { useNativeData } from './nativeData';
import { Link } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { nativeTask, RowdyNative, type NativeState } from './standings';
export default function NativePreview() {
  const { user, loading: authLoading } = useAuth();
  const { tournament, loading: tournamentLoading, error: tournamentError } = useTournamentContext();
  const data = useNativeData();
  const [state, setState] = useState<NativeState>({ snapshot: null, active: false });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => nativeTask(() => RowdyNative.read()).then(setState).catch(e => setError(String(e))), []);
  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 2000); return () => clearInterval(timer); }, [refresh]);
  async function act(start: boolean) {
    setBusy(true); setError('');
    try { await nativeTask(() => start ? RowdyNative.start() : RowdyNative.end()); await refresh(); }
    catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  const s = state.snapshot;
  return <main className="p-5 space-y-5 max-w-xl mx-auto">
    <h1 className="text-2xl font-bold">Native Preview</h1>
    <p className="text-sm">Account: {authLoading ? 'loading' : user ? 'signed in' : 'signed out'} · Tournament: {tournamentLoading ? 'loading' : tournament?.name ?? 'none'} · Standings: {data?.loading ? 'loading' : data?.standingsUpdatedAt ? 'server confirmed' : 'cached or unavailable'}</p>
    {tournamentError && <p role="alert">{tournamentError}</p>}
    {!authLoading && !user && <Link to="/login">Sign in to save standings</Link>}
    <p>Siri and the Live Activity show last saved, confirmed Cup points.</p>
    {s ? <section className="rounded-xl border p-4 space-y-2"><h2>{s.tournamentName}</h2><p>{s.teamA}: {s.pointsA} · {s.teamB}: {s.pointsB}</p><p>Last saved: {new Date(s.updatedAt).toLocaleString()}</p></section> : <p>No saved standings. Sign in and load a tournament while online.</p>}
    <p>Say “Check standings in Rowdy Test” or “Open standings in Rowdy Test.” You can also find these actions in Shortcuts.</p>
    <p>Live Activity: {state.active ? 'running' : 'off'}</p>
    <div className="flex gap-3"><Button disabled={busy || !s || state.active} onClick={() => void act(true)}>Start Live Activity</Button><Button disabled={busy || !state.active} onClick={() => void act(false)}>End Live Activity</Button></div>
    <p>The display can stay visible while locked. Fresh standings update only while Rowdy Test is running; server-driven background updates are not included. System push notifications are unavailable in this prototype.</p>
    {error && <p role="alert">{error}</p>}
    <Link to="/">Open standings</Link>
  </main>;
}
