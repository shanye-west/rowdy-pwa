/**
 * Cache-first Firestore reads.
 *
 * `getDoc`/`getDocs` prefer the server when "online", so on a slow or half-open
 * connection they block for a long time even though the data already sits in
 * the on-device IndexedDB cache (persistence is enabled in firebase.ts). That
 * is a primary cause of pages spinning after a (hard) reload. These helpers
 * read from the cache first for an instant result and only hit the network on a
 * cache miss — turning "wait for the server" one-shot reads into "show what we
 * have, fetch the rest if needed."
 */
import {
  getDoc,
  getDocFromCache,
  getDocFromServer,
  getDocs,
  getDocsFromCache,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type Query,
  type QuerySnapshot,
} from "firebase/firestore";

/**
 * Read a single document cache-first. Returns the cached copy instantly when
 * present; otherwise falls back to a normal (cache-or-server) read.
 *
 * Pass `onFresh` only when the doc can change while it's on screen and you need
 * the update — it triggers a background server read after returning the cached
 * value. Omit it for effectively-static docs (courses, historical tournaments)
 * to avoid spending extra reads.
 */
export async function getDocCacheFirst<T = DocumentData>(
  ref: DocumentReference<T>,
  onFresh?: (snap: DocumentSnapshot<T>) => void,
): Promise<DocumentSnapshot<T>> {
  try {
    const cached = await getDocFromCache(ref);
    if (onFresh) {
      // Refresh from the server in the background; never block the caller.
      getDocFromServer(ref).then(onFresh).catch(() => {});
    }
    return cached;
  } catch {
    // Not in cache (or persistence unavailable, e.g. in tests) — normal read.
    return getDoc(ref);
  }
}

/**
 * Run a query cache-first. Returns cached results when the cache holds any
 * matches; otherwise falls back to a normal read. Use for static result sets
 * (locked-round matches, closed-match facts) where freshness isn't critical.
 */
export async function getDocsCacheFirst<T = DocumentData>(
  q: Query<T>,
): Promise<QuerySnapshot<T>> {
  try {
    const cached = await getDocsFromCache(q);
    if (!cached.empty) return cached;
  } catch {
    /* cache miss / persistence unavailable — fall through to a normal read */
  }
  return getDocs(q);
}
