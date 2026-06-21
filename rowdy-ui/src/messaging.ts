/**
 * Web-push (FCM) client helpers.
 *
 * The background handler lives in public/firebase-messaging-sw.js (importScripts'd
 * into the Workbox service worker). Here we cover the app side: feature-detection
 * (incl. the iOS "must install to Home Screen" case), turning push on/off, and
 * forwarding foreground messages.
 *
 * Tokens are persisted server-side via the registerPushToken / unregisterPushToken
 * callables (the pushTokens collection is locked to clients). We keep the local
 * token in localStorage only so disablePush can tell the server which one to drop.
 */

import {
  getMessaging,
  getToken,
  deleteToken,
  onMessage,
  isSupported,
  type Messaging,
  type MessagePayload,
} from "firebase/messaging";
import { httpsCallable } from "firebase/functions";
import { app, functions } from "./firebase";

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;
const LOCAL_TOKEN_KEY = "rowdy:push-token";

const registerPushToken = httpsCallable<{ token: string; userAgent?: string }, { success: boolean }>(
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

export type EnableResult = { ok: true } | { ok: false; reason: PushSupport | "denied" | "missing-vapid" | "no-token" };

/** Request permission, mint an FCM token, and register it server-side. */
export async function enablePush(): Promise<EnableResult> {
  const support = pushSupport();
  if (support !== "ok") return { ok: false, reason: support };
  if (!VAPID_KEY) return { ok: false, reason: "missing-vapid" };

  const messaging = await messagingIfSupported();
  if (!messaging) return { ok: false, reason: "unsupported" };

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, reason: "denied" };

  // Reuse the single app service worker (Workbox SW with the FCM handler imported)
  // rather than letting the SDK register its own /firebase-messaging-sw.js.
  const registration = await navigator.serviceWorker.ready;
  const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
  if (!token) return { ok: false, reason: "no-token" };

  await registerPushToken({ token, userAgent: navigator.userAgent });
  localStorage.setItem(LOCAL_TOKEN_KEY, token);
  return { ok: true };
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

/**
 * Subscribe to foreground push (delivered to onMessage when the app is focused;
 * background is handled by the service worker). Returns an unsubscribe function.
 */
export async function onForegroundMessage(cb: (payload: MessagePayload) => void): Promise<() => void> {
  const messaging = await messagingIfSupported();
  if (!messaging) return () => {};
  return onMessage(messaging, cb);
}
