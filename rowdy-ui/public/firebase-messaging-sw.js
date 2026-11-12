/* Web push — service-worker side.
 *
 * This file is importScripts'd INTO the Workbox-generated service worker (see
 * `workbox.importScripts` in vite.config.ts), so the PWA keeps a single service
 * worker at scope "/" that handles BOTH offline caching and push.
 *
 * We deliberately do NOT load the Firebase Messaging SDK here and handle the raw
 * `push` event ourselves. The SDK's handler skips showing a notification whenever
 * an app window is visible (it forwards the payload to the page instead). Safari /
 * iOS treats a push that shows nothing as a "silent push" and, after a few of
 * them, REVOKES the push subscription — after which nothing is delivered until
 * the user turns notifications off and on again. So the one hard rule in this
 * file: EVERY push event shows a notification, no matter what.
 *
 * The page still mints the FCM token with the modular SDK (src/messaging.ts);
 * that only needs a service-worker registration, not the SDK in the worker.
 *
 * The server sends DATA-ONLY FCM messages (functions/src/messaging/notify.ts),
 * which arrive as JSON shaped like { data: { title, body, link, category }, ... }.
 */

self.addEventListener("push", (event) => {
  let data = {};
  try {
    const payload = event.data ? event.data.json() : {};
    // Data-only messages carry our fields under `data`; tolerate a `notification`
    // block too in case one is ever sent (e.g. from the Firebase console).
    data = Object.assign({}, payload.notification || {}, payload.data || {});
  } catch {
    /* unparseable payload — still show a generic alert below */
  }

  // waitUntil keeps the worker alive until the alert is actually displayed;
  // without it iOS can suspend the worker first (which also counts as silent).
  event.waitUntil(
    self.registration.showNotification(data.title || "Rowdy Cup", {
      body: data.body || "",
      icon: "/pwa-192x192.png",
      badge: "/pwa-192x192.png",
      tag: data.category || "rowdy",
      // Same-tag notifications replace each other; re-alert when they do so a
      // second chat message isn't swapped in silently.
      renotify: true,
      data: { link: data.link || "/" },
    })
  );
});

// Diagnostics: lets the app confirm THIS handler (not an older cached worker) is
// the one in control. Bump the version when this file's behavior changes.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "rowdy-push-ping" && event.ports && event.ports[0]) {
    event.ports[0].postMessage({ version: 2 });
  }
});

// Tap → focus an existing app window (navigating it to the deep link) or open one.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || "/";
  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clientList) {
        if ("focus" in client) {
          if ("navigate" in client) {
            try {
              await client.navigate(link);
            } catch {
              /* detached/cross-origin — fall back to focus */
            }
          }
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(link);
    })()
  );
});
