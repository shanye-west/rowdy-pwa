/**
 * Web-push (FCM) client helpers.
 *
 * The push handler lives in public/firebase-messaging-sw.js (importScripts'd
 * into the Workbox service worker) and shows a system notification for EVERY
 * push, foreground or background. Here we cover the app side: feature-detection
 * (incl. the iOS "must install to Home Screen" case), turning push on/off, and
 * keeping the device's registration healthy (refreshPushRegistration).
 *
 * Tokens are persisted server-side via the registerPushToken / unregisterPushToken
 * callables (the pushTokens collection is locked to clients). We keep the local
 * token in localStorage only so disablePush can tell the server which one to drop.
 */

import {
  getMessaging,
  getToken,
  deleteToken,
  isSupported,
  type Messaging,
} from "firebase/messaging";
import { httpsCallable } from "firebase/functions";
import { app, functions } from "./firebase";

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;
const LOCAL_TOKEN_KEY = "rowdy:push-token";

const registerPushToken = httpsCallable<
  { token: string; userAgent?: string; confirm?: boolean },
  { success: boolean; valid?: boolean; confirmed?: boolean }
>(
  functions,
  "registerPushToken"
);
const unregisterPushToken = httpsCallable<{ token: string }, { success: boolean }>(
  functions,
  "unregisterPushToken"
);

/** Cache the (supported?) messaging instance so we only probe isSupported once. */
let messagingPromise: Promise<Messaging | null> | null = null;
function messagingIfSupported(): Promise<Messaging | null> {
  if (!messagingPromise) {
    messagingPromise = isSupported()
      .then((ok) => (ok ? getMessaging(app) : null))
      .catch(() => null);
  }
  return messagingPromise;
}

export type PushSupport = "ok" | "unsupported" | "ios-needs-install";

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    // iPadOS reports as "MacIntel" but is touch-capable.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // iOS Safari exposes navigator.standalone for home-screen apps.
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export type IosBrowser = "safari" | "chrome" | "other";

/**
 * Which iOS browser we're in. Every iOS browser runs on WebKit but stamps a
 * distinct UA token: Chrome = "CriOS", Firefox = "FxiOS", Edge = "EdgiOS", etc.
 * Real Safari has "Safari" without any of those. Used only to pick the matching
 * Add-to-Home-Screen walkthrough — the install UI differs by browser, but once
 * installed it's all WebKit, so push works regardless of how it was added.
 * In-app webviews (Instagram/Facebook) and other engines fall back to "other".
 */
export function iosBrowser(): IosBrowser {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  if (/CriOS/.test(ua)) return "chrome";
  if (/FxiOS|EdgiOS|OPiOS|GSA/.test(ua)) return "other";
  if (/Safari/.test(ua)) return "safari";
  return "other";
}

/**
 * Whether web push can be enabled here. iOS only delivers web push to PWAs added
 * to the Home Screen (iOS 16.4+); when on iOS Safari un-installed we return
 * "ios-needs-install" so the UI can guide the user instead of failing silently.
 */
export function pushSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported";
  const ios = isIOS();
  if (ios && !isStandalone()) return "ios-needs-install";
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return "unsupported";
  }
  return "ok";
}

/** Best-effort read of whether push is currently on for this device. */
export function isPushEnabledLocally(): boolean {
  if (typeof window === "undefined" || !("Notification" in window)) return false;
  return Notification.permission === "granted" && !!localStorage.getItem(LOCAL_TOKEN_KEY);
}

export type EnableResult = { ok: true; confirmed: boolean } | { ok: false; reason: PushSupport | "denied" | "missing-vapid" | "no-token" };

