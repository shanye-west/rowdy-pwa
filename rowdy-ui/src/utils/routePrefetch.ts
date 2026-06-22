/**
 * Best-effort lazy-chunk prefetch on navigation intent (pointer/touch down).
 *
 * Warming a route's chunk before the tap completes makes most navigations render
 * instantly instead of suspending on the chunk fetch. A path not listed here is
 * simply not prefetched (no-op) — React.lazy still loads it on navigation — so
 * the map drifting from main.tsx only ever costs a prefetch, never correctness.
 *
 * Importers use the same specifiers as the lazy routes in main.tsx, so Vite
 * resolves them to the exact same chunk (no duplicate bundle).
 */
const PREFETCHERS: Array<[RegExp, () => Promise<unknown>]> = [
  [/^\/match\//, () => import("../routes/Match")],
  [/^\/round\/[^/]+\/pairings/, () => import("../routes/Pairings")],
  [/^\/round\/[^/]+\/skins/, () => import("../routes/Skins")],
  [/^\/round\/[^/]+\/recap/, () => import("../routes/RoundRecap")],
  [/^\/round\//, () => import("../routes/Round")],
  [/^\/teams/, () => import("../routes/Teams")],
  [/^\/draft/, () => import("../routes/DraftPool")],
  [/^\/leaderboard/, () => import("../routes/Leaderboard")],
  [/^\/sportsbook/, () => import("../routes/Sportsbook")],
  [/^\/chat/, () => import("../routes/Chat")],
  [/^\/player\//, () => import("../routes/Player")],
  [/^\/history/, () => import("../routes/History")],
  [/^\/tournament\//, () => import("../routes/Tournament")],
  [/^\/login/, () => import("../routes/Login")],
];

// Only warm each chunk once per session.
const warmed = new Set<string>();

/** Prefetch the chunk for `path` if we know its importer. Safe to call often. */
export function prefetchRoute(path: string): void {
  for (const [test, load] of PREFETCHERS) {
    if (test.test(path)) {
      const key = test.source;
      if (warmed.has(key)) return;
      warmed.add(key);
      // Drop the result; this only warms the browser/SW module cache. On failure
      // un-mark so a later real navigation can retry (and trigger recovery).
      load().catch(() => warmed.delete(key));
      return;
    }
  }
}
