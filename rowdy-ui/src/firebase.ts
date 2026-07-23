import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "firebase/firestore";
import { getFunctions } from "firebase/functions";
import { 
  getAuth,
  setPersistence,
  browserLocalPersistence,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged,
  type User
} from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_API_KEY as string,
  authDomain: import.meta.env.VITE_AUTH_DOMAIN as string,
  projectId: import.meta.env.VITE_PROJECT_ID as string,
  storageBucket: import.meta.env.VITE_STORAGE_BUCKET as string,
  messagingSenderId: import.meta.env.VITE_MESSAGING_SENDER_ID as string,
  appId: import.meta.env.VITE_APP_ID as string,
  measurementId: import.meta.env.VITE_MEASUREMENT_ID as string | undefined,
};

export const app = initializeApp(firebaseConfig);

// App Check (opt-in). Once a reCAPTCHA Enterprise provider is registered in the
// Firebase console and VITE_APPCHECK_SITE_KEY is set at build time (the reCAPTCHA
// Enterprise key id), this attests that requests originate from the genuine app —
// blocking direct SDK/REST abuse (scraping, or token-farming the paid AI endpoint)
// from non-app clients. It is a NO-OP until the key is configured, so this is safe
// to ship ahead of the console setup and before flipping on server-side
// enforcement (ENFORCE_APP_CHECK on the callables). Initialise it right after
// initializeApp, before any service makes a request.
const appCheckSiteKey = import.meta.env.VITE_APPCHECK_SITE_KEY as string | undefined;
if (appCheckSiteKey) {
  // Local dev / preview: set VITE_APPCHECK_DEBUG_TOKEN to a debug token registered
  // in the console so localhost passes attestation without a real reCAPTCHA.
  const debugToken = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN as string | undefined;
  if (debugToken) {
    (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string }).FIREBASE_APPCHECK_DEBUG_TOKEN =
      debugToken;
  }
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
    isTokenAutoRefreshEnabled: true,
  });
}

export const auth = getAuth(app);
export const functions = getFunctions(app);

// Initialize Firestore with modern persistence API
// - persistentLocalCache: Enables IndexedDB persistence for offline support
// - persistentMultipleTabManager: Allows multiple tabs to share the same cache
// This is critical for golf courses with spotty cell coverage
// - experimentalAutoDetectLongPolling: on flaky networks/proxies/WebViews the
//   streaming WebChannel can stall, delaying the first connection (and the
//   first snapshot) after a hard reload — which is what leaves pages spinning.
//   Auto-detect falls back to long-polling when streaming is blocked, so the
//   connection establishes far more reliably on spotty coverage.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager()
  }),
  experimentalAutoDetectLongPolling: true,
});

// Export auth utilities for use in AuthContext
export {
  setPersistence,
  browserLocalPersistence,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged,
  type User
};