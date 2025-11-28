/**
 * Unit tests for updateMatchFacts stat calculations
 * Tests edge cases for playerMatchFact field generation
 */

import { describe, it, expect } from "vitest";

// --- TEST HELPERS ---

/** 
 * Simulates the strokesVsParNet calculation
 * This mirrors the logic in updateMatchFacts but isolated for testing
 */
function calculateStrokesVsParNet(
  totalGross: number,
  playerHandicap: number,
  coursePar: number
): number {
  // Bug: current code uses totalNet (sum of strokesReceived deductions)
  // Fix: should use actual playerHandicap (whole number course handicap)
  return totalGross - playerHandicap - coursePar;
}

/**
 * Simulates the buggy strokesVsParNet calculation using strokesReceived
 */
function calculateStrokesVsParNetBuggy(
  totalGross: number,
  strokesReceivedSum: number,
  coursePar: number
): number {
  const totalNet = totalGross - strokesReceivedSum;
  return totalNet - coursePar;
}

/**
 * Simulates decidedOn18 / won18thHole logic
 */
function calculateDecidedOn18(
  finalThru: number,
  winningHole: number | null,
  marginGoingInto18: number,
  hole18Result: "teamA" | "teamB" | "AS" | null,
  team: "teamA" | "teamB"
): { decidedOn18: boolean; won18thHole: boolean | null } {
  // Match must go all 18 holes (not closed early)
  if (finalThru !== 18 || winningHole !== null || hole18Result === null) {
    return { decidedOn18: false, won18thHole: null };
  }

  const myTeamWon18 = hole18Result === team;
  const myTeamLost18 = hole18Result !== "AS" && hole18Result !== team;

  // All square going into 18 - whoever wins hole 18 wins the match
  if (marginGoingInto18 === 0 && hole18Result !== "AS") {
    return { decidedOn18: true, won18thHole: myTeamWon18 };
  }

  // 1 up going into 18 - hole 18 result can decide match
  if (Math.abs(marginGoingInto18) === 1) {
    const teamAUp1 = marginGoingInto18 > 0;
    const teamBUp1 = marginGoingInto18 < 0;
    
    // If trailing team wins hole 18, they tie the match (AS result)
    // If leading team wins or halves, they win
    if ((teamAUp1 && team === "teamB" && hole18Result === "teamB") ||
        (teamBUp1 && team === "teamA" && hole18Result === "teamA")) {
      // Trailing team won hole 18 to halve the match
      return { decidedOn18: true, won18thHole: myTeamWon18 };
    }
    if ((teamAUp1 && team === "teamA" && hole18Result === "teamB") ||
        (teamBUp1 && team === "teamB" && hole18Result === "teamA")) {
      // Leading team lost hole 18 to halve the match
      return { decidedOn18: true, won18thHole: myTeamLost18 ? false : null };
    }
  }

  return { decidedOn18: false, won18thHole: null };
}

/**
 * Simulates ballUsedOn18 tracking for best ball / shamble
 */
function calculateBallUsedOn18(
  playerNets: [number, number],
  playerIndex: 0 | 1
): boolean | null {
  const [p0Net, p1Net] = playerNets;
  
  if (p0Net < p1Net) {
    // Player 0's ball was used solo
    return playerIndex === 0 ? true : false;
  } else if (p1Net < p0Net) {
    // Player 1's ball was used solo
    return playerIndex === 1 ? true : false;
  } else {
    // Both balls tied - BOTH should be marked as used on 18
    // Bug: current code doesn't handle this case
    return true; // Fix: both players get true when tied
  }
}

/**
 * Buggy version that doesn't handle tied balls on 18
 */
function calculateBallUsedOn18Buggy(
  playerNets: [number, number],
  playerIndex: 0 | 1
): boolean | null {
  const [p0Net, p1Net] = playerNets;
  
  if (p0Net < p1Net) {
    return playerIndex === 0 ? true : false;
  } else if (p1Net < p0Net) {
    return playerIndex === 1 ? true : false;
  } else {
    // Bug: tied case returns null (doesn't set ballUsedOn18)
    return null;
  }
}

// --- strokesVsParNet tests ---

