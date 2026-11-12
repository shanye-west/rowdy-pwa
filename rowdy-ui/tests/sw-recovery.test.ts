import { afterEach, expect, it, vi } from "vitest";
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
async function setup(stored: string | null = null, offline = false, brokenStorage = false) {
  vi.stubGlobal("__BUILD_TIME__", "test-build");
  const reload = vi.fn();
  const setItem = vi.fn();
  vi.stubGlobal("window", { location: { reload } });
  vi.stubGlobal("navigator", { onLine: !offline });
  vi.stubGlobal("sessionStorage", { getItem: () => { if (brokenStorage) throw new Error("denied"); return stored; }, setItem });
  const { recoverFromStaleChunk } = await import("../src/utils/swRecovery");
  return { recoverFromStaleChunk, reload, setItem };
}
it("coalesces simultaneous recovery handlers into one reload", async () => {
  const s = await setup();
  s.recoverFromStaleChunk(); s.recoverFromStaleChunk();
  expect(s.reload).toHaveBeenCalledTimes(1);
  expect(s.setItem).toHaveBeenCalledWith("rowdy:auto-recovery-build", "test-build");
});
it("does not reload again after a previous recovery for this build", async () => {
  const s = await setup("test-build"); s.recoverFromStaleChunk(); expect(s.reload).not.toHaveBeenCalled();
});
it("does not reload offline", async () => {
  const s = await setup(null, true); s.recoverFromStaleChunk(); expect(s.reload).not.toHaveBeenCalled();
});
it("does not reload if a persistent loop guard cannot be saved", async () => {
  const s = await setup(null, false, true); s.recoverFromStaleChunk(); expect(s.reload).not.toHaveBeenCalled();
});