/** Request permission, mint an FCM token, and register it server-side. */
export async function enablePush(): Promise<EnableResult> {
  const support = pushSupport();
  if (support !== "ok") return { ok: false, reason: support };
  if (!VAPID_KEY) return { ok: false, reason: "missing-vapid" };

  // Request directly from the tap, before asynchronous SDK/IndexedDB checks
  // can consume the user activation required by iOS.
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, reason: "denied" };

  const messaging = await messagingIfSupported();
  if (!messaging) return { ok: false, reason: "unsupported" };

  // Reuse the single app service worker (Workbox SW with the FCM handler imported)
  // rather than letting the SDK register its own /firebase-messaging-sw.js.
  const registration = await navigator.serviceWorker.ready;
  const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
  if (!token) return { ok: false, reason: "no-token" };

  // `confirm` asks the server to follow up with a real push to this device
  // ("Push confirmed") — it lands a few seconds later and proves delivery end
  // to end.
  await registerPushToken({ token, userAgent: navigator.userAgent, confirm: true });
  localStorage.setItem(LOCAL_TOKEN_KEY, token);

  // Meanwhile, confirm instantly with a system notification shown straight
  // from this device, so success isn't left hanging for the round trip.
  let confirmed = false;
  try {
    await registration.showNotification("Notifications are on 🎉", {
      body: "You'll get Rowdy Cup alerts on this device.",
      icon: "/pwa-192x192.png",
      badge: "/pwa-192x192.png",
      tag: "welcome",
      data: { link: "/settings/notifications" },
    });
    confirmed = true;
  } catch {
    /* caller falls back to an in-app message */
  }
  return { ok: true, confirmed };
}

const REFRESH_CHECK_INTERVAL_MS = 10 * 60 * 1000;
/** Waits before each self-heal attempt (first is immediate); ~45s in total. */
const RETRY_DELAYS_MS = [0, 3_000, 7_000, 15_000, 20_000];
let lastRefreshCheck = 0;
let refreshInFlight: Promise<string> | null = null;
/** Outcome of the most recent refreshPushRegistration run (for diagnostics). */
let lastRefreshOutcome = "not run yet";

function describeError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

/**
 * Self-heal this device's push registration. Call on app start / resume for a
 * signed-in player who already turned push on.
 *
 * iOS kills a home-screen app's push subscription underneath us — after "silent"
 * pushes, and (observed) across a hard quit — and it does so on Apple's side
 * only: pushManager.getSubscription() and the Firebase SDK's cached token both
 * still look fine locally, while FCM answers "registration-token-not-registered".
 * So a local check can't see it. Instead we hand the token to registerPushToken,
 * which asks FCM whether it is still alive (a dry-run send — nothing is
 * delivered). If it's dead we do exactly what "toggle off, then on" does:
 * delete the token + browser subscription, mint a fresh pair, register that.
 *
 * Never prompts: it only runs when permission is already granted. Returns a
 * short human-readable outcome; `force` bypasses the 10-minute throttle.
 */
