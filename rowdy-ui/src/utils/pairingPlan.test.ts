import { describe, expect, it } from "vitest";
import {
  cannotAddToSlot,
  normalizePairs,
  pairsEqual,
  planStrandWarning,
  slotViolation,
  unassignedIds,
} from "./pairingPlan";

// a1/a2 = A-tier, b1… = B-tier, d1/d2 = D-tier.
const TIERS: Record<string, "A" | "B" | "C" | "D"> = {
  a1: "A",
  a2: "A",
  b1: "B",
  b2: "B",
  c1: "C",
  c2: "C",
  d1: "D",
  d2: "D",
};

describe("normalizePairs", () => {
  it("pads out to the round's slot count", () => {
    expect(normalizePairs([["a1", "b1"]], 3, 2)).toEqual([["a1", "b1"], [], []]);
  });

  it("drops slots beyond the round's slot count", () => {
    expect(normalizePairs([["a1", "b1"], ["c1", "d1"]], 1, 2)).toEqual([["a1", "b1"]]);
  });

  it("trims a slot that holds more than players-per-side", () => {
    expect(normalizePairs([["a1", "b1", "c1"]], 1, 2)).toEqual([["a1", "b1"]]);
  });

  it("drops a player who somehow appears in two slots", () => {
    expect(normalizePairs([["a1", "b1"], ["a1", "c1"]], 2, 2)).toEqual([["a1", "b1"], ["c1"]]);
  });

  it("drops players who are no longer available (benched since the last save)", () => {
    const allowed = new Set(["a1", "c1"]);
    expect(normalizePairs([["a1", "b1"], ["c1"]], 2, 2, allowed)).toEqual([["a1"], ["c1"]]);
  });
});

describe("unassignedIds", () => {
  it("returns available players not placed in a slot, in order", () => {
    expect(unassignedIds(["a1", "b1", "c1", "d1"], [["b1"], ["d1"]])).toEqual(["a1", "c1"]);
  });
});

describe("slotViolation", () => {
  it("flags two A-tier and two D-tier", () => {
    expect(slotViolation(["a1", "a2"], 2, TIERS)).toMatch(/A-tier/);
    expect(slotViolation(["d1", "d2"], 2, TIERS)).toMatch(/D-tier/);
  });

  it("allows a legal pair", () => {
    expect(slotViolation(["a1", "d1"], 2, TIERS)).toBeNull();
    expect(slotViolation(["b1", "c1"], 2, TIERS)).toBeNull();
  });

  it("stays quiet on a half-filled slot", () => {
    expect(slotViolation(["a1"], 2, TIERS)).toBeNull();
  });

  it("never fires for singles", () => {
    expect(slotViolation(["a1"], 1, TIERS)).toBeNull();
  });
});

describe("cannotAddToSlot", () => {
  it("blocks a second A-tier and a second D-tier", () => {
    expect(cannotAddToSlot(["a1"], "a2", 2, TIERS)).toMatch(/A-tier/);
    expect(cannotAddToSlot(["d1"], "d2", 2, TIERS)).toMatch(/D-tier/);
  });

  it("allows a legal partner", () => {
    expect(cannotAddToSlot(["a1"], "b1", 2, TIERS)).toBeNull();
    expect(cannotAddToSlot(["a1"], "d1", 2, TIERS)).toBeNull();
  });

  it("blocks anything once the slot is full", () => {
    expect(cannotAddToSlot(["b1", "c1"], "a1", 2, TIERS)).toBe("That matchup is full");
  });

  it("only applies the tier rule to two-player sides", () => {
    expect(cannotAddToSlot([], "a2", 1, TIERS)).toBeNull();
  });
});

describe("planStrandWarning", () => {
  it("warns when the leftovers can't fill the open slots legally", () => {
    // Two open slots, but three A-tier left — one pair would have to be A/A.
    const pairs = [["b1", "c1"], [], []];
    const available = ["b1", "c1", "a1", "a2", "b2", "c2"];
    const tiers = { ...TIERS, b2: "A" as const };
    expect(planStrandWarning(pairs, available, 2, tiers)).toMatch(/can't be paired legally/);
  });

  it("stays quiet on a workable remainder", () => {
    const pairs = [["a1", "b1"], []];
    expect(planStrandWarning(pairs, ["a1", "b1", "a2", "c1"], 2, TIERS)).toBeNull();
  });

  it("stays quiet once everyone is placed", () => {
    const pairs = [["a1", "b1"], ["a2", "c1"]];
    expect(planStrandWarning(pairs, ["a1", "b1", "a2", "c1"], 2, TIERS)).toBeNull();
  });

  it("never fires for singles", () => {
    expect(planStrandWarning([[], []], ["a1", "a2"], 1, TIERS)).toBeNull();
  });
});

describe("pairsEqual", () => {
  it("ignores order within a slot", () => {
    expect(pairsEqual([["a1", "b1"]], [["b1", "a1"]])).toBe(true);
  });

  it("is sensitive to which slot a player sits in", () => {
    expect(pairsEqual([["a1"], ["b1"]], [["b1"], ["a1"]])).toBe(false);
  });

  it("catches added and removed players", () => {
    expect(pairsEqual([["a1", "b1"]], [["a1"]])).toBe(false);
    expect(pairsEqual([[]], [[], []])).toBe(false);
  });
});
