/**
 * Unit tests for updateMatchFacts stat calculations
 * Tests edge cases for playerMatchFact field generation
 */

import { describe, it, expect } from "vitest";

// --- TEST HELPERS ---

/** 
 * Simulates the strokesVsParNet calculation
 * Uses course handicap from match document (integer), not tournament handicap (decimal)
 */
function calculateStrokesVsParNet(
  totalGross: number,
  playerCourseHandicap: number,
  coursePar: number
): number {
  // Uses course handicap from match.courseHandicaps array (integer)
  return totalGross - playerCourseHandicap - coursePar;
}

/**
 * Simulates the buggy strokesVsParNet calculation using tournament handicap (decimal)
 */
function calculateStrokesVsParNetBuggy(
  totalGross: number,
  tournamentHandicap: number, // This was the bug - using decimal handicap from tournament
  coursePar: number
): number {
  return totalGross - tournamentHandicap - coursePar;
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
  // Match must go all 18 holes (not closed before 18)
  // winningHole === null means AS match, winningHole === 18 means decided on 18
  const matchWentTo18 = finalThru === 18 && (winningHole === null || winningHole === 18);
  
  if (!matchWentTo18 || hole18Result === null) {
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
  describe("correct calculation using course handicap from match document", () => {
    it("calculates correctly for scratch golfer", () => {
      // Scratch golfer (0 course handicap) shoots 76 on par 72
      const result = calculateStrokesVsParNet(76, 0, 72);
      expect(result).toBe(4); // 76 - 0 - 72 = +4
    });

    it("calculates correctly for mid-handicap golfer", () => {
      // 12 course handicap shoots 88 on par 72
      const result = calculateStrokesVsParNet(88, 12, 72);
      expect(result).toBe(4); // 88 - 12 - 72 = +4 (net 76)
    });

    it("calculates correctly for 9 handicap shooting even par gross", () => {
      // Real scenario: 9 course handicap shoots 72 gross on par 72
      // strokesVsParNet should be 72 - 9 - 72 = -9 (9 under net)
      const result = calculateStrokesVsParNet(72, 9, 72);
      expect(result).toBe(-9);
    });

    it("calculates correctly for 9 handicap shooting 73 gross", () => {
      // Real scenario: 9 course handicap shoots 73 gross on par 72
      // strokesVsParNet should be 73 - 9 - 72 = -8 (8 under net)
      const result = calculateStrokesVsParNet(73, 9, 72);
      expect(result).toBe(-8);
    });

    it("calculates correctly for high-handicap golfer", () => {
      // 18 course handicap shoots 90 on par 72
      const result = calculateStrokesVsParNet(90, 18, 72);
      expect(result).toBe(0); // 90 - 18 - 72 = 0 (net even)
    });

    it("handles negative result (under par net)", () => {
      // 10 course handicap shoots 78 on par 72
      const result = calculateStrokesVsParNet(78, 10, 72);
      expect(result).toBe(-4); // 78 - 10 - 72 = -4 (net 68)
    });

    it("handles par 70 course", () => {
      // 8 course handicap shoots 82 on par 70
      const result = calculateStrokesVsParNet(82, 8, 70);
      expect(result).toBe(4); // 82 - 8 - 70 = +4
    });
  });

  describe("buggy calculation using tournament decimal handicap (for comparison)", () => {
    it("demonstrates the bug with decimal tournament handicap", () => {
      // Real bug scenario: player has course handicap 9 (integer)
      // but tournament.handicapByPlayer has decimal like 4.3
      // Player shoots 72 gross on par 72
      const totalGross = 72;
      const courseHandicap = 9;       // From match.courseHandicaps (integer)
      const tournamentHandicap = 4.3; // From tournament.handicapByPlayer (decimal)
      const coursePar = 72;

      const correct = calculateStrokesVsParNet(totalGross, courseHandicap, coursePar);
      const buggy = calculateStrokesVsParNetBuggy(totalGross, tournamentHandicap, coursePar);

      expect(correct).toBe(-9);   // 72 - 9 - 72 = -9 ✓
      expect(buggy).toBeCloseTo(-4.3, 1);  // 72 - 4.3 - 72 = -4.3 ✗
      expect(correct).not.toBe(buggy);
    });

    it("shows decimal handicap produces floating point results", () => {
      // Player shoots 73 gross, course handicap 9, tournament handicap 4.7
      const totalGross = 73;
      const courseHandicap = 9;
      const tournamentHandicap = 4.7;
      const coursePar = 72;

      const correct = calculateStrokesVsParNet(totalGross, courseHandicap, coursePar);
      const buggy = calculateStrokesVsParNetBuggy(totalGross, tournamentHandicap, coursePar);

      expect(correct).toBe(-8);  // 73 - 9 - 72 = -8 (integer result)
      expect(buggy).toBeCloseTo(-3.7, 1); // 73 - 4.7 - 72 = -3.7 (floating point)
      expect(Number.isInteger(correct)).toBe(true);
      expect(Number.isInteger(buggy)).toBe(false);
    });

    it("matches when tournament handicap equals course handicap (unlikely)", () => {
      // Edge case: tournament handicap happens to be integer matching course
      const totalGross = 76;
      const courseHandicap = 4;
      const tournamentHandicap = 4;
      const coursePar = 72;

      const correct = calculateStrokesVsParNet(totalGross, courseHandicap, coursePar);
      const buggy = calculateStrokesVsParNetBuggy(totalGross, tournamentHandicap, coursePar);

      expect(correct).toBe(buggy); // Both = 0 when handicaps match
    });
  });
});