export function refreshPushRegistration(opts: { force?: boolean } = {}): Promise<string> {
  if (refreshInFlight) return refreshInFlight;
  if (!VAPID_KEY || pushSupport() !== "ok" || !isPushEnabledLocally()) {
    return Promise.resolve("skipped (push not enabled on this device)");
  }
  const now = Date.now();
  if (!opts.force && now - lastRefreshCheck < REFRESH_CHECK_INTERVAL_MS) {
    return Promise.resolve(lastRefreshOutcome);
  }
  const vapidKey = VAPID_KEY;
  const run = async (): Promise<string> => {
    const messaging = await messagingIfSupported();
    if (!messaging) return "skipped (messaging unsupported)";
    const registration = await navigator.serviceWorker.ready;
    const previous = localStorage.getItem(LOCAL_TOKEN_KEY);

    let token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });
    if (!token) return "failed (no token)";
    let { data } = await registerPushToken({ token, userAgent: navigator.userAgent });
    let outcome = token === previous ? "ok (token still valid)" : "ok (token had changed; re-registered)";

    if (data.valid === false) {
      // Dead on the push service. Tear down and re-subscribe from scratch.
      try {
        await deleteToken(messaging);
      } catch {
        /* already gone server-side — carry on */
      }
      // deleteToken should unsubscribe, but make sure the dead browser
      // subscription really is gone so getToken creates a brand-new one.
      try {
        const stale = await registration.pushManager.getSubscription();
        if (stale) await stale.unsubscribe();
      } catch {
        /* ignore */
      }
      token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });
      if (!token) return "failed (token was dead; could not mint a new one)";
      ({ data } = await registerPushToken({ token, userAgent: navigator.userAgent }));
      outcome =
        data.valid === false
          ? "failed (token was dead; the replacement was rejected too)"
          : "repaired (token was dead; re-subscribed)";
    }

    localStorage.setItem(LOCAL_TOKEN_KEY, token);
    if (previous && previous !== token) {
      // The old token is dead weight server-side — drop it (best-effort).
      unregisterPushToken({ token: previous }).catch(() => {});
    }
    lastRefreshCheck = Date.now();
    return outcome;
  };
  // Right after an iOS relaunch the first attempt to mint a replacement token
  // routinely fails with a transient FCM "Internal error" (observed on device:
  // failed at launch, succeeded 17s later). The old token is already gone by
  // then, so giving up would leave the device unreachable until the next launch
  // — retry with backoff instead. run() is safe to repeat from scratch.
  const runWithRetry = async (): Promise<string> => {
    let lastError: unknown;
    for (const delay of RETRY_DELAYS_MS) {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      try {
        const outcome = await run();
        if (!outcome.startsWith("failed")) return delay ? `${outcome} after retry` : outcome;
        lastError = outcome;
      } catch (err) {
        lastError = err;
      }
    }
    return typeof lastError === "string" ? lastError : `failed (${describeError(lastError)})`;
  };
  refreshInFlight = runWithRetry()
    .catch((err) => `failed (${describeError(err)})`)
    .then((outcome) => {
      lastRefreshOutcome = `${outcome} @ ${new Date().toLocaleTimeString()}`;
      refreshInFlight = null;
      return lastRefreshOutcome;
    });
  return refreshInFlight;
}

/** Ask the active service worker which push-handler version it is running. */
function pingServiceWorker(): Promise<string> {
  return new Promise((resolve) => {
    const controller = navigator.serviceWorker?.controller;
    if (!controller) return resolve("no controller");
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve("OLD (no reply — reopen the app to update)"), 1500);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      resolve(`v${String((event.data as { version?: unknown } | null)?.version ?? "?")}`);
    };
    controller.postMessage({ type: "rowdy-push-ping" }, [channel.port2]);
  });
}

/**
 * Admin diagnostic: a snapshot of this device's push state, so a failing test
 * can be read off the phone instead of guessed at. Tokens are shown as their
 * last 6 characters only.
 */
export async function getPushDiagnostics(): Promise<string[]> {
  const tail = (v: string | null | undefined) => (v ? `…${v.slice(-6)}` : "none");
  const lines: string[] = [`build ${__BUILD_TIME__}`];
  try {
    lines.push(`standalone ${isStandalone() ? "yes" : "no"}, support ${pushSupport()}`);
    lines.push(`permission ${"Notification" in window ? Notification.permission : "n/a"}`);
    lines.push(`service worker ${await pingServiceWorker()}`);
    const registration = await navigator.serviceWorker.ready;
    const sub = await registration.pushManager.getSubscription();
    lines.push(`subscription ${sub ? tail(sub.endpoint) : "NONE"}`);
    lines.push(`saved token ${tail(localStorage.getItem(LOCAL_TOKEN_KEY))}`);
  } catch (err) {
    lines.push(`diagnostics error: ${describeError(err)}`);
  }
  lines.push(`last self-check: ${lastRefreshOutcome}`);
  return lines;
}

/** Delete the device token locally and server-side. */
export async function disablePush(): Promise<void> {
  const token = localStorage.getItem(LOCAL_TOKEN_KEY);
  try {
    const messaging = await messagingIfSupported();
    if (messaging) await deleteToken(messaging);
  } catch {
    /* token may already be gone — ignore */
  }
  if (token) {
    try {
      await unregisterPushToken({ token });
    } catch {
      /* best-effort cleanup */
    }
  }
  localStorage.removeItem(LOCAL_TOKEN_KEY);
}
