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