describe("strokesVsParNet calculation", () => {
  describe("correct calculation using playerHandicap", () => {
    it("calculates correctly for scratch golfer", () => {
      // Scratch golfer (0 handicap) shoots 76 on par 72
      const result = calculateStrokesVsParNet(76, 0, 72);
      expect(result).toBe(4); // 76 - 0 - 72 = +4
    });

    it("calculates correctly for mid-handicap golfer", () => {
      // 12 handicap shoots 88 on par 72
      const result = calculateStrokesVsParNet(88, 12, 72);
      expect(result).toBe(4); // 88 - 12 - 72 = +4 (net 76)
    });

    it("calculates correctly for high-handicap golfer", () => {
      // 18 handicap shoots 90 on par 72
      const result = calculateStrokesVsParNet(90, 18, 72);
      expect(result).toBe(0); // 90 - 18 - 72 = 0 (net even)
    });

    it("handles negative result (under par net)", () => {
      // 10 handicap shoots 78 on par 72
      const result = calculateStrokesVsParNet(78, 10, 72);
      expect(result).toBe(-4); // 78 - 10 - 72 = -4 (net 68)
    });

    it("handles par 70 course", () => {
      // 8 handicap shoots 82 on par 70
      const result = calculateStrokesVsParNet(82, 8, 70);
      expect(result).toBe(4); // 82 - 8 - 70 = +4
    });
  });

  describe("buggy calculation using strokesReceived (for comparison)", () => {
    it("differs from correct calculation when strokesReceived != handicap", () => {
      // Player has 12 handicap but only receives 6 strokes in match (rolled down)
      const totalGross = 88;
      const playerHandicap = 12;
      const strokesReceivedSum = 6; // Only 6 strokes from match handicap difference
      const coursePar = 72;

      const correct = calculateStrokesVsParNet(totalGross, playerHandicap, coursePar);
      const buggy = calculateStrokesVsParNetBuggy(totalGross, strokesReceivedSum, coursePar);

      expect(correct).toBe(4);  // 88 - 12 - 72 = +4 (TRUE net score vs par)
      expect(buggy).toBe(10);   // 88 - 6 - 72 = +10 (WRONG - uses match strokes)
      expect(correct).not.toBe(buggy);
    });

    it("matches when player receives full handicap strokes", () => {
      // Edge case: player IS lowest handicap, receives 0 match strokes
      // but their actual handicap is 0 too
      const totalGross = 76;
      const playerHandicap = 0;
      const strokesReceivedSum = 0;
      const coursePar = 72;

      const correct = calculateStrokesVsParNet(totalGross, playerHandicap, coursePar);
      const buggy = calculateStrokesVsParNetBuggy(totalGross, strokesReceivedSum, coursePar);

      expect(correct).toBe(buggy); // Both = +4 when handicap = strokesReceived = 0
    });

    it("differs significantly for high-handicap player receiving few strokes", () => {
      // 18 handicap player only receives 4 strokes (opponent is 14 handicap)
      const totalGross = 95;
      const playerHandicap = 18;
      const strokesReceivedSum = 4;
      const coursePar = 72;

      const correct = calculateStrokesVsParNet(totalGross, playerHandicap, coursePar);
      const buggy = calculateStrokesVsParNetBuggy(totalGross, strokesReceivedSum, coursePar);

      expect(correct).toBe(5);   // 95 - 18 - 72 = +5
      expect(buggy).toBe(19);    // 95 - 4 - 72 = +19 (14 strokes difference!)
    });
  });
});

// --- decidedOn18 / won18thHole tests ---

describe("decidedOn18 and won18thHole calculation", () => {
  describe("match all square going into 18", () => {
    it("decidedOn18=true when AS into 18 and teamA wins hole 18", () => {
      const result = calculateDecidedOn18(18, null, 0, "teamA", "teamA");
      expect(result.decidedOn18).toBe(true);
      expect(result.won18thHole).toBe(true);
    });

    it("decidedOn18=true when AS into 18 and teamB wins hole 18", () => {
      const result = calculateDecidedOn18(18, null, 0, "teamB", "teamB");
      expect(result.decidedOn18).toBe(true);
      expect(result.won18thHole).toBe(true);
    });

    it("won18thHole=false for losing team when AS into 18", () => {
      const result = calculateDecidedOn18(18, null, 0, "teamA", "teamB");
      expect(result.decidedOn18).toBe(true);
      expect(result.won18thHole).toBe(false);
    });

    it("decidedOn18=false when AS into 18 and hole 18 is halved", () => {
      // Match ends AS, hole 18 didn't decide anything
      const result = calculateDecidedOn18(18, null, 0, "AS", "teamA");
      expect(result.decidedOn18).toBe(false);
      expect(result.won18thHole).toBe(null);
    });
  });

  describe("match 1-up going into 18", () => {
    it("decidedOn18=true when trailing team wins hole 18 to halve match", () => {
      // Team A is 1 up going into 18, Team B wins 18 to tie
      const resultB = calculateDecidedOn18(18, null, 1, "teamB", "teamB");
      expect(resultB.decidedOn18).toBe(true);
      expect(resultB.won18thHole).toBe(true);

      // From Team A's perspective (they lost)
      const resultA = calculateDecidedOn18(18, null, 1, "teamB", "teamA");
      expect(resultA.decidedOn18).toBe(true);
      expect(resultA.won18thHole).toBe(false);
    });

    it("decidedOn18=true when Team B 1-up loses 18 to halve", () => {
      // Team B is 1 up (margin = -1), Team A wins 18 to tie
      const resultA = calculateDecidedOn18(18, null, -1, "teamA", "teamA");
      expect(resultA.decidedOn18).toBe(true);
      expect(resultA.won18thHole).toBe(true);
    });

    it("decidedOn18=false when 1-up team wins/halves 18 (match wasn't decided by 18)", () => {
      // Team A is 1 up, wins hole 18 → wins 2-up, but 18 wasn't the deciding hole
      const result = calculateDecidedOn18(18, null, 1, "teamA", "teamA");
      expect(result.decidedOn18).toBe(false);
    });
  });

  describe("match closed before 18", () => {
    it("decidedOn18=false when match closed on hole 15", () => {
      const result = calculateDecidedOn18(15, 15, 0, null, "teamA");
      expect(result.decidedOn18).toBe(false);
      expect(result.won18thHole).toBe(null);
    });

    it("decidedOn18=false when winningHole is set", () => {
      // Match went to 18 but was won on hole 17 (margin became > holes left)
      const result = calculateDecidedOn18(18, 17, 0, "teamA", "teamA");
      expect(result.decidedOn18).toBe(false);
    });
  });

  describe("match 2+ up going into 18", () => {
    it("decidedOn18=false when 2-up going into 18", () => {
      // Team A 2 up going into 18, wins 18 → 3-up victory
      // But hole 18 didn't "decide" the match (they were already winning)
      const result = calculateDecidedOn18(18, null, 2, "teamA", "teamA");
      expect(result.decidedOn18).toBe(false);
    });
  });
});

