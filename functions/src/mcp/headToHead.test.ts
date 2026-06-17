import { describe, it, expect } from "vitest";
import { tallyHeadToHead } from "./tools/headToHead.js";
import type { PlayerMatchFact } from "./types.js";

function fact(partial: Partial<PlayerMatchFact>): PlayerMatchFact {
  return { playerId: "pA", ...partial };
}

describe("tallyHeadToHead", () => {
  it("tallies wins/losses/halves and points overall and by format", () => {
    const facts: PlayerMatchFact[] = [
      fact({ format: "singles", outcome: "win", pointsEarned: 1 }),
      fact({ format: "singles", outcome: "loss", pointsEarned: 0 }),
      fact({ format: "twoManBestBall", outcome: "halve", pointsEarned: 0.5 }),
      fact({ format: "twoManBestBall", outcome: "win", pointsEarned: 1 }),
    ];

    const { overall, byFormat } = tallyHeadToHead(facts);

    expect(overall).toEqual({ wins: 2, losses: 1, halves: 1, points: 2.5 });
    expect(byFormat.singles).toEqual({ wins: 1, losses: 1, halves: 0, points: 1 });
    expect(byFormat.twoManBestBall).toEqual({ wins: 1, losses: 0, halves: 1, points: 1.5 });
  });

  it("returns empty totals for no matches", () => {
    const { overall, byFormat } = tallyHeadToHead([]);
    expect(overall).toEqual({ wins: 0, losses: 0, halves: 0, points: 0 });
    expect(byFormat).toEqual({});
  });

  it("buckets facts with no format under 'unknown'", () => {
    const { byFormat } = tallyHeadToHead([fact({ outcome: "win", pointsEarned: 1 })]);
    expect(byFormat.unknown).toEqual({ wins: 1, losses: 0, halves: 0, points: 1 });
  });
});
