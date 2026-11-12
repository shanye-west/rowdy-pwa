import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";

function setup(setAppBadge = vi.fn().mockResolvedValue(undefined)) {
  const handlers: Record<string, (event: unknown) => void> = {};
  const showNotification = vi.fn().mockResolvedValue(undefined);
  runInNewContext(readFileSync(new URL("../public/firebase-messaging-sw.js", import.meta.url), "utf8"), {
    self: { navigator: { setAppBadge }, registration: { showNotification },
      addEventListener: (name: string, handler: (event: unknown) => void) => { handlers[name] = handler; } },
  });
  const push = (category = "chat") => {
    let completion!: Promise<unknown>;
    handlers.push({ data: { json: () => ({ data: { category, title: "Hello" } }) }, waitUntil: (p: Promise<unknown>) => { completion = p; } });
    return completion;
  };
  return { push, setAppBadge, showNotification };
}
it("badges incoming notifications and waits for display", async () => {
  const s = setup();
  let finish!: () => void;
  s.showNotification.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
  let done = false;
  const completion = s.push().then(() => { done = true; });
  await Promise.resolve();
  expect(done).toBe(false);
  expect(s.setAppBadge).toHaveBeenCalled();
  finish(); await completion;
  expect(done).toBe(true);
});
it("still displays a notification if badging fails", async () => {
  const s = setup(vi.fn().mockRejectedValue(new Error("unsupported")));
  await s.push(); expect(s.showNotification).toHaveBeenCalled();
});
it("does not badge diagnostic pushes", async () => {
  const s = setup(); await s.push("test"); expect(s.setAppBadge).not.toHaveBeenCalled();
});