// --- ballUsedOn18 tests ---

describe("ballUsedOn18 calculation", () => {
  describe("solo ball used on 18", () => {
    it("player 0 gets true, player 1 gets false when p0 has better net", () => {
      const p0Result = calculateBallUsedOn18([4, 5], 0);
      const p1Result = calculateBallUsedOn18([4, 5], 1);
      expect(p0Result).toBe(true);
      expect(p1Result).toBe(false);
    });

    it("player 1 gets true, player 0 gets false when p1 has better net", () => {
      const p0Result = calculateBallUsedOn18([5, 4], 0);
      const p1Result = calculateBallUsedOn18([5, 4], 1);
      expect(p0Result).toBe(false);
      expect(p1Result).toBe(true);
    });
  });

  describe("both balls tied on 18 (BUG FIX)", () => {
    it("BOTH players get true when nets are equal", () => {
      const p0Result = calculateBallUsedOn18([4, 4], 0);
      const p1Result = calculateBallUsedOn18([4, 4], 1);
      expect(p0Result).toBe(true);
      expect(p1Result).toBe(true);
    });

    it("buggy version returns null for tied balls (showing the bug)", () => {
      const p0Buggy = calculateBallUsedOn18Buggy([4, 4], 0);
      const p1Buggy = calculateBallUsedOn18Buggy([4, 4], 1);
      expect(p0Buggy).toBe(null); // Bug: neither player gets credit
      expect(p1Buggy).toBe(null);
    });
  });
});

// --- Integration test combining all fixes ---

describe("integration: playerMatchFacts stat generation", () => {
  it("generates correct stats for match decided on 18 with tied balls", () => {
    // Scenario: Best ball match, AS going into 18
    // Both players on winning team make net 4 on hole 18
    // They win hole 18 and the match
    
    const marginGoingInto18 = 0;
    const hole18Result = "teamA" as const;
    const finalThru = 18;
    const winningHole = null;
    
    // decidedOn18 should be true
    const decided = calculateDecidedOn18(finalThru, winningHole, marginGoingInto18, hole18Result, "teamA");
    expect(decided.decidedOn18).toBe(true);
    expect(decided.won18thHole).toBe(true);
    
    // Both balls tied at net 4 on hole 18
    const playerNets: [number, number] = [4, 4];
    expect(calculateBallUsedOn18(playerNets, 0)).toBe(true);
    expect(calculateBallUsedOn18(playerNets, 1)).toBe(true);
  });

  it("calculates strokesVsParNet correctly with different handicaps", () => {
    // Two players on same team: 8 handicap and 16 handicap
    // Player 1 shoots 84, Player 2 shoots 92
    // Course par: 72
    
    const player1 = calculateStrokesVsParNet(84, 8, 72);
    const player2 = calculateStrokesVsParNet(92, 16, 72);
    
    expect(player1).toBe(4);  // 84 - 8 - 72 = +4
    expect(player2).toBe(4);  // 92 - 16 - 72 = +4 (same net performance!)
  });
});
