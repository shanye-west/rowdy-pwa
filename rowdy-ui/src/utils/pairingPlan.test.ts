import { describe, expect, it } from "vitest";
import {
  cannotAddToSide,
  completeMatchupCount,
  emptyMatchups,
  matchupsEqual,
  normalizeMatchups,
  planStrandWarning,
  sideViolation,
  unassignedIds,
} from "./pairingPlan";
import type { PlannedMatchup } from "../types";

// a*/d* are A- and D-tier; b*/c* are the safe middle. Team A ids are a1/b1/…,
// team B ids are x-prefixed, so a cross-team mix-up would be obvious.
const TIERS: Record<string, "A" | "B" | "C" | "D"> = {
  a1: "A",
  a2: "A",
  b1: "B",
  b2: "B",
  c1: "C",
  d1: "D",
  d2: "D",
  xa1: "A",
  xb1: "B",
  xc1: "C",
  xd1: "D",
};

const m = (teamA: string[], teamB: string[]): PlannedMatchup => ({ teamA, teamB });

describe("emptyMatchups", () => {
  it("builds the right number of two-sided slots", () => {
    expect(emptyMatchups(2)).toEqual([m([], []), m([], [])]);
  });
});

describe("normalizeMatchups", () => {
  it("pads out to the round's matchup count", () => {
    expect(normalizeMatchups([m(["a1", "b1"], ["xa1", "xb1"])], 2, 2)).toEqual([
      m(["a1", "b1"], ["xa1", "xb1"]),
      m([], []),
    ]);
  });

  it("drops matchups beyond the round's count", () => {
    expect(normalizeMatchups([m(["a1"], []), m(["b1"], [])], 1, 2)).toEqual([m(["a1"], [])]);
  });

  it("trims a side that holds more than players-per-side", () => {
    expect(normalizeMatchups([m(["a1", "b1", "c1"], [])], 1, 2)).toEqual([m(["a1", "b1"], [])]);
  });

  it("drops a player repeated on the same team, per side independently", () => {
    const input = [m(["a1"], ["xa1"]), m(["a1", "b1"], ["xa1", "xb1"])];
    expect(normalizeMatchups(input, 2, 2)).toEqual([m(["a1"], ["xa1"]), m(["b1"], ["xb1"])]);
  });

  it("drops players no longer available on their own side", () => {
    const allowed = { teamA: new Set(["a1"]), teamB: new Set(["xb1"]) };
    expect(normalizeMatchups([m(["a1", "b1"], ["xa1", "xb1"])], 1, 2, allowed)).toEqual([
      m(["a1"], ["xb1"]),
    ]);
  });

  it("handles a plan saved with a missing side", () => {
    const input = [{ teamA: ["a1"] } as unknown as PlannedMatchup];
    expect(normalizeMatchups(input, 1, 2)).toEqual([m(["a1"], [])]);
  });
});

describe("unassignedIds", () => {
  it("only counts placements on the team asked about", () => {
    const board = [m(["a1"], ["xa1"])];
    expect(unassignedIds(["a1", "b1"], board, "teamA")).toEqual(["b1"]);
    expect(unassignedIds(["xa1", "xb1"], board, "teamB")).toEqual(["xb1"]);
  });
});

describe("sideViolation", () => {
  it("flags two A-tier and two D-tier", () => {
    expect(sideViolation(["a1", "a2"], 2, TIERS)).toMatch(/A-tier/);
    expect(sideViolation(["d1", "d2"], 2, TIERS)).toMatch(/D-tier/);
  });

  it("allows a legal pair and stays quiet on a half-filled side", () => {
    expect(sideViolation(["a1", "d1"], 2, TIERS)).toBeNull();
    expect(sideViolation(["a1"], 2, TIERS)).toBeNull();
  });

  it("never fires for singles", () => {
    expect(sideViolation(["a1"], 1, TIERS)).toBeNull();
  });
});

describe("cannotAddToSide", () => {
  it("blocks a second A-tier and a second D-tier", () => {
    expect(cannotAddToSide(["a1"], "a2", 2, TIERS)).toMatch(/A-tier/);
    expect(cannotAddToSide(["d1"], "d2", 2, TIERS)).toMatch(/D-tier/);
  });

  it("allows a legal partner", () => {
    expect(cannotAddToSide(["a1"], "b1", 2, TIERS)).toBeNull();
    expect(cannotAddToSide(["a1"], "d1", 2, TIERS)).toBeNull();
  });

  it("blocks anything once the side is full", () => {
    expect(cannotAddToSide(["b1", "c1"], "a1", 2, TIERS)).toBe("That side is full");
  });

  it("applies to the opponent's side the same way", () => {
    expect(cannotAddToSide(["xa1"], "a2", 2, { ...TIERS, a2: "A" })).toMatch(/A-tier/);
  });
});

describe("planStrandWarning", () => {
  it("warns when a team's leftovers can't fill its open sides legally", () => {
    // Two open teamA sides, three A-tier left — one pair would have to be A/A.
    const board = [m(["b1", "c1"], []), m([], []), m([], [])];
    const tiers = { ...TIERS, b2: "A" as const };
    expect(planStrandWarning(board, ["b1", "c1", "a1", "a2", "b2", "d1"], "teamA", 2, tiers)).toMatch(
      /A-tier/
    );
  });

  it("judges each team independently", () => {
    const board = [m([], []), m([], [])];
    const available = ["a1", "a2", "b1", "b2"];
    expect(planStrandWarning(board, available, "teamA", 2, TIERS)).toBeNull();
  });

  it("stays quiet once everyone is placed, and for singles", () => {
    const board = [m(["a1", "b1"], []), m(["a2", "c1"], [])];
    expect(planStrandWarning(board, ["a1", "b1", "a2", "c1"], "teamA", 2, TIERS)).toBeNull();
    expect(planStrandWarning([m([], [])], ["a1", "a2"], "teamA", 1, TIERS)).toBeNull();
  });
});

describe("matchupsEqual", () => {
  it("ignores order within a side", () => {
    expect(matchupsEqual([m(["a1", "b1"], [])], [m(["b1", "a1"], [])])).toBe(true);
  });

  it("is sensitive to which matchup and which side a player sits in", () => {
    expect(matchupsEqual([m(["a1"], []), m(["b1"], [])], [m(["b1"], []), m(["a1"], [])])).toBe(false);
    expect(matchupsEqual([m(["a1"], [])], [m([], ["a1"])])).toBe(false);
  });

  it("catches added, removed and extra matchups", () => {
    expect(matchupsEqual([m(["a1", "b1"], [])], [m(["a1"], [])])).toBe(false);
    expect(matchupsEqual([m([], [])], [m([], []), m([], [])])).toBe(false);
  });
});

describe("completeMatchupCount", () => {
  it("counts only matchups with BOTH sides full", () => {
    const board = [m(["a1", "b1"], ["xa1", "xb1"]), m(["a2", "c1"], ["xc1"]), m([], [])];
    expect(completeMatchupCount(board, 2)).toBe(1);
  });
});
