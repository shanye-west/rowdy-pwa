/* Firebase Cloud Messaging — background push handler.
 *
 * This file is importScripts'd INTO the Workbox-generated service worker (see
 * `workbox.importScripts` in vite.config.ts), so the PWA keeps a single service
 * worker at scope "/" that handles BOTH offline caching and background push.
 * (Registering a second SW for FCM at the same scope would conflict.)
 *
 * The Firebase web config below is PUBLIC — it mirrors rowdy-ui/.env.local. The
 * web SDK config is not a secret (Firestore security rules protect data; see
 * .env.example), and a service worker can't read import.meta.env, so it is
 * inlined here per Firebase's documented FCM-SW convention.
 *
 * The compat SDK is used (not the modular SDK) because importScripts pulls in
 * plain, pre-bundled scripts — keep the version in sync with `firebase` in
 * package.json (12.6.0).
 */
importScripts("https://www.gstatic.com/firebasejs/12.6.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.6.0/firebase-messaging-compat.js");

// Guard the whole FCM setup: firebase.messaging() throws
// "messaging/unsupported-browser" where push isn't available, and this script
// also runs as the offline-caching SW — a throw here would break caching too.
try {
  firebase.initializeApp({
    apiKey: "AIzaSyAt561vHNjQZKEAbQbLYTbg15EfODb3o4k",
    authDomain: "rowdy-pwa.firebaseapp.com",
    projectId: "rowdy-pwa",
    storageBucket: "rowdy-pwa.firebasestorage.app",
    messagingSenderId: "463685576544",
    appId: "1:463685576544:web:a01c6d1c204b1d150de005",
  });

  const messaging = firebase.messaging();

  // Background delivery (app not focused). We send DATA-ONLY messages from the
  // server, so nothing is auto-displayed — we render here to control the icon and
  // the deep link, and to avoid the duplicate-notification problem that a
  // `notification` payload causes.
  messaging.onBackgroundMessage((payload) => {
    const data = payload.data || {};
    const title = data.title || "Rowdy Cup";
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/pwa-192x192.png",
      badge: "/pwa-192x192.png",
      tag: data.category || "rowdy",
      data: { link: data.link || "/" },
    });
  });
} catch (err) {
  // Push unsupported in this browser — offline caching (the rest of the SW) is
  // unaffected.
  console.warn("[fcm-sw] messaging unavailable:", err);
}

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
