/**
 * Public Firebase Web config for the read-only MCP server.
 *
 * These are the SAME public values shipped in the deployed PWA bundle
 * (see rowdy-ui/src/firebase.ts + rowdy-ui/.env.local). They are NOT secrets —
 * a Firebase Web apiKey only identifies the project; access is governed entirely
 * by Firestore security rules. We read through the *unauthenticated* Web SDK so
 * the public-read / client-write-denied rules enforce read-only at the
 * infrastructure level (the Admin SDK is deliberately NOT used here because it
 * bypasses rules).
 */
export const FIREBASE_WEB_CONFIG = {
  apiKey: "AIzaSyAt561vHNjQZKEAbQbLYTbg15EfODb3o4k",
  authDomain: "rowdy-pwa.firebaseapp.com",
  projectId: "rowdy-pwa",
  storageBucket: "rowdy-pwa.firebasestorage.app",
  messagingSenderId: "463685576544",
  appId: "1:463685576544:web:a01c6d1c204b1d150de005",
} as const;

/** Default tournament series when a tool caller doesn't specify one. */
export const DEFAULT_SERIES = "rowdyCup";
