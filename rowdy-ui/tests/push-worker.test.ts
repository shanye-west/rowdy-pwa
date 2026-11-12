import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";

it("keeps background push alive until the notification has been displayed", async () => {
  let finishDisplay!: () => void;
  const displayed = new Promise<void>((resolve) => { finishDisplay = resolve; });
  const showNotification = vi.fn(() => displayed);
  let handleMessage!: (payload: { data: Record<string, string> }) => Promise<void>;
  runInNewContext(
    readFileSync(new URL("../public/firebase-messaging-sw.js", import.meta.url), "utf8"),
    {
      importScripts: vi.fn(),
      firebase: {
        initializeApp: vi.fn(),
        messaging: () => ({
          onBackgroundMessage: (handler: typeof handleMessage) => { handleMessage = handler; },
        }),
      },
      self: { registration: { showNotification }, addEventListener: vi.fn() },
      console,
    },
  );
  const completion = handleMessage({ data: { title: "Match final", body: "2 & 1", link: "/match/test" } });
  expect(completion).toBe(displayed);
  expect(showNotification).toHaveBeenCalledWith("Match final", expect.objectContaining({
    body: "2 & 1", data: { link: "/match/test" },
  }));
  finishDisplay();
  await completion;
});
