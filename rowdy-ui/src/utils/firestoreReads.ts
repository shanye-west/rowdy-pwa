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
  getDocsFromServer,
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
 *
 * As with `getDocCacheFirst`, pass `onFresh` only when the results can change
 * while on screen — it triggers a background server read after the cached
 * results are returned (stale-while-revalidate).
 */
export async function getDocsCacheFirst<T = DocumentData>(
  q: Query<T>,
  onFresh?: (snap: QuerySnapshot<T>) => void,
): Promise<QuerySnapshot<T>> {
  try {
    const cached = await getDocsFromCache(q);
    if (!cached.empty) {
      if (onFresh) {
        getDocsFromServer(q).then(onFresh).catch(() => {});
      }
      return cached;
    }
  } catch {
    /* cache miss / persistence unavailable — fall through to a normal read */
  }
  return getDocs(q);
}

/**
 * Run a by-id query (`documentId() in [...]`) cache-first, but only trust the
 * cache when it holds EVERY requested id. A cache query returns whatever
 * matching docs happen to be on the device, so a roster where only some
 * players were ever cached would otherwise come back looking complete. On a
 * partial hit (or a miss) this falls back to a normal read.
 *
 * Pass `onFresh` to revalidate in the background after a cache hit
 * (stale-while-revalidate) — the cached docs paint immediately and a changed
 * name / handicap still arrives a moment later.
 */
export async function getDocsByIdCacheFirst<T = DocumentData>(
  q: Query<T>,
  ids: readonly string[],
  onFresh?: (snap: QuerySnapshot<T>) => void,
): Promise<QuerySnapshot<T>> {
  try {
    const cached = await getDocsFromCache(q);
    const have = new Set(cached.docs.map((d) => d.id));
    if (ids.every((id) => have.has(id))) {
      if (onFresh) {
        getDocsFromServer(q).then(onFresh).catch(() => {});
      }
      return cached;
    }
  } catch {
    /* persistence unavailable — fall through to a normal read */
  }
  return getDocs(q);
}

const PRIMED_PREFIX = "rowdycup:primed:";

function isPrimed(key: string): boolean {
  try {
    return localStorage.getItem(PRIMED_PREFIX + key) === "1";
  } catch {
    return false;
  }
}

function markPrimed(key: string): void {
  try {
    localStorage.setItem(PRIMED_PREFIX + key, "1");
  } catch {
    /* storage unavailable (private mode) — the query just stays server-first */
  }
}

/**
 * Stale-while-revalidate for an open-ended query (one whose result set can't be
 * checked for completeness by id — a leaderboard, a list of past tournaments).
 *
 * The problem with reading such a query straight from the cache is that the
 * cache may hold only PART of the result (docs that arrived via some other,
 * narrower query), which would flash a misleadingly short list. So the cache is
 * trusted only once this device has completed a server read of this exact query
 * — recorded under `key` in localStorage. From then on the cached result
 * returns immediately and `onFresh` delivers the server's copy when it lands.
 *
 * Until then (first visit, or storage cleared — which clears the cache too) it
 * behaves exactly like `getDocs`. `key` must identify the query, parameters
 * included.
 */
export async function getDocsPrimed<T = DocumentData>(
  key: string,
  q: Query<T>,
  onFresh: (snap: QuerySnapshot<T>) => void,
): Promise<QuerySnapshot<T>> {
  if (isPrimed(key)) {
    try {
      const cached = await getDocsFromCache(q);
      getDocsFromServer(q).then(onFresh).catch(() => {});
      return cached;
    } catch {
      /* persistence unavailable — fall through to a normal read */
    }
  }
  const snap = await getDocs(q);
  // An offline getDocs resolves from the cache; that proves nothing about
  // completeness, so only a real server answer primes the key.
  if (!snap.metadata.fromCache) markPrimed(key);
  return snap;
}
