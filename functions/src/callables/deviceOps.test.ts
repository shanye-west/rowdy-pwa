import { beforeEach, expect, it, vi } from "vitest";
import type { CallableRequest } from "firebase-functions/v2/https";
const mocks = vi.hoisted(() => ({ admin: vi.fn(), player: vi.fn(), collection: vi.fn(), doc: vi.fn(), get: vi.fn(), set: vi.fn() }));
vi.mock("../helpers/adminAuth.js", () => ({ requireAdmin: mocks.admin, requirePlayer: mocks.player }));
vi.mock("firebase-admin/firestore", () => ({ getFirestore: () => ({ collection: mocks.collection }), FieldValue: { serverTimestamp: () => "server-time" } }));
import { reportDevice, getDeviceDashboard } from "./deviceOps.js";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.player.mockResolvedValue({ playerId: "self" });
  mocks.collection.mockReturnValue({ doc: mocks.doc });
  mocks.doc.mockReturnValue({ get: mocks.get, set: mocks.set });
});
it("denies dashboard access before reading private reports", async () => {
  mocks.admin.mockRejectedValue(new Error("Admin required"));
  await expect(getDeviceDashboard.run({ data: {} } as CallableRequest)).rejects.toThrow("Admin required");
  expect(mocks.collection).not.toHaveBeenCalled();
});
it("binds reports to caller and rejects a different player's token", async () => {
  mocks.get.mockResolvedValue({ exists: true, data: () => ({ playerId: "other" }) });
  await reportDevice.run({ data: { playerId: "other", deviceId: "abcdefghij", platform: "Android", mode: "Browser", permission: "granted", token: "other-token" } } as CallableRequest);
  expect(mocks.doc).toHaveBeenCalledWith("self__abcdefghij");
  expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({ playerId: "self", registered: false }));
});
it("rejects invalid report fields without writing", async () => {
  await expect(reportDevice.run({ data: { deviceId: "abcdefghij", platform: "invented" } } as CallableRequest)).rejects.toThrow("Invalid device status");
  expect(mocks.set).not.toHaveBeenCalled();
});