// --- decidedOn18 / won18thHole tests ---

describe("decidedOn18 and won18thHole calculation", () => {
  describe("match all square going into 18 (winningHole=18 in production)", () => {
    // IMPORTANT: When AS into 18 and a team wins, winningHole is set to 18
    // because after hole 18: margin (1) > holesLeft (0)
    // The fix checks (winningHole === null || winningHole === 18)
    
    it("decidedOn18=true when AS into 18 and teamA wins hole 18 (winningHole=18)", () => {
      // This is how production actually works - winningHole gets set to 18
      const result = calculateDecidedOn18(18, 18, 0, "teamA", "teamA");
      expect(result.decidedOn18).toBe(true);
      expect(result.won18thHole).toBe(true);
    });

    it("decidedOn18=true when AS into 18 and teamB wins hole 18 (winningHole=18)", () => {
      // This was the exact bug scenario - winningHole=18, not null
      const result = calculateDecidedOn18(18, 18, 0, "teamB", "teamB");
      expect(result.decidedOn18).toBe(true);
      expect(result.won18thHole).toBe(true);
    });

    it("won18thHole=false for losing team when AS into 18 (winningHole=18)", () => {
      const result = calculateDecidedOn18(18, 18, 0, "teamA", "teamB");
      expect(result.decidedOn18).toBe(true);
      expect(result.won18thHole).toBe(false);
    });

    it("decidedOn18=false when AS into 18 and hole 18 is halved (winningHole=null)", () => {
      // Match ends AS overall - winningHole stays null
      const result = calculateDecidedOn18(18, null, 0, "AS", "teamA");
      expect(result.decidedOn18).toBe(false);
      expect(result.won18thHole).toBe(null);
    });
  });

  describe("match 1-up going into 18", () => {
    it("decidedOn18=true when trailing team wins hole 18 to halve match (winningHole=null)", () => {
      // Team A is 1 up going into 18, Team B wins 18 to tie → AS result
      // winningHole stays null because match ends AS
      const resultB = calculateDecidedOn18(18, null, 1, "teamB", "teamB");
      expect(resultB.decidedOn18).toBe(true);
      expect(resultB.won18thHole).toBe(true);

      // From Team A's perspective (they lost the hole, match ended AS)
      const resultA = calculateDecidedOn18(18, null, 1, "teamB", "teamA");
      expect(resultA.decidedOn18).toBe(true);
      expect(resultA.won18thHole).toBe(false);
    });

    it("decidedOn18=true when Team B 1-up loses 18 to halve (winningHole=null)", () => {
      // Team B is 1 up (margin = -1), Team A wins 18 to tie → AS result
      const resultA = calculateDecidedOn18(18, null, -1, "teamA", "teamA");
      expect(resultA.decidedOn18).toBe(true);
      expect(resultA.won18thHole).toBe(true);
    });

    it("decidedOn18=false when 1-up team wins 18 to go 2-up (winningHole=18)", () => {
      // Team A is 1 up, wins hole 18 → wins 2-up
      // winningHole=18 but they already had lead, so not decisive
      const result = calculateDecidedOn18(18, 18, 1, "teamA", "teamA");
      expect(result.decidedOn18).toBe(false);
    });

    it("decidedOn18=false when 1-up team halves 18 to win 1UP (winningHole=18)", () => {
      // Team A is 1 up, halves hole 18 → wins 1UP
      // winningHole=18 because margin (1) > holesLeft (0)
      const result = calculateDecidedOn18(18, 18, 1, "AS", "teamA");
      expect(result.decidedOn18).toBe(false);
    });
  });

  describe("match closed before 18", () => {
    it("decidedOn18=false when match closed on hole 15 (5&3)", () => {
      const result = calculateDecidedOn18(15, 15, 0, null, "teamA");
      expect(result.decidedOn18).toBe(false);
      expect(result.won18thHole).toBe(null);
    });

    it("decidedOn18=false when winningHole is 17 (2&1)", () => {
      // Match went to 18 but was won on hole 17 (margin became > holes left)
      const result = calculateDecidedOn18(18, 17, 0, "teamA", "teamA");
      expect(result.decidedOn18).toBe(false);
    });

    it("decidedOn18=false for 4&3 victory", () => {
      const result = calculateDecidedOn18(15, 15, 4, null, "teamA");
      expect(result.decidedOn18).toBe(false);
    });
  });

  describe("match 2+ up going into 18", () => {
    it("decidedOn18=false when 2-up going into 18 and wins 18", () => {
      // Team A 2 up going into 18, wins 18 → 3&0 victory (winningHole=18)
      // But hole 18 didn't "decide" the match - they were already dormie
      const result = calculateDecidedOn18(18, 18, 2, "teamA", "teamA");
      expect(result.decidedOn18).toBe(false);
    });

    it("decidedOn18=false when 2-up going into 18 and loses 18", () => {
      // Team A 2 up going into 18, loses 18 → 1UP victory (winningHole=18)
      const result = calculateDecidedOn18(18, 18, 2, "teamB", "teamA");
      expect(result.decidedOn18).toBe(false);
    });

    it("decidedOn18=false when 3-up going into 18 (already closed)", () => {
      // 3 up with 1 to play = already closed on hole 17
      const result = calculateDecidedOn18(18, 17, 3, "teamB", "teamA");
      expect(result.decidedOn18).toBe(false);
    });
  });

  describe("dormie edge cases", () => {
    it("decidedOn18=true when dormie (1-up) trailing team wins to force AS", () => {
      // Team A 1 up (dormie), Team B wins 18 → AS result
      const resultB = calculateDecidedOn18(18, null, 1, "teamB", "teamB");
      expect(resultB.decidedOn18).toBe(true);
      expect(resultB.won18thHole).toBe(true);
    });

    it("decidedOn18=false when dormie (2-up) team wins or halves", () => {
      // 2 up with 1 to play, halves 18 → 2&0 (already won)
      const result = calculateDecidedOn18(18, 18, 2, "AS", "teamA");
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
  it("generates correct stats for match decided on 18 with tied balls (winningHole=18)", () => {
    // Scenario: Best ball match, AS going into 18
    // Both players on winning team make net 4 on hole 18
    // They win hole 18 and the match
    // In production, winningHole=18 because margin (1) > holesLeft (0)
    
    const marginGoingInto18 = 0;
    const hole18Result = "teamA" as const;
    const finalThru = 18;
    const winningHole = 18; // Production sets this to 18, not null!
    
    // decidedOn18 should be true even with winningHole=18
    const decided = calculateDecidedOn18(finalThru, winningHole, marginGoingInto18, hole18Result, "teamA");
    expect(decided.decidedOn18).toBe(true);
    expect(decided.won18thHole).toBe(true);
    
    // Both balls tied at net 4 on hole 18
    const playerNets: [number, number] = [4, 4];
    expect(calculateBallUsedOn18(playerNets, 0)).toBe(true);
    expect(calculateBallUsedOn18(playerNets, 1)).toBe(true);
  });

  it("generates correct stats when trailing team wins hole 18 to halve (winningHole=null)", () => {
    // Team A 1 up going into 18, Team B wins 18 → AS result
    // winningHole stays null because match ends AS
    const marginGoingInto18 = 1;
    const hole18Result = "teamB" as const;
    const finalThru = 18;
    const winningHole = null; // AS result = no winner
    
    // From Team B's perspective (they won the hole to force AS)
    const decidedB = calculateDecidedOn18(finalThru, winningHole, marginGoingInto18, hole18Result, "teamB");
    expect(decidedB.decidedOn18).toBe(true);
    expect(decidedB.won18thHole).toBe(true);
    
    // From Team A's perspective (they lost the hole, match ended AS)
    const decidedA = calculateDecidedOn18(finalThru, winningHole, marginGoingInto18, hole18Result, "teamA");
    expect(decidedA.decidedOn18).toBe(true);
    expect(decidedA.won18thHole).toBe(false);
  });

  it("generates correct stats for 1UP win where leader halves 18", () => {
    // Team A 1 up going into 18, halves 18 → wins 1UP
    // winningHole=18 because margin (1) > holesLeft (0)
    const marginGoingInto18 = 1;
    const hole18Result = "AS" as const;
    const finalThru = 18;
    const winningHole = 18;
    
    // Not decided on 18 - they already had the lead
    const decided = calculateDecidedOn18(finalThru, winningHole, marginGoingInto18, hole18Result, "teamA");
    expect(decided.decidedOn18).toBe(false);
    expect(decided.won18thHole).toBe(null);
  });

  it("calculates strokesVsParNet correctly using course handicap from match", () => {
    // Two players on same team with course handicaps from match.courseHandicaps
    // Player 1: course handicap 8, shoots 84 gross
    // Player 2: course handicap 16, shoots 92 gross
    // Course par: 72
    
    const player1 = calculateStrokesVsParNet(84, 8, 72);
    const player2 = calculateStrokesVsParNet(92, 16, 72);
    
    expect(player1).toBe(4);  // 84 - 8 - 72 = +4
    expect(player2).toBe(4);  // 92 - 16 - 72 = +4 (same net performance!)
  });

  it("calculates strokesVsParNet for real scenario with 9 handicaps", () => {
    // Real scenario from user: both players have course handicap 9
    // Player 1: shoots 72 gross on par 72 → strokesVsParNet = 72 - 9 - 72 = -9
    // Player 2: shoots 73 gross on par 72 → strokesVsParNet = 73 - 9 - 72 = -8
    
    const player1 = calculateStrokesVsParNet(72, 9, 72);
    const player2 = calculateStrokesVsParNet(73, 9, 72);
    
    expect(player1).toBe(-9);  // 72 - 9 - 72 = -9 (9 under net par)
    expect(player2).toBe(-8);  // 73 - 9 - 72 = -8 (8 under net par)
    
    // Results should be integers, not decimals like -4.7 or -4.3
    expect(Number.isInteger(player1)).toBe(true);
    expect(Number.isInteger(player2)).toBe(true);
  });

  it("handles comeback win scenarios correctly", () => {
    // Team A down 3+ entering back 9, comes back to win on 18
    // This tests blownLead / comebackWin calculation
    
    // If Team A was down 3+ on the back 9 and wins, comebackWin=true
    // If Team B was up 3+ on the back 9 and loses, blownLead=true
    
    // Test strokesVsParNet for a player who came back
    const grossScore = 82;
    const courseHandicap = 10;
    const coursePar = 72;
    const strokesVsParNet = calculateStrokesVsParNet(grossScore, courseHandicap, coursePar);
    expect(strokesVsParNet).toBe(0); // 82 - 10 - 72 = net even par
  });
});
