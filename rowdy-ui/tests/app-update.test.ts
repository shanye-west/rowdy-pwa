import { afterEach, expect, it, vi } from "vitest";
vi.mock("react", () => ({ useSyncExternalStore: (_subscribe: unknown, snapshot: () => boolean) => snapshot() }));
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
it("hides the banner for the current build even after activation repeats", async () => {
  vi.stubGlobal("__BUILD_TIME__", "current");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ buildTime: "current" }) }));
  const update = await import("../src/hooks/useAppUpdate");
  await update.markAppUpdateAvailable(); await update.markAppUpdateAvailable();
  expect(update.useAppUpdate()).toBe(false);
});
it("shows only a different deployed build and clears stale state", async () => {
  vi.stubGlobal("__BUILD_TIME__", "current");
  const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ buildTime: "next" }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ buildTime: "current" }) });
  vi.stubGlobal("fetch", fetch);
  const update = await import("../src/hooks/useAppUpdate");
  await update.markAppUpdateAvailable(); expect(update.useAppUpdate()).toBe(true);
  await update.markAppUpdateAvailable(); expect(update.useAppUpdate()).toBe(false);
});
it("does not show an update for a failed version check", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  const update = await import("../src/hooks/useAppUpdate");
  await update.markAppUpdateAvailable(); expect(update.useAppUpdate()).toBe(false);
});
