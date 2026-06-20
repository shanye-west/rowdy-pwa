import { describe, it, expect } from "vitest";
import { resolveCommentRecipients, tokensToPrune } from "./notify.js";

describe("resolveCommentRecipients", () => {
  it("sportsbook feed: notifies the whole tournament roster except the author", () => {
    const recipients = resolveCommentRecipients(
      "sportsbook",
      "pShane",
      ["pIgnoredMatchPlayer"], // match list is irrelevant for the feed
      ["pShane", "pGary", "pAustin"]
    );
    expect(recipients.sort()).toEqual(["pAustin", "pGary"]);
  });

  it("match thread: notifies only that match's players except the author", () => {
    const recipients = resolveCommentRecipients(
      "match",
      "pShane",
      ["pShane", "pGary"],
      ["pShane", "pGary", "pAustin", "pEveryoneElse"] // tournament list ignored for a match thread
    );
    expect(recipients).toEqual(["pGary"]);
  });

  it("dedupes and drops empty ids", () => {
    const recipients = resolveCommentRecipients(
      "sportsbook",
      "pShane",
      [],
      ["pGary", "pGary", "", "pAustin", "pShane"]
    );
    expect(recipients.sort()).toEqual(["pAustin", "pGary"]);
  });

  it("returns empty when the author is the only participant", () => {
    expect(resolveCommentRecipients("match", "pShane", ["pShane"], [])).toEqual([]);
  });
});

describe("tokensToPrune", () => {
  it("flags tokens FCM reports as permanently dead", () => {
    const tokens = ["good", "gone", "stillGood", "bad"];
    const responses = [
      { success: true },
      { success: false, error: { code: "messaging/registration-token-not-registered" } },
      { success: true },
      { success: false, error: { code: "messaging/invalid-argument" } },
    ];
    expect(tokensToPrune(responses, tokens)).toEqual(["gone", "bad"]);
  });

  it("keeps tokens that failed for transient reasons", () => {
    const tokens = ["a", "b"];
    const responses = [
      { success: false, error: { code: "messaging/internal-error" } },
      { success: false, error: { code: "messaging/server-unavailable" } },
    ];
    expect(tokensToPrune(responses, tokens)).toEqual([]);
  });

  it("returns nothing when all sends succeed", () => {
    expect(tokensToPrune([{ success: true }, { success: true }], ["a", "b"])).toEqual([]);
  });
});
