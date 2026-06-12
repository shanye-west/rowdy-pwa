import { describe, expect, it } from "vitest";
import { rosterPlayerIds, tierPlayerIds } from "./roster";
import type { TournamentDoc } from "../types";

describe("tierPlayerIds", () => {
  it("flattens tiers in A-D order", () => {
    expect(
      tierPlayerIds({ A: ["p1"], B: ["p2", "p3"], D: ["p4"] })
    ).toEqual(["p1", "p2", "p3", "p4"]);
  });

  it("handles undefined roster", () => {
    expect(tierPlayerIds(undefined)).toEqual([]);
  });
});

describe("rosterPlayerIds", () => {
  const tournament = {
    teamA: { id: "a", name: "A", rosterByTier: { A: ["p1"], C: ["p2"] } },
    teamB: { id: "b", name: "B", rosterByTier: { B: ["p3"] } },
  } as Pick<TournamentDoc, "teamA" | "teamB">;

  it("combines both teams, team A first", () => {
    expect(rosterPlayerIds(tournament)).toEqual(["p1", "p2", "p3"]);
  });

  it("handles null tournament and missing rosters", () => {
    expect(rosterPlayerIds(null)).toEqual([]);
    expect(
      rosterPlayerIds({ teamA: { id: "a", name: "A" }, teamB: { id: "b", name: "B" } } as Pick<TournamentDoc, "teamA" | "teamB">)
    ).toEqual([]);
  });
});
