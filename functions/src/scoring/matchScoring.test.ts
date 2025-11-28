/**
 * Unit tests for matchScoring.ts
 */

import { describe, it, expect } from "vitest";
import { holesRange, decideHole, summarize, buildStatusAndResult } from "./matchScoring.js";
import type { MatchData, PlayerInMatch } from "../types.js";

// --- HELPERS ---

/** Creates a basic match with empty holes */
function createMatch(overrides: Partial<MatchData> = {}): MatchData {
  return {
    teamAPlayers: [{ playerId: "a1", strokesReceived: Array(18).fill(0) }],
    teamBPlayers: [{ playerId: "b1", strokesReceived: Array(18).fill(0) }],
    holes: {},
    ...overrides,
  };
}

/** Creates team players for best ball / shamble formats */
function createTwoPlayerTeam(strokesA: number[], strokesB: number[]): PlayerInMatch[] {
  return [
    { playerId: "p1", strokesReceived: strokesA },
    { playerId: "p2", strokesReceived: strokesB },
  ];
}

/** Creates strokes array with 1 at specific hole index (0-based) */
function strokesOnHole(holeIndex: number): number[] {
  const arr = Array(18).fill(0);
  arr[holeIndex] = 1;
  return arr;
}

// --- holesRange tests ---

describe("holesRange", () => {
  it("returns sorted hole numbers from 1-18", () => {
    const holes = { "1": {}, "3": {}, "2": {}, "10": {}, "18": {} };
    expect(holesRange(holes)).toEqual([1, 2, 3, 10, 18]);
  });

  it("ignores non-hole keys", () => {
    const holes = { "1": {}, "input": {}, "status": {}, "19": {}, "0": {} };
    expect(holesRange(holes)).toEqual([1]);
  });

  it("returns empty array for empty object", () => {
    expect(holesRange({})).toEqual([]);
  });

  it("handles all 18 holes", () => {
    const holes: Record<string, object> = {};
    for (let i = 1; i <= 18; i++) holes[String(i)] = {};
    expect(holesRange(holes)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
  });

  it("handles out-of-order hole entry", () => {
    const holes = { "5": {}, "1": {}, "3": {}, "2": {}, "4": {} };
    expect(holesRange(holes)).toEqual([1, 2, 3, 4, 5]);
  });

  it("ignores string keys like '01' or '1.0'", () => {
    const holes = { "1": {}, "01": {}, "1.0": {}, "1.5": {} };
    expect(holesRange(holes)).toEqual([1]);
  });
});

// --- decideHole tests ---

describe("decideHole", () => {
  describe("twoManScramble format", () => {
    it("returns teamA when team A has lower gross", () => {
      const match = createMatch({
        holes: { "1": { input: { teamAGross: 4, teamBGross: 5 } } },
      });
      expect(decideHole("twoManScramble", 1, match)).toBe("teamA");
    });

    it("returns teamB when team B has lower gross", () => {
      const match = createMatch({
        holes: { "1": { input: { teamAGross: 5, teamBGross: 4 } } },
      });
      expect(decideHole("twoManScramble", 1, match)).toBe("teamB");
    });

    it("returns AS when scores are equal", () => {
      const match = createMatch({
        holes: { "1": { input: { teamAGross: 4, teamBGross: 4 } } },
      });
      expect(decideHole("twoManScramble", 1, match)).toBe("AS");
    });

    it("returns null when score is missing", () => {
      const match = createMatch({
        holes: { "1": { input: { teamAGross: 4 } } },
      });
      expect(decideHole("twoManScramble", 1, match)).toBeNull();
    });
  });

  describe("singles format", () => {
    it("returns teamA when team A player has lower net", () => {
      const match = createMatch({
        holes: { "1": { input: { teamAPlayerGross: 4, teamBPlayerGross: 5 } } },
      });
      expect(decideHole("singles", 1, match)).toBe("teamA");
    });

    it("returns teamB when team B player has lower net", () => {
      const match = createMatch({
        holes: { "1": { input: { teamAPlayerGross: 5, teamBPlayerGross: 4 } } },
      });
      expect(decideHole("singles", 1, match)).toBe("teamB");
    });

    it("applies handicap strokes correctly", () => {
      // Team B gets a stroke on hole 1, so gross 5 becomes net 4
      const match = createMatch({
        teamAPlayers: [{ playerId: "a1", strokesReceived: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }],
        teamBPlayers: [{ playerId: "b1", strokesReceived: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }],
        holes: { "1": { input: { teamAPlayerGross: 4, teamBPlayerGross: 5 } } },
      });
      expect(decideHole("singles", 1, match)).toBe("AS"); // 4 vs (5-1=4)
    });

    it("teamA wins when they have stroke and equal gross", () => {
      const match = createMatch({
        teamAPlayers: [{ playerId: "a1", strokesReceived: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }],
        teamBPlayers: [{ playerId: "b1", strokesReceived: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }],
        holes: { "1": { input: { teamAPlayerGross: 5, teamBPlayerGross: 5 } } },
      });
      expect(decideHole("singles", 1, match)).toBe("teamA"); // (5-1=4) vs 5
    });

    it("returns null when score is missing", () => {
      const match = createMatch({
        holes: { "1": { input: { teamAPlayerGross: 4 } } },
      });
      expect(decideHole("singles", 1, match)).toBeNull();
    });
  });

  describe("twoManShamble format", () => {
    it("uses best GROSS (no handicap) for each team", () => {
      const match = createMatch({
        teamAPlayers: createTwoPlayerTeam(Array(18).fill(1), Array(18).fill(1)), // strokes ignored
        teamBPlayers: createTwoPlayerTeam(Array(18).fill(0), Array(18).fill(0)),
        holes: { "1": { input: { teamAPlayersGross: [4, 5], teamBPlayersGross: [5, 6] } } },
      });
      // Team A best gross = 4, Team B best gross = 5
      expect(decideHole("twoManShamble", 1, match)).toBe("teamA");
    });

    it("returns AS when best gross scores are equal", () => {
      const match = createMatch({
        teamAPlayers: createTwoPlayerTeam(Array(18).fill(0), Array(18).fill(0)),
        teamBPlayers: createTwoPlayerTeam(Array(18).fill(0), Array(18).fill(0)),
        holes: { "1": { input: { teamAPlayersGross: [4, 5], teamBPlayersGross: [4, 6] } } },
      });
      expect(decideHole("twoManShamble", 1, match)).toBe("AS"); // 4 vs 4
    });

    it("returns null when any player score is missing", () => {
      const match = createMatch({
        teamAPlayers: createTwoPlayerTeam(Array(18).fill(0), Array(18).fill(0)),
        teamBPlayers: createTwoPlayerTeam(Array(18).fill(0), Array(18).fill(0)),
        holes: { "1": { input: { teamAPlayersGross: [4, null], teamBPlayersGross: [5, 6] } } },
      });
      expect(decideHole("twoManShamble", 1, match)).toBeNull();
    });
  });

  describe("twoManBestBall format", () => {
    it("uses best NET for each team", () => {
      // Player A1 gets stroke on hole 1, Player A2 does not
      // A1: gross 5 - 1 = net 4, A2: gross 4 - 0 = net 4 → best = 4
      // B1: gross 4 - 0 = net 4, B2: gross 5 - 0 = net 5 → best = 4
      const match = createMatch({
        teamAPlayers: createTwoPlayerTeam(
          [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
        ),
        teamBPlayers: createTwoPlayerTeam(
          [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
        ),
        holes: { "1": { input: { teamAPlayersGross: [5, 4], teamBPlayersGross: [4, 5] } } },
      });
      expect(decideHole("twoManBestBall", 1, match)).toBe("AS"); // Both best net = 4
    });

    it("teamA wins when their best NET is lower", () => {
      const match = createMatch({
        teamAPlayers: createTwoPlayerTeam(
          [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // gets stroke
          [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
        ),
        teamBPlayers: createTwoPlayerTeam(
          [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
        ),
        // A1: 4-1=3, A2: 5-0=5 → best 3
        // B1: 4-0=4, B2: 5-0=5 → best 4
        holes: { "1": { input: { teamAPlayersGross: [4, 5], teamBPlayersGross: [4, 5] } } },
      });
      expect(decideHole("twoManBestBall", 1, match)).toBe("teamA");
    });

    it("returns null when any player score is missing", () => {
      const match = createMatch({
        teamAPlayers: createTwoPlayerTeam(Array(18).fill(0), Array(18).fill(0)),
        teamBPlayers: createTwoPlayerTeam(Array(18).fill(0), Array(18).fill(0)),
        holes: { "1": { input: { teamAPlayersGross: [4, 5], teamBPlayersGross: [null, 5] } } },
      });
      expect(decideHole("twoManBestBall", 1, match)).toBeNull();
    });
  });

  describe("edge cases", () => {
    it("handles missing holes object", () => {
      const match = createMatch({ holes: undefined });
      expect(decideHole("singles", 1, match)).toBeNull();
    });

    it("handles missing hole entry", () => {
      const match = createMatch({ holes: {} });
      expect(decideHole("singles", 1, match)).toBeNull();
    });

    it("handles missing input object", () => {
      const match = createMatch({ holes: { "1": {} as any } });
      expect(decideHole("singles", 1, match)).toBeNull();
    });
  });

  describe("valid score of 0 (eagle/hole-in-one)", () => {
    it("treats 0 as valid score in scramble format", () => {
      const match = createMatch({
        holes: { "1": { input: { teamAGross: 0, teamBGross: 2 } } },
      });
      // 0 is a valid score (hole-in-one on par 3)
      expect(decideHole("twoManScramble", 1, match)).toBe("teamA");
    });

    it("treats 0 as valid score in singles format", () => {
      const match = createMatch({
        holes: { "1": { input: { teamAPlayerGross: 0, teamBPlayerGross: 2 } } },
      });
      expect(decideHole("singles", 1, match)).toBe("teamA");
    });

    it("treats 0 as valid score in best ball format", () => {
      const match = createMatch({
        teamAPlayers: createTwoPlayerTeam(Array(18).fill(0), Array(18).fill(0)),
        teamBPlayers: createTwoPlayerTeam(Array(18).fill(0), Array(18).fill(0)),
        holes: { "1": { input: { teamAPlayersGross: [0, 4], teamBPlayersGross: [3, 4] } } },
      });
      expect(decideHole("twoManBestBall", 1, match)).toBe("teamA");
    });
  });

  describe("defensive type handling", () => {
    it("rejects string scores", () => {
      const match = createMatch({
        holes: { "1": { input: { teamAPlayerGross: "4" as any, teamBPlayerGross: 5 } } },
      });
      expect(decideHole("singles", 1, match)).toBeNull();
    });

    it("rejects boolean scores", () => {
      const match = createMatch({
        holes: { "1": { input: { teamAGross: true as any, teamBGross: 4 } } },
      });
      expect(decideHole("twoManScramble", 1, match)).toBeNull();
    });

    it("rejects NaN scores", () => {
      const match = createMatch({
        holes: { "1": { input: { teamAGross: NaN, teamBGross: 4 } } },
      });
      expect(decideHole("twoManScramble", 1, match)).toBeNull();
    });

    it("rejects Infinity scores", () => {
      const match = createMatch({
        holes: { "1": { input: { teamAGross: Infinity, teamBGross: 4 } } },
      });
      expect(decideHole("twoManScramble", 1, match)).toBeNull();
    });

    it("handles negative scores gracefully (calculates result)", () => {
      // Negative scores shouldn't happen but if they do, math still works
      const match = createMatch({
        holes: { "1": { input: { teamAGross: -1, teamBGross: 4 } } },
      });
      expect(decideHole("twoManScramble", 1, match)).toBe("teamA"); // -1 < 4
    });

    it("handles very large scores", () => {
      const match = createMatch({
        holes: { "1": { input: { teamAGross: 99, teamBGross: 100 } } },
      });
      expect(decideHole("twoManScramble", 1, match)).toBe("teamA");
    });
  });

  describe("strokesReceived boundary conditions", () => {
    it("applies stroke on hole 1 (index 0)", () => {
      const match = createMatch({
        teamAPlayers: [{ playerId: "a1", strokesReceived: strokesOnHole(0) }],
        teamBPlayers: [{ playerId: "b1", strokesReceived: Array(18).fill(0) }],
        holes: { "1": { input: { teamAPlayerGross: 5, teamBPlayerGross: 5 } } },
      });
      expect(decideHole("singles", 1, match)).toBe("teamA"); // (5-1=4) vs 5
    });

    it("applies stroke on hole 18 (index 17)", () => {
      const match = createMatch({
        teamAPlayers: [{ playerId: "a1", strokesReceived: strokesOnHole(17) }],
        teamBPlayers: [{ playerId: "b1", strokesReceived: Array(18).fill(0) }],
        holes: { "18": { input: { teamAPlayerGross: 5, teamBPlayerGross: 5 } } },
      });
      expect(decideHole("singles", 18, match)).toBe("teamA"); // (5-1=4) vs 5
    });

    it("handles short strokesReceived array (9 elements)", () => {
      const match = createMatch({
        teamAPlayers: [{ playerId: "a1", strokesReceived: Array(9).fill(1) }], // Only 9 elements
        teamBPlayers: [{ playerId: "b1", strokesReceived: Array(18).fill(0) }],
        holes: { "10": { input: { teamAPlayerGross: 5, teamBPlayerGross: 5 } } },
      });
      // Index 9 doesn't exist in short array, should be treated as 0
      expect(decideHole("singles", 10, match)).toBe("AS"); // 5 vs 5 (no stroke applied)
    });

    it("handles undefined strokesReceived array", () => {
      const match = createMatch({
        teamAPlayers: [{ playerId: "a1", strokesReceived: undefined as any }],
        teamBPlayers: [{ playerId: "b1", strokesReceived: Array(18).fill(0) }],
        holes: { "1": { input: { teamAPlayerGross: 5, teamBPlayerGross: 5 } } },
      });
      expect(decideHole("singles", 1, match)).toBe("AS"); // No stroke, 5 vs 5
    });

    it("handles null strokesReceived array", () => {
      const match = createMatch({
        teamAPlayers: [{ playerId: "a1", strokesReceived: null as any }],
        teamBPlayers: [{ playerId: "b1", strokesReceived: Array(18).fill(0) }],
        holes: { "1": { input: { teamAPlayerGross: 5, teamBPlayerGross: 5 } } },
      });
      expect(decideHole("singles", 1, match)).toBe("AS");
    });

    it("clamps strokesReceived value > 1 to 0", () => {
      // Business rule: max 1 stroke per hole, values > 1 are invalid → treated as 0
      const match = createMatch({
        teamAPlayers: [{ playerId: "a1", strokesReceived: [2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }],
        teamBPlayers: [{ playerId: "b1", strokesReceived: Array(18).fill(0) }],
        holes: { "1": { input: { teamAPlayerGross: 5, teamBPlayerGross: 5 } } },
      });
      expect(decideHole("singles", 1, match)).toBe("AS"); // 2 clamped to 0, so 5 vs 5
    });

    it("clamps negative strokesReceived value to 0", () => {
      const match = createMatch({
        teamAPlayers: [{ playerId: "a1", strokesReceived: [-1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }],
        teamBPlayers: [{ playerId: "b1", strokesReceived: Array(18).fill(0) }],
        holes: { "1": { input: { teamAPlayerGross: 5, teamBPlayerGross: 5 } } },
      });
      expect(decideHole("singles", 1, match)).toBe("AS"); // -1 clamped to 0, so 5 vs 5
    });
  });

  describe("format-specific edge cases", () => {
    it("singles: uses only first player in array", () => {
      const match = createMatch({
        teamAPlayers: [
          { playerId: "a1", strokesReceived: Array(18).fill(0) },
          { playerId: "a2", strokesReceived: Array(18).fill(1) }, // Ignored in singles
        ],
        teamBPlayers: [{ playerId: "b1", strokesReceived: Array(18).fill(0) }],
        holes: { "1": { input: { teamAPlayerGross: 4, teamBPlayerGross: 5 } } },
      });
      expect(decideHole("singles", 1, match)).toBe("teamA");
    });

    it("shamble: ignores strokesReceived entirely", () => {
      // Even with strokes, shamble uses GROSS only
      const match = createMatch({
        teamAPlayers: createTwoPlayerTeam(Array(18).fill(1), Array(18).fill(1)), // All strokes
        teamBPlayers: createTwoPlayerTeam(Array(18).fill(0), Array(18).fill(0)),
        holes: { "1": { input: { teamAPlayersGross: [5, 6], teamBPlayersGross: [5, 6] } } },
      });
      // Best gross = 5 for both teams, strokes ignored
      expect(decideHole("twoManShamble", 1, match)).toBe("AS");
    });

    it("best ball: strokes change which ball is 'best'", () => {
      // Player A1: gross 6, gets stroke → net 5
      // Player A2: gross 5, no stroke → net 5
      // Without strokes, A2's ball would be best (5). With strokes, both tie at net 5.
      const match = createMatch({
        teamAPlayers: createTwoPlayerTeam(
          [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // Player 0 gets stroke
          [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
        ),
        teamBPlayers: createTwoPlayerTeam(
          [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
        ),
        holes: { "1": { input: { teamAPlayersGross: [6, 5], teamBPlayersGross: [6, 6] } } },
      });
      // A best net: min(6-1, 5-0) = min(5, 5) = 5
      // B best net: min(6-0, 6-0) = 6
      expect(decideHole("twoManBestBall", 1, match)).toBe("teamA");
    });

    it("best ball: handles array with 3+ players (uses first 2)", () => {
      const match = createMatch({
        teamAPlayers: createTwoPlayerTeam(Array(18).fill(0), Array(18).fill(0)),
        teamBPlayers: createTwoPlayerTeam(Array(18).fill(0), Array(18).fill(0)),
        holes: { "1": { input: { teamAPlayersGross: [4, 5, 3], teamBPlayersGross: [4, 5] } } },
      });
      // Third player ignored, best is 4 for both
      expect(decideHole("twoManBestBall", 1, match)).toBe("AS");
    });

    it("best ball: returns null with only 1 player score", () => {
      const match = createMatch({
        teamAPlayers: createTwoPlayerTeam(Array(18).fill(0), Array(18).fill(0)),
        teamBPlayers: createTwoPlayerTeam(Array(18).fill(0), Array(18).fill(0)),
        holes: { "1": { input: { teamAPlayersGross: [4], teamBPlayersGross: [4, 5] } } },
      });
      expect(decideHole("twoManBestBall", 1, match)).toBeNull();
    });

    it("best ball: returns null with empty array", () => {
      const match = createMatch({
        teamAPlayers: createTwoPlayerTeam(Array(18).fill(0), Array(18).fill(0)),
        teamBPlayers: createTwoPlayerTeam(Array(18).fill(0), Array(18).fill(0)),
        holes: { "1": { input: { teamAPlayersGross: [], teamBPlayersGross: [4, 5] } } },
      });
      expect(decideHole("twoManBestBall", 1, match)).toBeNull();
    });
  });
});

// --- summarize tests ---

describe("summarize", () => {
  describe("basic scoring", () => {
    it("returns initial state for empty match", () => {
      const match = createMatch();
      const result = summarize("singles", match);
      
      expect(result.holesWonA).toBe(0);
      expect(result.holesWonB).toBe(0);
      expect(result.thru).toBe(0);
      expect(result.leader).toBeNull();
      expect(result.margin).toBe(0);
      expect(result.closed).toBe(false);
      expect(result.dormie).toBe(false);
      expect(result.winner).toBe("AS");
    });

    it("tracks holes won correctly", () => {
      const match = createMatch({
        holes: {
          "1": { input: { teamAPlayerGross: 4, teamBPlayerGross: 5 } }, // A wins
          "2": { input: { teamAPlayerGross: 5, teamBPlayerGross: 4 } }, // B wins
          "3": { input: { teamAPlayerGross: 4, teamBPlayerGross: 4 } }, // AS
        },
      });
      const result = summarize("singles", match);
      
      expect(result.holesWonA).toBe(1);
      expect(result.holesWonB).toBe(1);
      expect(result.thru).toBe(3);
      expect(result.leader).toBeNull();
      expect(result.margin).toBe(0);
    });

    it("identifies leader correctly", () => {
      const match = createMatch({
        holes: {
          "1": { input: { teamAPlayerGross: 4, teamBPlayerGross: 5 } }, // A wins
          "2": { input: { teamAPlayerGross: 4, teamBPlayerGross: 5 } }, // A wins
          "3": { input: { teamAPlayerGross: 5, teamBPlayerGross: 4 } }, // B wins
        },
      });
      const result = summarize("singles", match);
      
      expect(result.leader).toBe("teamA");
      expect(result.margin).toBe(1); // 2-1 = 1 up
    });
  });

  describe("match closing conditions", () => {
    it("closes match when lead exceeds remaining holes", () => {
      // Team A wins holes 1-10 (10 up with 8 to play)
      const holes: Record<string, { input: { teamAPlayerGross: number; teamBPlayerGross: number } }> = {};
      for (let i = 1; i <= 10; i++) {
        holes[String(i)] = { input: { teamAPlayerGross: 4, teamBPlayerGross: 5 } };
      }
      const match = createMatch({ holes });
      const result = summarize("singles", match);
      
      expect(result.closed).toBe(true);
      expect(result.winner).toBe("teamA");
      expect(result.margin).toBe(10);
      expect(result.thru).toBe(10);
    });

    it("closes match when all 18 holes are complete", () => {
      const holes: Record<string, { input: { teamAPlayerGross: number; teamBPlayerGross: number } }> = {};
      for (let i = 1; i <= 18; i++) {
        holes[String(i)] = { input: { teamAPlayerGross: 4, teamBPlayerGross: 4 } }; // All tied
      }
      const match = createMatch({ holes });
      const result = summarize("singles", match);
      
      expect(result.closed).toBe(true);
      expect(result.winner).toBe("AS");
      expect(result.thru).toBe(18);
    });

    it("returns correct winner at 18 holes with leader", () => {
      const holes: Record<string, { input: { teamAPlayerGross: number; teamBPlayerGross: number } }> = {};
      for (let i = 1; i <= 17; i++) {
        holes[String(i)] = { input: { teamAPlayerGross: 4, teamBPlayerGross: 4 } }; // All tied
      }
      holes["18"] = { input: { teamAPlayerGross: 4, teamBPlayerGross: 5 } }; // A wins last
      
      const match = createMatch({ holes });
      const result = summarize("singles", match);
      
      expect(result.closed).toBe(true);
      expect(result.winner).toBe("teamA");
      expect(result.margin).toBe(1);
    });
  });

  describe("dormie detection", () => {
    it("detects dormie state", () => {
      // Team A 2 up with 2 to play (holes 1-16 complete)
      const holes: Record<string, { input: { teamAPlayerGross: number; teamBPlayerGross: number } }> = {};
      for (let i = 1; i <= 16; i++) {
        if (i <= 2) {
          holes[String(i)] = { input: { teamAPlayerGross: 4, teamBPlayerGross: 5 } }; // A wins
        } else {
          holes[String(i)] = { input: { teamAPlayerGross: 4, teamBPlayerGross: 4 } }; // Halved
        }
      }
      const match = createMatch({ holes });
      const result = summarize("singles", match);
      
      expect(result.dormie).toBe(true);
      expect(result.closed).toBe(false);
      expect(result.margin).toBe(2);
      expect(result.thru).toBe(16);
    });

    it("not dormie when match is closed", () => {
      // All 18 holes complete
      const holes: Record<string, { input: { teamAPlayerGross: number; teamBPlayerGross: number } }> = {};
      for (let i = 1; i <= 18; i++) {
        if (i <= 2) {
          holes[String(i)] = { input: { teamAPlayerGross: 4, teamBPlayerGross: 5 } };
        } else {
          holes[String(i)] = { input: { teamAPlayerGross: 4, teamBPlayerGross: 4 } };
        }
      }
      const match = createMatch({ holes });
      const result = summarize("singles", match);
      
      expect(result.dormie).toBe(false);
      expect(result.closed).toBe(true);
    });
  });

  describe("momentum tracking", () => {
    it("tracks wasTeamADown3PlusBack9", () => {
      // Team B wins first 10 holes (Team A is 10 down after hole 10)
      const holes: Record<string, { input: { teamAPlayerGross: number; teamBPlayerGross: number } }> = {};
      for (let i = 1; i <= 10; i++) {
        holes[String(i)] = { input: { teamAPlayerGross: 5, teamBPlayerGross: 4 } }; // B wins
      }
      const match = createMatch({ holes });
      const result = summarize("singles", match);
      
      expect(result.wasTeamADown3PlusBack9).toBe(true);
      expect(result.wasTeamAUp3PlusBack9).toBe(false);
    });

    it("tracks wasTeamAUp3PlusBack9", () => {
      // Team A wins first 12 holes
      const holes: Record<string, { input: { teamAPlayerGross: number; teamBPlayerGross: number } }> = {};
      for (let i = 1; i <= 12; i++) {
        holes[String(i)] = { input: { teamAPlayerGross: 4, teamBPlayerGross: 5 } }; // A wins
      }
      const match = createMatch({ holes });
      const result = summarize("singles", match);
      
      expect(result.wasTeamAUp3PlusBack9).toBe(true);
      expect(result.wasTeamADown3PlusBack9).toBe(false);
    });

    it("does not trigger momentum flags on front 9 only", () => {
      // Team A 5 up through 9 (all on front 9)
      const holes: Record<string, { input: { teamAPlayerGross: number; teamBPlayerGross: number } }> = {};
      for (let i = 1; i <= 9; i++) {
        if (i <= 5) {
          holes[String(i)] = { input: { teamAPlayerGross: 4, teamBPlayerGross: 5 } }; // A wins
        } else {
          holes[String(i)] = { input: { teamAPlayerGross: 4, teamBPlayerGross: 4 } }; // Halved
        }
      }
      const match = createMatch({ holes });
      const result = summarize("singles", match);
      
      expect(result.wasTeamAUp3PlusBack9).toBe(false);
      expect(result.wasTeamADown3PlusBack9).toBe(false);
    });
  });

  describe("marginHistory tracking", () => {
    it("tracks margin after each hole", () => {
      const match = createMatch({
        holes: {
          "1": { input: { teamAPlayerGross: 4, teamBPlayerGross: 5 } }, // A wins: +1
          "2": { input: { teamAPlayerGross: 4, teamBPlayerGross: 4 } }, // AS: +1
          "3": { input: { teamAPlayerGross: 5, teamBPlayerGross: 4 } }, // B wins: 0
          "4": { input: { teamAPlayerGross: 5, teamBPlayerGross: 4 } }, // B wins: -1
        },
      });
      const result = summarize("singles", match);
      
      expect(result.marginHistory).toEqual([1, 1, 0, -1]);
    });

    it("margin history length matches thru", () => {
      const match = createMatch({
        holes: {
          "1": { input: { teamAPlayerGross: 4, teamBPlayerGross: 5 } },
          "2": { input: { teamAPlayerGross: 4, teamBPlayerGross: 5 } },
          "3": { input: { teamAPlayerGross: 4, teamBPlayerGross: 5 } },
        },
      });
      const result = summarize("singles", match);
      expect(result.marginHistory.length).toBe(result.thru);
    });

    it("tracks lead changes with margin history", () => {
      const match = createMatch({
        holes: {
          "1": { input: { teamAPlayerGross: 4, teamBPlayerGross: 5 } }, // +1
          "2": { input: { teamAPlayerGross: 5, teamBPlayerGross: 4 } }, // 0
          "3": { input: { teamAPlayerGross: 5, teamBPlayerGross: 4 } }, // -1
          "4": { input: { teamAPlayerGross: 4, teamBPlayerGross: 5 } }, // 0
          "5": { input: { teamAPlayerGross: 4, teamBPlayerGross: 5 } }, // +1
        },
      });
      const result = summarize("singles", match);
      expect(result.marginHistory).toEqual([1, 0, -1, 0, 1]);
    });
  });

  describe("dormie transitions", () => {
    it("dormie player wins next hole → match closed", () => {
      // 2 up with 2 to play (dormie)
      const holes: Record<string, { input: { teamAPlayerGross: number; teamBPlayerGross: number } }> = {};
      for (let i = 1; i <= 16; i++) {
        if (i <= 2) {
          holes[String(i)] = { input: { teamAPlayerGross: 4, teamBPlayerGross: 5 } };
        } else {
          holes[String(i)] = { input: { teamAPlayerGross: 4, teamBPlayerGross: 4 } };
        }
      }
      
      let match = createMatch({ holes });
      let result = summarize("singles", match);
      expect(result.dormie).toBe(true);
      expect(result.closed).toBe(false);
      
      // Win hole 17 → 3 up with 1 to play → closed
      holes["17"] = { input: { teamAPlayerGross: 4, teamBPlayerGross: 5 } };
      match = createMatch({ holes });
      result = summarize("singles", match);
      
      expect(result.dormie).toBe(false);
      expect(result.closed).toBe(true);
      expect(result.margin).toBe(3);
      expect(result.winner).toBe("teamA");
    });

    it("dormie player halves next hole → match closed (2 up with 1 to play)", () => {
      // 2 up with 2 to play
      const holes: Record<string, { input: { teamAPlayerGross: number; teamBPlayerGross: number } }> = {};
      for (let i = 1; i <= 16; i++) {
        if (i <= 2) {
          holes[String(i)] = { input: { teamAPlayerGross: 4, teamBPlayerGross: 5 } };
        } else {
          holes[String(i)] = { input: { teamAPlayerGross: 4, teamBPlayerGross: 4 } };
        }
      }
      // Halve 17 → still 2 up with 1 to play = CLOSED (margin 2 > holesLeft 1)
      holes["17"] = { input: { teamAPlayerGross: 4, teamBPlayerGross: 4 } };
      
      const match = createMatch({ holes });
      const result = summarize("singles", match);
      
      expect(result.dormie).toBe(false); // Not dormie because match is closed
      expect(result.closed).toBe(true);   // 2 > 1 (margin > holesLeft)
      expect(result.margin).toBe(2);
      expect(result.winner).toBe("teamA");
    });

    it("dormie player loses next hole → no longer dormie", () => {
      // 2 up with 2 to play
      const holes: Record<string, { input: { teamAPlayerGross: number; teamBPlayerGross: number } }> = {};
      for (let i = 1; i <= 16; i++) {
        if (i <= 2) {
          holes[String(i)] = { input: { teamAPlayerGross: 4, teamBPlayerGross: 5 } };
        } else {
          holes[String(i)] = { input: { teamAPlayerGross: 4, teamBPlayerGross: 4 } };
        }
      }
      // Lose 17 → 1 up with 1 to play (NOT dormie, since 1 > 1 is false)
      holes["17"] = { input: { teamAPlayerGross: 5, teamBPlayerGross: 4 } };
      
      const match = createMatch({ holes });
      const result = summarize("singles", match);
      
      expect(result.dormie).toBe(true); // 1 up with 1 to play IS dormie
      expect(result.closed).toBe(false);
      expect(result.margin).toBe(1);
    });
  });

  describe("out-of-order and gapped hole entry", () => {
    it("handles holes entered out of order", () => {
      const match = createMatch({
        holes: {
          "5": { input: { teamAPlayerGross: 4, teamBPlayerGross: 5 } }, // A wins
          "1": { input: { teamAPlayerGross: 4, teamBPlayerGross: 5 } }, // A wins
          "3": { input: { teamAPlayerGross: 5, teamBPlayerGross: 4 } }, // B wins
          "2": { input: { teamAPlayerGross: 4, teamBPlayerGross: 4 } }, // AS
          "4": { input: { teamAPlayerGross: 4, teamBPlayerGross: 4 } }, // AS
        },
      });
      const result = summarize("singles", match);
      
      expect(result.thru).toBe(5);
      expect(result.holesWonA).toBe(2);
      expect(result.holesWonB).toBe(1);
      expect(result.marginHistory).toEqual([1, 1, 0, 0, 1]); // Sorted: 1,2,3,4,5
    });

    it("handles gaps in hole entry (only 1, 5, 9, 18)", () => {
      const match = createMatch({
        holes: {
          "1": { input: { teamAPlayerGross: 4, teamBPlayerGross: 5 } },
          "5": { input: { teamAPlayerGross: 4, teamBPlayerGross: 5 } },
          "9": { input: { teamAPlayerGross: 4, teamBPlayerGross: 5 } },
          "18": { input: { teamAPlayerGross: 4, teamBPlayerGross: 5 } },
        },
      });
      const result = summarize("singles", match);
      
      expect(result.thru).toBe(18); // Max hole number
      expect(result.holesWonA).toBe(4);
      expect(result.marginHistory).toEqual([1, 2, 3, 4]);
    });

    it("handles only back 9 entered (thru = 18, not 9)", () => {
      const holes: Record<string, { input: { teamAPlayerGross: number; teamBPlayerGross: number } }> = {};
      for (let i = 10; i <= 18; i++) {
        holes[String(i)] = { input: { teamAPlayerGross: 4, teamBPlayerGross: 4 } };
      }
      const match = createMatch({ holes });
      const result = summarize("singles", match);
      
      expect(result.thru).toBe(18);
      expect(result.leader).toBeNull(); // All halved
    });
  });

  describe("momentum flag boundary conditions", () => {
    it("triggers flag at exactly 3 down on hole 10", () => {
      // Team B wins holes 1-9 + hole 10 (10 down total, but flag triggered at hole 10)
      const holes: Record<string, { input: { teamAPlayerGross: number; teamBPlayerGross: number } }> = {};
      // Team A loses all first 10 holes
      for (let i = 1; i <= 10; i++) {
        holes[String(i)] = { input: { teamAPlayerGross: 5, teamBPlayerGross: 4 } };
      }
      const match = createMatch({ holes });
      const result = summarize("singles", match);
      
      expect(result.wasTeamADown3PlusBack9).toBe(true);
    });

    it("does NOT trigger flag at exactly 3 down on hole 9", () => {
      const holes: Record<string, { input: { teamAPlayerGross: number; teamBPlayerGross: number } }> = {};
      for (let i = 1; i <= 9; i++) {
        holes[String(i)] = { input: { teamAPlayerGross: 5, teamBPlayerGross: 4 } };
      }
      const match = createMatch({ holes });
      const result = summarize("singles", match);
      
      expect(result.wasTeamADown3PlusBack9).toBe(false);
    });

    it("does NOT trigger flag at 2 down on hole 10", () => {
      const holes: Record<string, { input: { teamAPlayerGross: number; teamBPlayerGross: number } }> = {};
      for (let i = 1; i <= 10; i++) {
        if (i <= 2) {
          holes[String(i)] = { input: { teamAPlayerGross: 5, teamBPlayerGross: 4 } }; // B wins
        } else {
          holes[String(i)] = { input: { teamAPlayerGross: 4, teamBPlayerGross: 4 } }; // Halved
        }
      }
      const match = createMatch({ holes });
      const result = summarize("singles", match);
      
      expect(result.wasTeamADown3PlusBack9).toBe(false);
    });

    it("flag stays true even if team comes back", () => {
      const holes: Record<string, { input: { teamAPlayerGross: number; teamBPlayerGross: number } }> = {};
      // Down 3 after hole 10
      for (let i = 1; i <= 10; i++) {
        if (i <= 3) {
          holes[String(i)] = { input: { teamAPlayerGross: 5, teamBPlayerGross: 4 } };
        } else {
          holes[String(i)] = { input: { teamAPlayerGross: 4, teamBPlayerGross: 4 } };
        }
      }
      // Then win holes 11-13 (comeback to even)
      for (let i = 11; i <= 13; i++) {
        holes[String(i)] = { input: { teamAPlayerGross: 4, teamBPlayerGross: 5 } };
      }
      
      const match = createMatch({ holes });
      const result = summarize("singles", match);
      
      expect(result.wasTeamADown3PlusBack9).toBe(true);
      expect(result.leader).toBeNull(); // Back to even
    });
  });
});

// --- buildStatusAndResult tests ---

describe("buildStatusAndResult", () => {
  it("builds correct status object", () => {
    const summary = {
      holesWonA: 5,
      holesWonB: 3,
      thru: 10,
      leader: "teamA" as const,
      margin: 2,
      dormie: false,
      closed: false,
      winner: "teamA" as const,
      wasTeamADown3PlusBack9: false,
      wasTeamAUp3PlusBack9: false,
      marginHistory: [1, 1, 2, 2, 1, 1, 1, 2, 2, 2],
    };
    
    const { status, result } = buildStatusAndResult(summary);
    
    expect(status).toEqual({
      leader: "teamA",
      margin: 2,
      thru: 10,
      dormie: false,
      closed: false,
      wasTeamADown3PlusBack9: false,
      wasTeamAUp3PlusBack9: false,
      marginHistory: [1, 1, 2, 2, 1, 1, 1, 2, 2, 2],
    });
    
    expect(result).toEqual({
      winner: "teamA",
      holesWonA: 5,
      holesWonB: 3,
    });
  });

  it("handles AS winner", () => {
    const summary = {
      holesWonA: 9,
      holesWonB: 9,
      thru: 18,
      leader: null,
      margin: 0,
      dormie: false,
      closed: true,
      winner: "AS" as const,
      wasTeamADown3PlusBack9: false,
      wasTeamAUp3PlusBack9: false,
      marginHistory: Array(18).fill(0),
    };
    
    const { status, result } = buildStatusAndResult(summary);
    
    expect(status.leader).toBeNull();
    expect(status.closed).toBe(true);
    expect(result.winner).toBe("AS");
  });
});

// --- Integration tests ---

describe("integration: full match flow", () => {
  it("calculates correct status for 2&1 victory", () => {
    // Team A wins holes 1, 2, 3 (3 up after 3)
    // Holes 4-17 halved (3 up after 17 = 3 up with 1 to play = closed)
    const holes: Record<string, { input: { teamAPlayerGross: number; teamBPlayerGross: number } }> = {};
    for (let i = 1; i <= 17; i++) {
      if (i <= 3) {
        holes[String(i)] = { input: { teamAPlayerGross: 4, teamBPlayerGross: 5 } };
      } else {
        holes[String(i)] = { input: { teamAPlayerGross: 4, teamBPlayerGross: 4 } };
      }
    }
    
    const match = createMatch({ holes });
    const summary = summarize("singles", match);
    const { status, result } = buildStatusAndResult(summary);
    
    expect(status.closed).toBe(true);
    expect(status.leader).toBe("teamA");
    expect(status.margin).toBe(3);
    expect(status.thru).toBe(17);
    expect(result.winner).toBe("teamA");
    expect(result.holesWonA).toBe(3);
    expect(result.holesWonB).toBe(0);
  });

  it("calculates correct status for scramble format", () => {
    const match = createMatch({
      holes: {
        "1": { input: { teamAGross: 4, teamBGross: 5 } },
        "2": { input: { teamAGross: 5, teamBGross: 4 } },
        "3": { input: { teamAGross: 3, teamBGross: 3 } },
      },
    });
    
    const summary = summarize("twoManScramble", match);
    
    expect(summary.holesWonA).toBe(1);
    expect(summary.holesWonB).toBe(1);
    expect(summary.thru).toBe(3);
    expect(summary.leader).toBeNull();
  });

  it("calculates 5&4 victory for teamB", () => {
    const holes: Record<string, { input: { teamAPlayerGross: number; teamBPlayerGross: number } }> = {};
    // Team B wins holes 1-5 (5 up after 5)
    for (let i = 1; i <= 5; i++) {
      holes[String(i)] = { input: { teamAPlayerGross: 5, teamBPlayerGross: 4 } };
    }
    // Holes 6-14 halved
    for (let i = 6; i <= 14; i++) {
      holes[String(i)] = { input: { teamAPlayerGross: 4, teamBPlayerGross: 4 } };
    }
    
    const match = createMatch({ holes });
    const summary = summarize("singles", match);
    const { status, result } = buildStatusAndResult(summary);
    
    expect(status.closed).toBe(true);
    expect(result.winner).toBe("teamB");
    expect(status.margin).toBe(5);
    expect(status.thru).toBe(14);
  });

  it("calculates 10&8 victory (max margin)", () => {
    const holes: Record<string, { input: { teamAPlayerGross: number; teamBPlayerGross: number } }> = {};
    // Team A wins first 10 holes
    for (let i = 1; i <= 10; i++) {
      holes[String(i)] = { input: { teamAPlayerGross: 4, teamBPlayerGross: 5 } };
    }
    
    const match = createMatch({ holes });
    const summary = summarize("singles", match);
    
    expect(summary.closed).toBe(true);
    expect(summary.winner).toBe("teamA");
    expect(summary.margin).toBe(10);
    expect(summary.thru).toBe(10);
  });

  it("calculates 1-up victory at 18", () => {
    const holes: Record<string, { input: { teamAPlayerGross: number; teamBPlayerGross: number } }> = {};
    // All halved except hole 18
    for (let i = 1; i <= 17; i++) {
      holes[String(i)] = { input: { teamAPlayerGross: 4, teamBPlayerGross: 4 } };
    }
    holes["18"] = { input: { teamAPlayerGross: 4, teamBPlayerGross: 5 } };
    
    const match = createMatch({ holes });
    const summary = summarize("singles", match);
    
    expect(summary.closed).toBe(true);
    expect(summary.winner).toBe("teamA");
    expect(summary.margin).toBe(1);
    expect(summary.thru).toBe(18);
  });

  it("calculates AS result (all 18 halved)", () => {
    const holes: Record<string, { input: { teamAPlayerGross: number; teamBPlayerGross: number } }> = {};
    for (let i = 1; i <= 18; i++) {
      holes[String(i)] = { input: { teamAPlayerGross: 4, teamBPlayerGross: 4 } };
    }
    
    const match = createMatch({ holes });
    const summary = summarize("singles", match);
    const { status, result } = buildStatusAndResult(summary);
    
    expect(status.closed).toBe(true);
    expect(result.winner).toBe("AS");
    expect(status.leader).toBeNull();
    expect(status.margin).toBe(0);
    expect(result.holesWonA).toBe(0);
    expect(result.holesWonB).toBe(0);
  });

  it("handles big comeback scenario", () => {
    const holes: Record<string, { input: { teamAPlayerGross: number; teamBPlayerGross: number } }> = {};
    // Team A loses first 5 (5 down)
    for (let i = 1; i <= 5; i++) {
      holes[String(i)] = { input: { teamAPlayerGross: 5, teamBPlayerGross: 4 } };
    }
    // Holes 6-9 halved (still 5 down going into back 9)
    for (let i = 6; i <= 9; i++) {
      holes[String(i)] = { input: { teamAPlayerGross: 4, teamBPlayerGross: 4 } };
    }
    // Team A wins holes 10-16 (now 2 up after 16)
    for (let i = 10; i <= 16; i++) {
      holes[String(i)] = { input: { teamAPlayerGross: 4, teamBPlayerGross: 5 } };
    }
    // Halve 17 (2 up with 1 to play = closed)
    holes["17"] = { input: { teamAPlayerGross: 4, teamBPlayerGross: 4 } };
    
    const match = createMatch({ holes });
    const summary = summarize("singles", match);
    
    expect(summary.closed).toBe(true);
    expect(summary.winner).toBe("teamA");
    expect(summary.wasTeamADown3PlusBack9).toBe(true); // Was down 5 on hole 10
    expect(summary.margin).toBe(2);
  });
});

// --- updateMatchFacts compatibility tests ---

describe("updateMatchFacts compatibility", () => {
  describe("data structure for Cloud Function consumption", () => {
    it("produces all required fields for playerMatchFacts", () => {
      const holes: Record<string, { input: { teamAPlayerGross: number; teamBPlayerGross: number } }> = {};
      for (let i = 1; i <= 18; i++) {
        holes[String(i)] = { input: { teamAPlayerGross: 4, teamBPlayerGross: 5 } };
      }
      
      const match = createMatch({ holes });
      const summary = summarize("singles", match);
      const { status, result } = buildStatusAndResult(summary);
      
      // Required fields used by updateMatchFacts
      expect(typeof status.closed).toBe("boolean");
      expect(["teamA", "teamB", null]).toContain(status.leader);
      expect(typeof status.margin).toBe("number");
      expect(typeof status.thru).toBe("number");
      expect(typeof status.dormie).toBe("boolean");
      expect(typeof status.wasTeamADown3PlusBack9).toBe("boolean");
      expect(typeof status.wasTeamAUp3PlusBack9).toBe("boolean");
      expect(Array.isArray(status.marginHistory)).toBe(true);
      
      expect(["teamA", "teamB", "AS"]).toContain(result.winner);
      expect(typeof result.holesWonA).toBe("number");
      expect(typeof result.holesWonB).toBe("number");
    });

    it("holesWonA + holesWonB <= thru (no overcounting)", () => {
      const match = createMatch({
        holes: {
          "1": { input: { teamAPlayerGross: 4, teamBPlayerGross: 5 } }, // A
          "2": { input: { teamAPlayerGross: 5, teamBPlayerGross: 4 } }, // B
          "3": { input: { teamAPlayerGross: 4, teamBPlayerGross: 4 } }, // AS
          "4": { input: { teamAPlayerGross: 4, teamBPlayerGross: 5 } }, // A
          "5": { input: { teamAPlayerGross: 4, teamBPlayerGross: 4 } }, // AS
        },
      });
      const summary = summarize("singles", match);
      
      expect(summary.holesWonA + summary.holesWonB).toBeLessThanOrEqual(summary.thru);
      // Halved holes = thru - holesWonA - holesWonB
      expect(summary.thru - summary.holesWonA - summary.holesWonB).toBe(2);
    });

    it("marginHistory length equals thru", () => {
      const holes: Record<string, { input: { teamAPlayerGross: number; teamBPlayerGross: number } }> = {};
      for (let i = 1; i <= 12; i++) {
        holes[String(i)] = { input: { teamAPlayerGross: 4, teamBPlayerGross: i <= 6 ? 5 : 4 } };
      }
      
      const match = createMatch({ holes });
      const summary = summarize("singles", match);
      
      expect(summary.marginHistory.length).toBe(summary.thru);
    });

    it("margin equals absolute difference of holesWonA - holesWonB", () => {
      const match = createMatch({
        holes: {
          "1": { input: { teamAPlayerGross: 4, teamBPlayerGross: 5 } },
          "2": { input: { teamAPlayerGross: 4, teamBPlayerGross: 5 } },
          "3": { input: { teamAPlayerGross: 4, teamBPlayerGross: 5 } },
          "4": { input: { teamAPlayerGross: 5, teamBPlayerGross: 4 } },
        },
      });
      const summary = summarize("singles", match);
      
      expect(summary.margin).toBe(Math.abs(summary.holesWonA - summary.holesWonB));
    });

    it("winner matches leader when closed early", () => {
      const holes: Record<string, { input: { teamAPlayerGross: number; teamBPlayerGross: number } }> = {};
      for (let i = 1; i <= 10; i++) {
        holes[String(i)] = { input: { teamAPlayerGross: 4, teamBPlayerGross: 5 } };
      }
      
      const match = createMatch({ holes });
      const summary = summarize("singles", match);
      
      expect(summary.closed).toBe(true);
      expect(summary.winner).toBe(summary.leader);
    });

    it("winner is AS when tied at 18", () => {
      const holes: Record<string, { input: { teamAPlayerGross: number; teamBPlayerGross: number } }> = {};
      for (let i = 1; i <= 18; i++) {
        if (i <= 9) {
          holes[String(i)] = { input: { teamAPlayerGross: 4, teamBPlayerGross: 5 } };
        } else {
          holes[String(i)] = { input: { teamAPlayerGross: 5, teamBPlayerGross: 4 } };
        }
      }
      
      const match = createMatch({ holes });
      const summary = summarize("singles", match);
      
      expect(summary.holesWonA).toBe(9);
      expect(summary.holesWonB).toBe(9);
      expect(summary.winner).toBe("AS");
      expect(summary.leader).toBeNull();
    });
  });

  describe("format-specific data for updateMatchFacts", () => {
    it("best ball format produces valid data for all 4 players", () => {
      const match = createMatch({
        teamAPlayers: createTwoPlayerTeam(
          [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
        ),
        teamBPlayers: createTwoPlayerTeam(
          [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          [0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
        ),
        holes: {
          "1": { input: { teamAPlayersGross: [5, 4], teamBPlayersGross: [5, 4] } },
          "2": { input: { teamAPlayersGross: [4, 5], teamBPlayersGross: [4, 5] } },
          "3": { input: { teamAPlayersGross: [4, 4], teamBPlayersGross: [5, 5] } },
        },
      });
      
      const summary = summarize("twoManBestBall", match);
      
      expect(summary.thru).toBe(3);
      expect(summary.holesWonA).toBeGreaterThanOrEqual(0);
      expect(summary.holesWonB).toBeGreaterThanOrEqual(0);
    });

    it("scramble format works without player arrays", () => {
      const match: MatchData = {
        holes: {
          "1": { input: { teamAGross: 4, teamBGross: 5 } },
          "2": { input: { teamAGross: 3, teamBGross: 4 } },
        },
      };
      
      const summary = summarize("twoManScramble", match);
      
      expect(summary.holesWonA).toBe(2);
      expect(summary.holesWonB).toBe(0);
      expect(summary.thru).toBe(2);
    });

    it("shamble format ignores strokes in hole decision", () => {
      // Both teams have same gross scores, but Team A has strokes
      // Shamble should still result in AS (strokes ignored)
      const match = createMatch({
        teamAPlayers: createTwoPlayerTeam(Array(18).fill(1), Array(18).fill(1)),
        teamBPlayers: createTwoPlayerTeam(Array(18).fill(0), Array(18).fill(0)),
        holes: {
          "1": { input: { teamAPlayersGross: [4, 5], teamBPlayersGross: [4, 5] } },
        },
      });
      
      expect(decideHole("twoManShamble", 1, match)).toBe("AS");
    });
  });

  describe("edge cases that could break updateMatchFacts", () => {
    it("handles match with no completed holes", () => {
      const match = createMatch({ holes: {} });
      const summary = summarize("singles", match);
      const { status, result } = buildStatusAndResult(summary);
      
      expect(status.thru).toBe(0);
      expect(status.closed).toBe(false);
      expect(result.holesWonA).toBe(0);
      expect(result.holesWonB).toBe(0);
      expect(status.marginHistory).toEqual([]);
    });

    it("handles match with null holes", () => {
      const match = createMatch({ holes: undefined });
      const summary = summarize("singles", match);
      
      expect(summary.thru).toBe(0);
      expect(summary.marginHistory).toEqual([]);
    });

    it("handles incomplete hole (partial scores)", () => {
      const match = createMatch({
        holes: {
          "1": { input: { teamAPlayerGross: 4, teamBPlayerGross: 5 } }, // Complete
          "2": { input: { teamAPlayerGross: 4 } }, // Incomplete - missing teamB
          "3": { input: { teamAPlayerGross: 4, teamBPlayerGross: 4 } }, // Complete
        },
      });
      
      const summary = summarize("singles", match);
      
      // Hole 2 is incomplete, but holes are sorted so thru = 3
      expect(summary.thru).toBe(3);
      expect(summary.marginHistory.length).toBe(2); // Only 2 complete holes counted
    });
  });

  describe("match reopening on earlier hole edit", () => {
    it("reopens closed match when earlier hole changes flip result", () => {
      // Scenario: Team A wins 4&3 (4 up with 3 to play after hole 15)
      // Then hole 1 score is edited to flip that hole from Team A win to Team B win
      // This swings margin by 2 (lose a win, gain a loss) → now 2 up instead of 4 up
      
      const holes: Record<string, { input: Record<string, number> }> = {};
      
      // Team A wins holes 1-4 (4 up after 4)
      for (let i = 1; i <= 4; i++) {
        holes[String(i)] = { input: { teamAPlayerGross: 4, teamBPlayerGross: 5 } };
      }
      // All square holes 5-15 (still 4 up after 15, match closes)
      for (let i = 5; i <= 15; i++) {
        holes[String(i)] = { input: { teamAPlayerGross: 4, teamBPlayerGross: 4 } };
      }
      
      const match = createMatch({ holes });
      const summary = summarize("singles", match);
      const { status } = buildStatusAndResult(summary);
      
      // Verify match is closed 4&3
      expect(status.closed).toBe(true);
      expect(status.leader).toBe("teamA");
      expect(status.margin).toBe(4);
      
      // Edit hole 1 to Team B winning (swing of 2: Team A loses a win, Team B gains one)
      holes["1"] = { input: { teamAPlayerGross: 5, teamBPlayerGross: 4 } };
      
      const matchAfterEdit = createMatch({ holes });
      const summaryAfterEdit = summarize("singles", matchAfterEdit);
      const statusAfterEdit = buildStatusAndResult(summaryAfterEdit).status;
      
      // Match should now be 2 up (not 4) - no longer closed at hole 15 (3 holes left > 2 lead)
      expect(statusAfterEdit.closed).toBe(false);
      expect(statusAfterEdit.margin).toBe(2);
    });

    it("keeps match closed if edit does not change outcome", () => {
      // Team A wins 5&3 - editing a middle hole to AS still leaves them 4&3
      const holes: Record<string, { input: Record<string, number> }> = {};
      
      // Team A wins holes 1-5
      for (let i = 1; i <= 5; i++) {
        holes[String(i)] = { input: { teamAPlayerGross: 4, teamBPlayerGross: 5 } };
      }
      // Holes 6-15 all square
      for (let i = 6; i <= 15; i++) {
        holes[String(i)] = { input: { teamAPlayerGross: 4, teamBPlayerGross: 4 } };
      }
      
      const match = createMatch({ holes });
      const { status: statusBefore } = buildStatusAndResult(summarize("singles", match));
      
      expect(statusBefore.closed).toBe(true);
      expect(statusBefore.margin).toBe(5);
      
      // Edit hole 3 to be all square (loses 1 hole of lead)
      holes["3"] = { input: { teamAPlayerGross: 4, teamBPlayerGross: 4 } };
      
      const matchAfterEdit = createMatch({ holes });
      const { status: statusAfter } = buildStatusAndResult(summarize("singles", matchAfterEdit));
      
      // Still closed at 4&3
      expect(statusAfter.closed).toBe(true);
      expect(statusAfter.margin).toBe(4);
    });

    it("correctly recalculates through 18 holes after reopening", () => {
      // Start with closed match, edit to make it not closed, add remaining holes
      const holes: Record<string, { input: Record<string, number> }> = {};
      
      // Team A wins holes 1-4
      for (let i = 1; i <= 4; i++) {
        holes[String(i)] = { input: { teamAPlayerGross: 4, teamBPlayerGross: 5 } };
      }
      // AS for 5-15
      for (let i = 5; i <= 15; i++) {
        holes[String(i)] = { input: { teamAPlayerGross: 4, teamBPlayerGross: 4 } };
      }
      
      // Initially closed 4&3
      const { status: s1 } = buildStatusAndResult(summarize("singles", createMatch({ holes })));
      expect(s1.closed).toBe(true);
      
      // Edit holes 1-2 to AS (now 2 up after 15, not closed)
      holes["1"] = { input: { teamAPlayerGross: 4, teamBPlayerGross: 4 } };
      holes["2"] = { input: { teamAPlayerGross: 4, teamBPlayerGross: 4 } };
      
      const { status: s2 } = buildStatusAndResult(summarize("singles", createMatch({ holes })));
      expect(s2.closed).toBe(false);
      expect(s2.margin).toBe(2);
      
      // Add holes 16-18 where Team B wins 2 (ties match)
      holes["16"] = { input: { teamAPlayerGross: 5, teamBPlayerGross: 4 } };
      holes["17"] = { input: { teamAPlayerGross: 5, teamBPlayerGross: 4 } };
      holes["18"] = { input: { teamAPlayerGross: 4, teamBPlayerGross: 4 } };
      
      const summary = summarize("singles", createMatch({ holes }));
      const { status: s3, result } = buildStatusAndResult(summary);
      
      expect(s3.thru).toBe(18);
      expect(s3.closed).toBe(true);
      expect(result.winner).toBe("AS"); // All square after 18
    });
  });
});
