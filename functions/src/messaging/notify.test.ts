import { describe, it, expect } from "vitest";
import {
  resolveCommentRecipients,
  tokensToPrune,
  filterByPref,
  isCategoryEnabled,
  DEFAULT_NOTIFICATION_PREFS,
  type NotificationPrefs,
} from "./notify.js";

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

describe("isCategoryEnabled", () => {
  it("uses the per-category default when there is no explicit pref", () => {
    // Opt-out: chat/sportsbook/matchResult/tournament default on; matchLeadChange off.
    expect(isCategoryEnabled(undefined, "chat")).toBe(true);
    expect(isCategoryEnabled(undefined, "matchResult")).toBe(true);
    expect(isCategoryEnabled(undefined, "tournament")).toBe(true);
    expect(isCategoryEnabled(undefined, "matchLeadChange")).toBe(false);
    expect(isCategoryEnabled({}, "chat")).toBe(true);
    expect(isCategoryEnabled({ sportsbook: true }, "matchLeadChange")).toBe(false);
  });

  it("respects an explicit boolean either way", () => {
    expect(isCategoryEnabled({ chat: false }, "chat")).toBe(false);
    expect(isCategoryEnabled({ matchLeadChange: true }, "matchLeadChange")).toBe(true);
  });

  it("default map matches the documented opt-out policy", () => {
    expect(DEFAULT_NOTIFICATION_PREFS).toEqual({
      chat: true,
      sportsbook: true,
      matchResult: true,
      matchLeadChange: false,
      tournament: true,
    });
  });
});

describe("filterByPref", () => {
  const prefs = new Map<string, NotificationPrefs | undefined>([
    ["pOptedOut", { matchResult: false }],
    ["pOptedIn", { matchLeadChange: true }],
    ["pEmpty", {}],
    // pMissing intentionally absent from the map (no player doc / no prefs).
  ]);

  it("drops players who explicitly disabled the category", () => {
    expect(filterByPref(["pOptedOut", "pEmpty", "pMissing"], prefs, "matchResult")).toEqual([
      "pEmpty",
      "pMissing",
    ]);
  });

  it("keeps default-off categories only for players who opted in", () => {
    expect(filterByPref(["pOptedIn", "pEmpty", "pMissing"], prefs, "matchLeadChange")).toEqual([
      "pOptedIn",
    ]);
  });

  it("keeps everyone for a default-on category nobody disabled", () => {
    expect(filterByPref(["pOptedOut", "pOptedIn", "pMissing"], prefs, "tournament")).toEqual([
      "pOptedOut",
      "pOptedIn",
      "pMissing",
    ]);
  });
});
