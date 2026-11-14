/**
 * Build identity + the admin "Hard refresh" (Layout menu).
 *
 * `version.json` is emitted by every build (vite.config.ts) and is not
 * precached by the service worker, so fetching it with `no-store` always
 * answers "what is deployed right now".
 */
import { hardResetApp } from "./swRecovery";

const BUILD_DATE = new Date(__BUILD_TIME__);

/** e.g. "54f60b5 · Nov 13, 6:02 PM" — the git SHA plus when it was built. */
export const BUILD_LABEL = Number.isNaN(BUILD_DATE.getTime())
  ? __GIT_SHA__
  : `${__GIT_SHA__} · ${BUILD_DATE.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;

/** The deployed build's timestamp, or null when it can't be fetched (offline). */
export async function fetchDeployedBuildTime(): Promise<string | null> {
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    const v: unknown = await res.json();
    return v && typeof v === "object" && "buildTime" in v && typeof v.buildTime === "string" ? v.buildTime : null;
  } catch {
    return null;
  }
}

const PENDING_KEY = "rowdy:hard-refresh-expected";
const ACTIVATE_TIMEOUT_MS = 15_000;

/** Resolve when a new service worker takes control of this page (or on timeout → false). */
function waitForNewController(): Promise<boolean> {
  return new Promise((resolve) => {
    const sw = navigator.serviceWorker;
    if (!sw) return resolve(false);
    const timer = setTimeout(() => { sw.removeEventListener("controllerchange", onChange); resolve(false); }, ACTIVATE_TIMEOUT_MS);
    function onChange() { clearTimeout(timer); sw.removeEventListener("controllerchange", onChange); resolve(true); }
    sw.addEventListener("controllerchange", onChange);
  });
}

export type HardRefreshOutcome = "offline" | "reloading";

/**
 * Get this device onto the deployed build, then reload.
 *
 * - Already current: just reload (fresh data, same build).
 * - Newer build deployed: ask the service worker to fetch it and wait for the
 *   new worker to take over (it precaches the whole new build, so offline
 *   scoring keeps working), then reload.
 * - If the new worker doesn't take over in time, fall back to the full reset
 *   (unregister + clear caches). That also drops this device's push
 *   subscription; the app re-registers it on the next start.
 *
 * The expected build is remembered across the reload so the result can be
 * reported (see `takeHardRefreshResult`).
 */
export async function hardRefreshToLatest(): Promise<HardRefreshOutcome> {
  const deployed = await fetchDeployedBuildTime();
  if (!deployed) return "offline";
  try { sessionStorage.setItem(PENDING_KEY, deployed); } catch { /* report is best-effort */ }

  if (deployed !== __BUILD_TIME__) {
    const reg = await navigator.serviceWorker?.getRegistration().catch(() => undefined);
    if (reg) {
      const taken = waitForNewController();
      await reg.update().catch(() => {});
      if (!(await taken)) {
        await hardResetApp();
        return "reloading";
      }
    }
  }
  window.location.reload();
  return "reloading";
}

/**
 * After a hard refresh's reload: whether this page is the build the server had
 * (true), still an older one (false), or no hard refresh just happened (null).
 * Consumes the marker.
 */
export function takeHardRefreshResult(): boolean | null {
  try {
    const expected = sessionStorage.getItem(PENDING_KEY);
    if (expected === null) return null;
    sessionStorage.removeItem(PENDING_KEY);
    return expected === __BUILD_TIME__;
  } catch {
    return null;
  }
}
