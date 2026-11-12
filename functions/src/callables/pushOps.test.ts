import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CallableRequest } from "firebase-functions/v2/https";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(), get: vi.fn(), where: vi.fn(), collection: vi.fn(), send: vi.fn(),
}));
vi.mock("../helpers/adminAuth.js", () => ({ requireAdmin: mocks.requireAdmin, requirePlayer: vi.fn() }));
vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({ collection: mocks.collection }), FieldValue: {},
}));
vi.mock("firebase-admin/messaging", () => ({ getMessaging: () => ({ sendEachForMulticast: mocks.send }) }));
import { sendTestPush } from "./pushOps.js";

const request = { data: { playerId: "someone-else", tokens: ["other-token"] } } as CallableRequest;

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  mocks.requireAdmin.mockResolvedValue({ playerId: "admin-self" });
  mocks.collection.mockReturnValue({ where: mocks.where });
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
  await expect(result).resolves.toEqual({ accepted: 1, failed: 0, errors: [] });
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
  await expect(result).resolves.toEqual({ accepted: 0, failed: 1, errors: ["messaging/registration-token-not-registered"] });
});
