import { afterEach, expect, it, vi } from "vitest";
import { syncAppBadge } from "../src/utils/appBadge";
afterEach(() => vi.unstubAllGlobals());
it("sets unread and clears read badges", async () => {
  const setAppBadge = vi.fn(), clearAppBadge = vi.fn();
  vi.stubGlobal("navigator", { setAppBadge, clearAppBadge });
  await syncAppBadge(true); await syncAppBadge(false);
  expect(setAppBadge).toHaveBeenCalledTimes(1); expect(clearAppBadge).toHaveBeenCalledTimes(1);
});
it("tolerates unsupported browsers and rejected calls", async () => {
  vi.stubGlobal("navigator", {}); await syncAppBadge(true); await syncAppBadge(false);
  vi.stubGlobal("navigator", { setAppBadge: vi.fn().mockRejectedValue(new Error("denied")) });
  await expect(syncAppBadge(true)).resolves.toBeUndefined();
});
