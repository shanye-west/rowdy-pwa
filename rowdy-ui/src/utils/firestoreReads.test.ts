import { beforeEach, describe, expect, it, vi } from "vitest";

const getDocs = vi.fn();
const getDocsFromCache = vi.fn();
const getDocsFromServer = vi.fn();

vi.mock("firebase/firestore", () => ({
  getDoc: vi.fn(),
  getDocFromCache: vi.fn(),
  getDocFromServer: vi.fn(),
  getDocs: (...args: unknown[]) => getDocs(...args),
  getDocsFromCache: (...args: unknown[]) => getDocsFromCache(...args),
  getDocsFromServer: (...args: unknown[]) => getDocsFromServer(...args),
}));

import type { Query } from "firebase/firestore";
import { getDocsByIdCacheFirst, getDocsPrimed } from "./firestoreReads";

/** Minimal QuerySnapshot stand-in: only the fields the helpers read. */
function snap(ids: string[], fromCache = false) {
  return { docs: ids.map((id) => ({ id })), empty: ids.length === 0, metadata: { fromCache } };
}

const q = {} as Query;
const flush = () => new Promise((r) => setTimeout(r, 0));

// The default vitest environment is node — give the helpers a localStorage.
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
});

beforeEach(() => {
  getDocs.mockReset();
  getDocsFromCache.mockReset();
  getDocsFromServer.mockReset();
  store.clear();
});

describe("getDocsByIdCacheFirst", () => {
  it("returns the cache without touching the server when every id is cached", async () => {
    const cached = snap(["a", "b"], true);
    getDocsFromCache.mockResolvedValue(cached);

    await expect(getDocsByIdCacheFirst(q, ["a", "b"])).resolves.toBe(cached);
    expect(getDocs).not.toHaveBeenCalled();
    expect(getDocsFromServer).not.toHaveBeenCalled();
  });

  it("falls back to a normal read on a partial cache hit", async () => {
    getDocsFromCache.mockResolvedValue(snap(["a"], true));
    const server = snap(["a", "b"]);
    getDocs.mockResolvedValue(server);

    await expect(getDocsByIdCacheFirst(q, ["a", "b"])).resolves.toBe(server);
  });

  it("falls back to a normal read when the cache throws", async () => {
    getDocsFromCache.mockRejectedValue(new Error("no persistence"));
    const server = snap(["a"]);
    getDocs.mockResolvedValue(server);

    await expect(getDocsByIdCacheFirst(q, ["a"])).resolves.toBe(server);
  });

  it("revalidates in the background after a full cache hit when onFresh is given", async () => {
    getDocsFromCache.mockResolvedValue(snap(["a"], true));
    const fresh = snap(["a"]);
    getDocsFromServer.mockResolvedValue(fresh);
    const onFresh = vi.fn();

    await getDocsByIdCacheFirst(q, ["a"], onFresh);
    await flush();
    expect(onFresh).toHaveBeenCalledWith(fresh);
  });

  it("a failed background revalidation is swallowed", async () => {
    getDocsFromCache.mockResolvedValue(snap(["a"], true));
    getDocsFromServer.mockRejectedValue(new Error("offline"));
    const onFresh = vi.fn();

    await getDocsByIdCacheFirst(q, ["a"], onFresh);
    await flush();
    expect(onFresh).not.toHaveBeenCalled();
  });
});

describe("getDocsPrimed", () => {
  it("is server-first until a server read has completed, then primes the key", async () => {
    const server = snap(["a", "b"]);
    getDocs.mockResolvedValue(server);
    const onFresh = vi.fn();

    await expect(getDocsPrimed("k", q, onFresh)).resolves.toBe(server);
    expect(getDocsFromCache).not.toHaveBeenCalled();
    expect(store.get("rowdycup:primed:k")).toBe("1");
  });

  it("does not prime from an offline (cache-served) read", async () => {
    getDocs.mockResolvedValue(snap(["a"], true));

    await getDocsPrimed("k", q, vi.fn());
    expect(store.has("rowdycup:primed:k")).toBe(false);
  });

  it("once primed, returns the cache immediately and delivers the server copy via onFresh", async () => {
    store.set("rowdycup:primed:k", "1");
    const cached = snap(["a"], true);
    const fresh = snap(["a", "b"]);
    getDocsFromCache.mockResolvedValue(cached);
    getDocsFromServer.mockResolvedValue(fresh);
    const onFresh = vi.fn();

    await expect(getDocsPrimed("k", q, onFresh)).resolves.toBe(cached);
    expect(getDocs).not.toHaveBeenCalled();
    await flush();
    expect(onFresh).toHaveBeenCalledWith(fresh);
  });

  it("trusts an empty cached result once primed (an empty list is a real answer)", async () => {
    store.set("rowdycup:primed:k", "1");
    const cached = snap([], true);
    getDocsFromCache.mockResolvedValue(cached);
    getDocsFromServer.mockResolvedValue(snap([]));

    await expect(getDocsPrimed("k", q, vi.fn())).resolves.toBe(cached);
  });

  it("keys are independent", async () => {
    store.set("rowdycup:primed:other", "1");
    const server = snap(["a"]);
    getDocs.mockResolvedValue(server);

    await expect(getDocsPrimed("k", q, vi.fn())).resolves.toBe(server);
    expect(getDocsFromCache).not.toHaveBeenCalled();
  });
});
