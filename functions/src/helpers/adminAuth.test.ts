import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  where: vi.fn(),
  docGet: vi.fn(),
  getUser: vi.fn(),
  setCustomUserClaims: vi.fn(),
}));

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({
    collection: () => ({
      where: (...args: unknown[]) => ({ get: () => mocks.where(...args) }),
      doc: (id: string) => ({ get: () => mocks.docGet(id) }),
    }),
  }),
}));
vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ getUser: mocks.getUser, setCustomUserClaims: mocks.setCustomUserClaims }),
}));
vi.mock("firebase-functions/logger", () => ({ warn: vi.fn() }));

import type { CallableRequest } from "firebase-functions/v2/https";
import { requirePlayer, setPlayerIdClaim } from "./adminAuth.js";

let n = 0;
/** Fresh uid per test so the in-memory rate limiter never interferes. */
function req(token: Record<string, unknown> = {}): CallableRequest {
  const uid = `u${++n}`;
  return { auth: { uid, token: { uid, ...token } } } as unknown as CallableRequest;
}
const limits = { maxCalls: 100, windowSeconds: 60 };
const playerQuery = (id: string, data: Record<string, unknown>) => ({ empty: false, docs: [{ id, data: () => data }] });

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.getUser.mockResolvedValue({ customClaims: undefined });
  mocks.setCustomUserClaims.mockResolvedValue(undefined);
});

describe("requirePlayer", () => {
  it("uses the playerId claim without any Firestore read", async () => {
    const r = await requirePlayer(req({ playerId: "pShane" }), "fn", limits);
    expect(r.playerId).toBe("pShane");
    expect(mocks.where).not.toHaveBeenCalled();
    expect(mocks.docGet).not.toHaveBeenCalled();
  });

  it("isAdmin() reads the player doc only when asked, and requires it to still be linked to the caller", async () => {
    const request = req({ playerId: "pShane" });
    const uid = request.auth!.uid;
    const r = await requirePlayer(request, "fn", limits);

    mocks.docGet.mockResolvedValueOnce({ exists: true, data: () => ({ authUid: uid, isAdmin: true }) });
    await expect(r.isAdmin()).resolves.toBe(true);
    expect(mocks.docGet).toHaveBeenCalledWith("pShane");

    // Relinked to another account: a stale claim must not confer admin.
    mocks.docGet.mockResolvedValueOnce({ exists: true, data: () => ({ authUid: "someone-else", isAdmin: true }) });
    await expect(r.isAdmin()).resolves.toBe(false);

    mocks.docGet.mockResolvedValueOnce({ exists: false, data: () => undefined });
    await expect(r.isAdmin()).resolves.toBe(false);
  });

  it("without the claim, queries by authUid and backfills the claim", async () => {
    mocks.where.mockResolvedValue(playerQuery("pAdam", { isAdmin: false }));
    mocks.getUser.mockResolvedValue({ customClaims: { other: 1 } });
    const request = req();
    const r = await requirePlayer(request, "fn", limits);

    expect(r.playerId).toBe("pAdam");
    expect(mocks.where).toHaveBeenCalledWith("authUid", "==", request.auth!.uid);
    // Other claims are preserved.
    expect(mocks.setCustomUserClaims).toHaveBeenCalledWith(request.auth!.uid, { other: 1, playerId: "pAdam" });
    await expect(r.isAdmin()).resolves.toBe(false);
    expect(mocks.docGet).not.toHaveBeenCalled(); // already known from the query
  });

  it("a failed backfill doesn't fail the call", async () => {
    mocks.where.mockResolvedValue(playerQuery("pAdam", { isAdmin: true }));
    mocks.setCustomUserClaims.mockRejectedValue(new Error("auth down"));
    const r = await requirePlayer(req(), "fn", limits);
    expect(r.playerId).toBe("pAdam");
    await expect(r.isAdmin()).resolves.toBe(true);
  });

  it("rejects an account with no linked player", async () => {
    mocks.where.mockResolvedValue({ empty: true, docs: [] });
    await expect(requirePlayer(req(), "fn", limits)).rejects.toMatchObject({ code: "permission-denied" });
    expect(mocks.setCustomUserClaims).not.toHaveBeenCalled();
  });

  it("ignores an empty or non-string claim", async () => {
    mocks.where.mockResolvedValue(playerQuery("pAdam", {}));
    expect((await requirePlayer(req({ playerId: "" }), "fn", limits)).playerId).toBe("pAdam");
    expect((await requirePlayer(req({ playerId: 42 }), "fn", limits)).playerId).toBe("pAdam");
  });

  it("rejects an unauthenticated call", async () => {
    await expect(requirePlayer({} as CallableRequest, "fn", limits)).rejects.toMatchObject({ code: "unauthenticated" });
  });
});

describe("setPlayerIdClaim", () => {
  it("is a no-op when the claim already matches", async () => {
    mocks.getUser.mockResolvedValue({ customClaims: { playerId: "p1" } });
    await setPlayerIdClaim("u", "p1");
    expect(mocks.setCustomUserClaims).not.toHaveBeenCalled();
  });

  it("removes only the playerId claim, and clears claims entirely when none remain", async () => {
    mocks.getUser.mockResolvedValue({ customClaims: { playerId: "p1", other: true } });
    await setPlayerIdClaim("u", null);
    expect(mocks.setCustomUserClaims).toHaveBeenLastCalledWith("u", { other: true });

    mocks.getUser.mockResolvedValue({ customClaims: { playerId: "p1" } });
    await setPlayerIdClaim("u", null);
    expect(mocks.setCustomUserClaims).toHaveBeenLastCalledWith("u", null);
  });

  it("removing a claim that isn't there is a no-op", async () => {
    mocks.getUser.mockResolvedValue({ customClaims: {} });
    await setPlayerIdClaim("u", null);
    expect(mocks.setCustomUserClaims).not.toHaveBeenCalled();
  });
});
