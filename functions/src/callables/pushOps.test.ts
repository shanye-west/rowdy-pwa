import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CallableRequest } from "firebase-functions/v2/https";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(), get: vi.fn(), where: vi.fn(), collection: vi.fn(), send: vi.fn(),
  doc: vi.fn(), batchDelete: vi.fn(), batchCommit: vi.fn(),
  requirePlayer: vi.fn(), dryRun: vi.fn(), docSet: vi.fn(), docDelete: vi.fn(),
}));
vi.mock("../helpers/adminAuth.js", () => ({ requireAdmin: mocks.requireAdmin, requirePlayer: mocks.requirePlayer }));
vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({
    collection: mocks.collection,
    batch: () => ({ delete: mocks.batchDelete, commit: mocks.batchCommit }),
  }),
  FieldValue: { serverTimestamp: () => "ts" },
}));
vi.mock("firebase-admin/messaging", () => ({ getMessaging: () => ({ sendEachForMulticast: mocks.send, send: mocks.dryRun }) }));
import { registerPushToken, sendTestPush } from "./pushOps.js";

const request = { data: { playerId: "someone-else", tokens: ["other-token"] } } as CallableRequest;

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  mocks.requireAdmin.mockResolvedValue({ playerId: "admin-self" });
  mocks.collection.mockReturnValue({ where: mocks.where, doc: mocks.doc });
  mocks.doc.mockImplementation((id: string) => ({ id, set: mocks.docSet, delete: mocks.docDelete }));
  mocks.requirePlayer.mockResolvedValue({ playerId: "p1" });
  mocks.where.mockReturnValue({ get: mocks.get });
  mocks.get.mockResolvedValue({ docs: [{ data: () => ({ token: "own-token" }) }] });
  mocks.send.mockResolvedValue({ successCount: 1, responses: [{ success: true }] });
});
afterEach(() => vi.useRealTimers());

it("rejects non-admins before reading tokens or sending", async () => {
  mocks.requireAdmin.mockRejectedValue(new Error("Admin access required"));
  await expect(sendTestPush.run(request)).rejects.toThrow("Admin access required");
  expect(mocks.collection).not.toHaveBeenCalled();
  expect(mocks.send).not.toHaveBeenCalled();
});

it("ignores supplied recipients and sends only to the authenticated admin after the delay", async () => {
  const result = sendTestPush.run(request);
  await vi.advanceTimersByTimeAsync(9_999);
  expect(mocks.send).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await expect(result).resolves.toEqual({ accepted: 1, failed: 0, errors: [], pruned: 0 });
  expect(mocks.batchCommit).not.toHaveBeenCalled();
  expect(mocks.where).toHaveBeenCalledWith("playerId", "==", "admin-self");
  expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ tokens: ["own-token"] }));
});

it("reports missing registration instead of claiming success", async () => {
  mocks.get.mockResolvedValue({ docs: [] });
  const assertion = expect(sendTestPush.run(request)).rejects.toThrow("No registered devices");
  await vi.advanceTimersByTimeAsync(10_000);
  await assertion;
  expect(mocks.send).not.toHaveBeenCalled();
});

it("reports FCM failures without claiming delivery", async () => {
  mocks.send.mockResolvedValue({ successCount: 0, responses: [{ success: false, error: { code: "messaging/registration-token-not-registered" } }] });
  const result = sendTestPush.run(request);
  await vi.advanceTimersByTimeAsync(10_000);
  await expect(result).resolves.toEqual({ accepted: 0, failed: 1, errors: ["messaging/registration-token-not-registered"], pruned: 1 });
  expect(mocks.batchDelete).toHaveBeenCalledWith(expect.objectContaining({ id: "own-token" }));
  expect(mocks.batchCommit).toHaveBeenCalledTimes(1);
});

const registerRequest = { data: { token: "tok-1", userAgent: "ua" } } as CallableRequest;

it("stores a token FCM accepts on a dry run and reports it valid", async () => {
  mocks.dryRun.mockResolvedValue("ok");
  await expect(registerPushToken.run(registerRequest)).resolves.toEqual({ success: true, valid: true });
  expect(mocks.dryRun).toHaveBeenCalledWith(expect.objectContaining({ token: "tok-1" }), true);
  expect(mocks.docSet).toHaveBeenCalledWith(expect.objectContaining({ token: "tok-1", playerId: "p1" }), { merge: true });
  expect(mocks.docDelete).not.toHaveBeenCalled();
});

it("rejects and deletes a token FCM says is dead so the client re-subscribes", async () => {
  mocks.dryRun.mockRejectedValue({ code: "messaging/registration-token-not-registered" });
  await expect(registerPushToken.run(registerRequest)).resolves.toEqual({ success: true, valid: false });
  expect(mocks.docDelete).toHaveBeenCalledTimes(1);
  expect(mocks.docSet).not.toHaveBeenCalled();
});

it("treats a transient FCM error as alive rather than churning a working device", async () => {
  mocks.dryRun.mockRejectedValue({ code: "messaging/internal-error" });
  await expect(registerPushToken.run(registerRequest)).resolves.toEqual({ success: true, valid: true });
  expect(mocks.docSet).toHaveBeenCalledTimes(1);
});
