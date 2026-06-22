/**
 * App recovery helpers for the "stuck after a deploy" failure mode.
 *
 * When the active service worker is serving a stale shell (a lazy chunk 404s,
 * or the first Firestore snapshot never arrives because of a wedged cache),
 * a plain reload can loop against the same SW. `hardResetApp` unregisters every
 * service worker and drops all caches so the next load fetches fresh from the
 * network — the same thing a user achieves by uninstalling/force-closing the
 * PWA, but as a single tap.
 */
export async function hardResetApp(): Promise<void> {
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch {
    /* best effort — fall through to cache clear + reload */
  }
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    /* best effort */
  }
  // Cache-bust the navigation so we don't get the stale document back.
  window.location.reload();
}

/**
 * Recover from a stale / failed chunk load (a lazy route's chunk 404s after a
 * deploy, or the fetch hangs/fails). Reloading once normally picks up the fresh
 * bundle, but a plain reload can loop against the same stale SW — so we count
 * attempts in sessionStorage and, after a few within 30s, unregister the SW and
 * drop all caches to force a clean network fetch. That breaks the loop without
 * the user having to force-close the app.
 *
 * Shared by both the route ErrorBoundary (render-time chunk errors) and
 * `lazyWithRecovery` (load-time timeout/failure) so they use one loop guard.
 * No-op while offline (a reload or cache wipe would only strand the user).
 */
export function recoverFromStaleChunk(): void {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;

  const KEY = "sw-chunk-recovery";
  let count = 0;
  try {
    const parsed = JSON.parse(sessionStorage.getItem(KEY) || "null") as { count: number; at: number } | null;
    // Anything older than 30s is treated as a fresh incident, not a loop.
    if (parsed && Date.now() - parsed.at < 30_000) count = parsed.count;
  } catch { /* ignore malformed state */ }

  count += 1;
  try { sessionStorage.setItem(KEY, JSON.stringify({ count, at: Date.now() })); } catch { /* ignore */ }

  if (count < 3) {
    window.location.reload();
    return;
  }

  // Repeated failures → nuke the SW + caches, then reload from the network.
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
  void hardResetApp();
}
