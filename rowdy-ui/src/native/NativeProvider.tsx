import { App as CapacitorApp } from '@capacitor/app';
import { useEffect, type ReactNode } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTournamentContext } from '../contexts/TournamentContext';
import { useTournamentData } from '../hooks/useTournamentData';
import { snapshotForSave } from './snapshotPolicy';
import { isNative } from './platform';
import { nativeTask, RowdyNative } from './standings';
import { NativeData } from './nativeData';
export function NativeProvider({ children }: { children: ReactNode }) {
  return isNative() ? <NativeSession>{children}</NativeSession> : children;
}
function NativeSession({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const { tournament, loading } = useTournamentContext();
  const data = useTournamentData({ prefetchedTournament: tournament, preferDenormalizedTotals: true });
  const context = user && tournament ? `${user.uid}:${tournament.id}` : '';
  useEffect(() => {
    if (authLoading || (user && loading)) return;
    void nativeTask(() => RowdyNative.setContext({ context })).catch(console.error);
  }, [context, authLoading, loading, user]);
  useEffect(() => {
    if (authLoading || loading || !context || !tournament || data.loading || !data.standingsUpdatedAt || data.tournament?.id !== tournament.id) return;
    const snapshot = snapshotForSave(data, tournament.id);
    if (!snapshot) return;
    void nativeTask(() => RowdyNative.save({ context, snapshot })).catch(console.error);
  }, [context, authLoading, loading, tournament, data]);
  useEffect(() => {
    const openStandings = ({ url }: { url: string }) => {
      if (url.startsWith('rowdytest://standings')) {
        history.pushState({}, '', '/'); window.dispatchEvent(new PopStateEvent('popstate'));
      }
    };
    const consumeRoute = () => RowdyNative.takeOpenStandings().then(({ open }) => { if (open) openStandings({ url: 'rowdytest://standings' }); }).catch(console.error);
    const shortcut = RowdyNative.addListener("openStandings", () => void consumeRoute());
    void consumeRoute();
    const resume = CapacitorApp.addListener('appStateChange', ({ isActive }) => { if (isActive) void consumeRoute(); });
    const listener = CapacitorApp.addListener('appUrlOpen', openStandings);
    void CapacitorApp.getLaunchUrl().then(result => { if (result) openStandings(result); });
    const click = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest('a') : null;
      if (!anchor) return;
      const url = new URL(anchor.href, location.href);
      if (url.origin === location.origin) return;
      if (url.origin === 'https://app.rowdycup.com' && url.pathname !== '/rules-official') {
        event.preventDefault(); event.stopPropagation();
        history.pushState({}, '', url.pathname + url.search + url.hash);
        window.dispatchEvent(new PopStateEvent('popstate'));
        return;
      }
      if (!['https:', 'http:', 'mailto:', 'tel:'].includes(url.protocol)) return;
      event.preventDefault(); event.stopPropagation();
      void RowdyNative.openExternal({ url: url.href }).catch(console.error);
    };
    document.addEventListener('click', click, true);
    return () => { document.removeEventListener('click', click, true); void listener.then(handle => handle.remove()); void resume.then(handle => handle.remove()); void shortcut.then(handle => handle.remove()); };
  }, []);
  return <NativeData.Provider value={data}>{children}</NativeData.Provider>;
}
export function NativeRulesOfficial() {
  const open = () => RowdyNative.openExternal({ url: 'https://app.rowdycup.com/rules-official' });
  useEffect(() => { void open().catch(console.error); }, []);
  return <div className="p-6 space-y-4"><p>Rules Official opens in your browser using the existing protected web app. Sign in there if needed.</p><button onClick={() => void open()}>Open Rules Official</button></div>;
}
