/**
 * Unit tests for Birdie & Eagle counting in playerMatchFacts
 * 
 * Birdie = gross score 1 under par (diff = -1)
 * Eagle = gross score 2+ under par (diff <= -2)
 * 
 * Format-specific attribution:
 * - singles: Individual gross scores → individual attribution
 * - twoManBestBall: Individual gross scores → individual attribution  
 * - twoManShamble: Individual gross scores → individual attribution
 * - twoManScramble: Team gross scores → ALL team members get credit (team-wide attribution)
 */

import { describe, it, expect } from "vitest";

// --- TYPES ---

type HoleData = {
  hole: number;
  par: number;
  gross: number | null;
};

type PlayerHoleDataScramble = {
  hole: number;
  par: number;
  teamGross: number | null;
  driveUsed: boolean; // Not used for attribution anymore
};

// --- HELPER FUNCTIONS ---

/**
 * Count birdies and eagles for individual formats (singles, bestBall, shamble)
 * Each player's gross is compared to par
 */
function countBirdiesEaglesIndividual(holes: HoleData[]): { birdies: number; eagles: number } {
  let birdies = 0;
  let eagles = 0;
  
  for (const hole of holes) {
    if (hole.gross != null) {
      const diff = hole.gross - hole.par;
      if (diff === -1) birdies++;
      else if (diff <= -2) eagles++;
    }
  }
  
  return { birdies, eagles };
}

/**
 * Count birdies and eagles for scramble format
 * ALL team members get credit for team birdies/eagles
 * (not based on driveUsed - that was the old incorrect logic)
 */
function countBirdiesEaglesScramble(holes: PlayerHoleDataScramble[]): { birdies: number; eagles: number } {
  let birdies = 0;
  let eagles = 0;
  
  for (const hole of holes) {
    if (hole.teamGross != null) {
      const diff = hole.teamGross - hole.par;
      if (diff === -1) birdies++;
      else if (diff <= -2) eagles++;
    }
  }
  
  return { birdies, eagles };
}

/**
 * DEPRECATED: Old incorrect logic that attributed based on driveUsed
 * Kept for comparison tests to show the bug
 */
function countBirdiesEaglesScrambleOld(holes: PlayerHoleDataScramble[]): { birdies: number; eagles: number } {
  let birdies = 0;
  let eagles = 0;
  
  for (const hole of holes) {
    // Bug: Only counted if player's drive was used
    if (hole.driveUsed && hole.teamGross != null) {
      const diff = hole.teamGross - hole.par;
      if (diff === -1) birdies++;
      else if (diff <= -2) eagles++;
    }
  }
  
  return { birdies, eagles };
}

// --- TESTS ---

describe("Birdie & Eagle counting - Individual formats", () => {
  describe("singles format", () => {
    it("counts one birdie correctly", () => {
      const holes: HoleData[] = [
        { hole: 1, par: 4, gross: 3 }, // birdie
        { hole: 2, par: 4, gross: 4 }, // par
        { hole: 3, par: 4, gross: 5 }, // bogey
      ];
      const result = countBirdiesEaglesIndividual(holes);
      expect(result.birdies).toBe(1);
      expect(result.eagles).toBe(0);
    });

    it("counts one eagle correctly", () => {
      const holes: HoleData[] = [
        { hole: 1, par: 4, gross: 2 }, // eagle
        { hole: 2, par: 4, gross: 4 }, // par
        { hole: 3, par: 4, gross: 5 }, // bogey
      ];
      const result = countBirdiesEaglesIndividual(holes);
      expect(result.birdies).toBe(0);
      expect(result.eagles).toBe(1);
    });

    it("counts multiple birdies and eagles correctly", () => {
      const holes: HoleData[] = [
        { hole: 1, par: 4, gross: 3 },  // birdie
        { hole: 2, par: 5, gross: 3 },  // eagle
        { hole: 3, par: 3, gross: 2 },  // birdie
        { hole: 4, par: 4, gross: 4 },  // par
        { hole: 5, par: 5, gross: 4 },  // birdie
        { hole: 6, par: 4, gross: 2 },  // eagle
      ];
      const result = countBirdiesEaglesIndividual(holes);
      expect(result.birdies).toBe(3);
      expect(result.eagles).toBe(2);
    });

    it("counts hole-in-one on par 3 as eagle", () => {
      const holes: HoleData[] = [
        { hole: 1, par: 3, gross: 1 }, // hole-in-one = 2 under = eagle
      ];
      const result = countBirdiesEaglesIndividual(holes);
      expect(result.birdies).toBe(0);
      expect(result.eagles).toBe(1);
    });

    it("counts hole-in-one on par 4 as double eagle (counted as eagle)", () => {
      const holes: HoleData[] = [
        { hole: 1, par: 4, gross: 1 }, // hole-in-one = 3 under = albatross/double eagle
      ];
      const result = countBirdiesEaglesIndividual(holes);
      expect(result.birdies).toBe(0);
      expect(result.eagles).toBe(1); // <= -2 counts as eagle
    });

    it("counts albatross (double eagle) on par 5 as eagle", () => {
      const holes: HoleData[] = [
        { hole: 1, par: 5, gross: 2 }, // 3 under = albatross
      ];
      const result = countBirdiesEaglesIndividual(holes);
      expect(result.birdies).toBe(0);
      expect(result.eagles).toBe(1);
    });

    it("returns zero for all pars", () => {
      const holes: HoleData[] = [
        { hole: 1, par: 4, gross: 4 },
        { hole: 2, par: 3, gross: 3 },
        { hole: 3, par: 5, gross: 5 },
      ];
      const result = countBirdiesEaglesIndividual(holes);
      expect(result.birdies).toBe(0);
      expect(result.eagles).toBe(0);
    });

    it("returns zero for all bogeys or worse", () => {
      const holes: HoleData[] = [
        { hole: 1, par: 4, gross: 5 }, // bogey
        { hole: 2, par: 4, gross: 6 }, // double bogey
        { hole: 3, par: 4, gross: 8 }, // quad bogey
      ];
      const result = countBirdiesEaglesIndividual(holes);
      expect(result.birdies).toBe(0);
      expect(result.eagles).toBe(0);
    });

    it("handles null gross scores (incomplete holes)", () => {
      const holes: HoleData[] = [
        { hole: 1, par: 4, gross: 3 }, // birdie
        { hole: 2, par: 4, gross: null }, // not yet entered
        { hole: 3, par: 4, gross: 2 }, // eagle
      ];
      const result = countBirdiesEaglesIndividual(holes);
      expect(result.birdies).toBe(1);
      expect(result.eagles).toBe(1);
    });

    it("counts realistic 18-hole round with mixed results", () => {
      const holes: HoleData[] = [
        { hole: 1, par: 4, gross: 4 },   // par
        { hole: 2, par: 4, gross: 5 },   // bogey
        { hole: 3, par: 5, gross: 4 },   // birdie
        { hole: 4, par: 3, gross: 3 },   // par
        { hole: 5, par: 4, gross: 4 },   // par
        { hole: 6, par: 5, gross: 3 },   // eagle
        { hole: 7, par: 3, gross: 2 },   // birdie
        { hole: 8, par: 4, gross: 5 },   // bogey
        { hole: 9, par: 4, gross: 4 },   // par
        { hole: 10, par: 4, gross: 3 },  // birdie
        { hole: 11, par: 3, gross: 4 },  // bogey
        { hole: 12, par: 5, gross: 5 },  // par
        { hole: 13, par: 4, gross: 3 },  // birdie
        { hole: 14, par: 4, gross: 4 },  // par
        { hole: 15, par: 4, gross: 6 },  // double bogey
        { hole: 16, par: 3, gross: 2 },  // birdie
        { hole: 17, par: 4, gross: 4 },  // par
        { hole: 18, par: 5, gross: 4 },  // birdie
      ];
      const result = countBirdiesEaglesIndividual(holes);
      expect(result.birdies).toBe(6);
      expect(result.eagles).toBe(1);
    });
  });

  describe("twoManBestBall format", () => {
    it("counts individual player birdies regardless of partner", () => {
      // Player 0 makes birdie, player 1 makes par
      // Player 0 should get credit for birdie
      const player0Holes: HoleData[] = [
        { hole: 1, par: 4, gross: 3 }, // birdie
      ];
      const player1Holes: HoleData[] = [
        { hole: 1, par: 4, gross: 4 }, // par
      ];
      
      const result0 = countBirdiesEaglesIndividual(player0Holes);
      const result1 = countBirdiesEaglesIndividual(player1Holes);
      
      expect(result0.birdies).toBe(1);
      expect(result1.birdies).toBe(0);
    });

    it("both players can get birdies on same hole", () => {
      // Both players birdie the same hole
      const player0Holes: HoleData[] = [{ hole: 1, par: 4, gross: 3 }];
      const player1Holes: HoleData[] = [{ hole: 1, par: 4, gross: 3 }];
      
      const result0 = countBirdiesEaglesIndividual(player0Holes);
      const result1 = countBirdiesEaglesIndividual(player1Holes);
      
      expect(result0.birdies).toBe(1);
      expect(result1.birdies).toBe(1);
    });

    it("player making double bogey still gets credit if they birdie elsewhere", () => {
      const playerHoles: HoleData[] = [
        { hole: 1, par: 4, gross: 6 }, // double bogey
        { hole: 2, par: 4, gross: 3 }, // birdie
      ];
      const result = countBirdiesEaglesIndividual(playerHoles);
      expect(result.birdies).toBe(1);
      expect(result.eagles).toBe(0);
    });
  });

  describe("twoManShamble format", () => {
    it("counts individual gross birdies (no strokes in shamble)", () => {
      const playerHoles: HoleData[] = [
        { hole: 1, par: 4, gross: 3 }, // birdie
        { hole: 2, par: 5, gross: 4 }, // birdie
        { hole: 3, par: 3, gross: 3 }, // par
      ];
      const result = countBirdiesEaglesIndividual(playerHoles);
      expect(result.birdies).toBe(2);
      expect(result.eagles).toBe(0);
    });

    it("counts eagle for 2 under on any par", () => {
      const playerHoles: HoleData[] = [
        { hole: 1, par: 4, gross: 2 }, // eagle
        { hole: 2, par: 5, gross: 3 }, // eagle
      ];
      const result = countBirdiesEaglesIndividual(playerHoles);
      expect(result.birdies).toBe(0);
      expect(result.eagles).toBe(2);
    });
  });
});

describe("Birdie & Eagle counting - Scramble format (team-wide attribution)", () => {
  describe("correct attribution: all team members get credit", () => {
    it("both players get credit for team birdie", () => {
      const holes: PlayerHoleDataScramble[] = [
        { hole: 1, par: 4, teamGross: 3, driveUsed: true },
      ];
      
      // Player 0 (drive was used)
      const result0 = countBirdiesEaglesScramble(holes);
      // Player 1 (drive was NOT used) - should still get credit!
      const holes1 = holes.map(h => ({ ...h, driveUsed: false }));
      const result1 = countBirdiesEaglesScramble(holes1);
      
      expect(result0.birdies).toBe(1);
      expect(result1.birdies).toBe(1);
    });

    it("both players get credit for team eagle", () => {
      const holes: PlayerHoleDataScramble[] = [
        { hole: 1, par: 4, teamGross: 2, driveUsed: true },
      ];
      
      const result0 = countBirdiesEaglesScramble(holes);
      const holes1 = holes.map(h => ({ ...h, driveUsed: false }));
      const result1 = countBirdiesEaglesScramble(holes1);
      
      expect(result0.eagles).toBe(1);
      expect(result1.eagles).toBe(1);
    });

    it("counts multiple team birdies for both players", () => {
      const holes: PlayerHoleDataScramble[] = [
        { hole: 1, par: 4, teamGross: 3, driveUsed: true },  // birdie
        { hole: 2, par: 5, teamGross: 4, driveUsed: false }, // birdie
        { hole: 3, par: 3, teamGross: 2, driveUsed: true },  // birdie
      ];
      
      // Player 0 only has driveUsed on holes 1 and 3
      const result = countBirdiesEaglesScramble(holes);
      expect(result.birdies).toBe(3); // All 3 team birdies credited
    });

    it("returns zero birdies for all pars", () => {
      const holes: PlayerHoleDataScramble[] = [
        { hole: 1, par: 4, teamGross: 4, driveUsed: true },
        { hole: 2, par: 3, teamGross: 3, driveUsed: false },
        { hole: 3, par: 5, teamGross: 5, driveUsed: true },
      ];
      const result = countBirdiesEaglesScramble(holes);
      expect(result.birdies).toBe(0);
      expect(result.eagles).toBe(0);
    });
  });

  describe("incorrect old logic (driveUsed-based) - for comparison", () => {
    it("OLD BUG: player without drive would miss birdie credit", () => {
      const holes: PlayerHoleDataScramble[] = [
        { hole: 1, par: 4, teamGross: 3, driveUsed: false }, // birdie, but drive NOT used
      ];
      
      const oldResult = countBirdiesEaglesScrambleOld(holes);
      const newResult = countBirdiesEaglesScramble(holes);
      
      expect(oldResult.birdies).toBe(0); // Bug: player got no credit
      expect(newResult.birdies).toBe(1); // Fixed: player gets credit
    });

    it("OLD BUG: uneven birdie distribution when drives alternated", () => {
      const holesPlayer0: PlayerHoleDataScramble[] = [
        { hole: 1, par: 4, teamGross: 3, driveUsed: true },  // birdie, drive used
        { hole: 2, par: 4, teamGross: 3, driveUsed: false }, // birdie, drive NOT used
        { hole: 3, par: 4, teamGross: 3, driveUsed: true },  // birdie, drive used
        { hole: 4, par: 4, teamGross: 3, driveUsed: false }, // birdie, drive NOT used
      ];
      
      const holesPlayer1: PlayerHoleDataScramble[] = [
        { hole: 1, par: 4, teamGross: 3, driveUsed: false }, // birdie, drive NOT used
        { hole: 2, par: 4, teamGross: 3, driveUsed: true },  // birdie, drive used
        { hole: 3, par: 4, teamGross: 3, driveUsed: false }, // birdie, drive NOT used
        { hole: 4, par: 4, teamGross: 3, driveUsed: true },  // birdie, drive used
      ];
      
      // Old logic: only 2 birdies each (based on driveUsed)
      const oldResult0 = countBirdiesEaglesScrambleOld(holesPlayer0);
      const oldResult1 = countBirdiesEaglesScrambleOld(holesPlayer1);
      
      // New logic: all 4 birdies credited to both
      const newResult0 = countBirdiesEaglesScramble(holesPlayer0);
      const newResult1 = countBirdiesEaglesScramble(holesPlayer1);
      
      expect(oldResult0.birdies).toBe(2); // Bug: only counted 2
      expect(oldResult1.birdies).toBe(2); // Bug: only counted 2
      expect(newResult0.birdies).toBe(4); // Fixed: all 4 counted
      expect(newResult1.birdies).toBe(4); // Fixed: all 4 counted
    });
  });

  describe("edge cases for scramble", () => {
    it("handles hole-in-one (eagle on par 3)", () => {
      const holes: PlayerHoleDataScramble[] = [
        { hole: 1, par: 3, teamGross: 1, driveUsed: true },
      ];
      const result = countBirdiesEaglesScramble(holes);
      expect(result.birdies).toBe(0);
      expect(result.eagles).toBe(1);
    });

    it("handles albatross on par 5", () => {
      const holes: PlayerHoleDataScramble[] = [
        { hole: 1, par: 5, teamGross: 2, driveUsed: false },
      ];
      const result = countBirdiesEaglesScramble(holes);
      expect(result.birdies).toBe(0);
      expect(result.eagles).toBe(1);
    });

    it("handles null team gross (incomplete holes)", () => {
      const holes: PlayerHoleDataScramble[] = [
        { hole: 1, par: 4, teamGross: 3, driveUsed: true },  // birdie
        { hole: 2, par: 4, teamGross: null, driveUsed: false }, // not entered
        { hole: 3, par: 4, teamGross: 2, driveUsed: true },  // eagle
      ];
      const result = countBirdiesEaglesScramble(holes);
      expect(result.birdies).toBe(1);
      expect(result.eagles).toBe(1);
    });

    it("realistic 18-hole scramble with good team score", () => {
      // Team shoots 62 (-10) with lots of birdies
      const holes: PlayerHoleDataScramble[] = [
        { hole: 1, par: 4, teamGross: 3, driveUsed: true },   // birdie
        { hole: 2, par: 4, teamGross: 4, driveUsed: false },  // par
        { hole: 3, par: 5, teamGross: 4, driveUsed: true },   // birdie
        { hole: 4, par: 3, teamGross: 2, driveUsed: false },  // birdie
        { hole: 5, par: 4, teamGross: 3, driveUsed: true },   // birdie
        { hole: 6, par: 5, teamGross: 3, driveUsed: false },  // eagle
        { hole: 7, par: 3, teamGross: 3, driveUsed: true },   // par
        { hole: 8, par: 4, teamGross: 4, driveUsed: false },  // par
        { hole: 9, par: 4, teamGross: 3, driveUsed: true },   // birdie
        { hole: 10, par: 4, teamGross: 3, driveUsed: false }, // birdie
        { hole: 11, par: 3, teamGross: 2, driveUsed: true },  // birdie
        { hole: 12, par: 5, teamGross: 4, driveUsed: false }, // birdie
        { hole: 13, par: 4, teamGross: 4, driveUsed: true },  // par
        { hole: 14, par: 4, teamGross: 4, driveUsed: false }, // par
        { hole: 15, par: 4, teamGross: 3, driveUsed: true },  // birdie
        { hole: 16, par: 3, teamGross: 2, driveUsed: false }, // birdie
        { hole: 17, par: 4, teamGross: 4, driveUsed: true },  // par
        { hole: 18, par: 5, teamGross: 4, driveUsed: false }, // birdie
      ];
      const result = countBirdiesEaglesScramble(holes);
      expect(result.birdies).toBe(11);
      expect(result.eagles).toBe(1);
      
      // Both players should get same count regardless of driveUsed pattern
      const holesOtherPlayer = holes.map(h => ({ ...h, driveUsed: !h.driveUsed }));
      const resultOther = countBirdiesEaglesScramble(holesOtherPlayer);
      expect(resultOther.birdies).toBe(11);
      expect(resultOther.eagles).toBe(1);
    });
  });
});

describe("Integration: Birdie & Eagle in holePerformance array", () => {
  /**
   * This simulates how the Cloud Function builds holePerformance
   * and counts birdies/eagles from it
   */
  
  type HolePerformance = {
    hole: number;
    par: number;
    result: 'win' | 'loss' | 'halve' | null;
    gross: number | null;
    strokes?: 0 | 1;
    net?: number;
    driveUsed?: boolean;
    partnerNet?: number;
    partnerGross?: number;
  };
  
  function countFromHolePerformance(
    holePerformance: HolePerformance[],
    format: 'singles' | 'twoManBestBall' | 'twoManShamble' | 'twoManScramble'
  ): { birdies: number; eagles: number } {
    let birdies = 0;
    let eagles = 0;
    
    for (const hp of holePerformance) {
      if (hp.gross != null && hp.par != null) {
        // For scramble, ALL team members get credit for team birdies/eagles
        // For other formats, individual gross is compared to par
        const diff = hp.gross - hp.par;
        if (diff === -1) birdies++;
        else if (diff <= -2) eagles++;
      }
    }
    
    return { birdies, eagles };
  }
  
  it("singles: counts from individual holePerformance", () => {
    const holePerformance: HolePerformance[] = [
      { hole: 1, par: 4, result: 'win', gross: 3, strokes: 0, net: 3 },  // birdie
      { hole: 2, par: 4, result: 'loss', gross: 5, strokes: 1, net: 4 }, // bogey gross
      { hole: 3, par: 5, result: 'win', gross: 3, strokes: 0, net: 3 },  // eagle
    ];
    const result = countFromHolePerformance(holePerformance, 'singles');
    expect(result.birdies).toBe(1);
    expect(result.eagles).toBe(1);
  });
  
  it("twoManBestBall: counts from individual holePerformance", () => {
    const holePerformance: HolePerformance[] = [
      { hole: 1, par: 4, result: 'win', gross: 3, strokes: 1, net: 2, partnerNet: 4 },  // birdie
      { hole: 2, par: 4, result: 'halve', gross: 4, strokes: 0, net: 4, partnerNet: 3 }, // par
    ];
    const result = countFromHolePerformance(holePerformance, 'twoManBestBall');
    expect(result.birdies).toBe(1);
    expect(result.eagles).toBe(0);
  });
  
  it("twoManShamble: counts from individual holePerformance", () => {
    const holePerformance: HolePerformance[] = [
      { hole: 1, par: 4, result: 'win', gross: 3, driveUsed: true, partnerGross: 5 },  // birdie
      { hole: 2, par: 5, result: 'halve', gross: 3, driveUsed: false, partnerGross: 4 }, // eagle
    ];
    const result = countFromHolePerformance(holePerformance, 'twoManShamble');
    expect(result.birdies).toBe(1);
    expect(result.eagles).toBe(1);
  });
  
  it("twoManScramble: team gross applies to both players", () => {
    // In scramble, the holePerformance.gross IS the team gross
    // Both players on the team have identical holePerformance arrays
    const holePerformancePlayer0: HolePerformance[] = [
      { hole: 1, par: 4, result: 'win', gross: 3, driveUsed: true },  // birdie
      { hole: 2, par: 4, result: 'halve', gross: 4, driveUsed: false }, // par
    ];
    const holePerformancePlayer1: HolePerformance[] = [
      { hole: 1, par: 4, result: 'win', gross: 3, driveUsed: false },  // same team gross!
      { hole: 2, par: 4, result: 'halve', gross: 4, driveUsed: true },
    ];
    
    const result0 = countFromHolePerformance(holePerformancePlayer0, 'twoManScramble');
    const result1 = countFromHolePerformance(holePerformancePlayer1, 'twoManScramble');
    
    expect(result0.birdies).toBe(1);
    expect(result1.birdies).toBe(1);
    expect(result0).toEqual(result1); // Both players have same counts
  });
});

describe("Edge cases and boundary conditions", () => {
  it("zero birdies/eagles for empty holes array", () => {
    const result = countBirdiesEaglesIndividual([]);
    expect(result.birdies).toBe(0);
    expect(result.eagles).toBe(0);
  });
  
  it("handles exactly par on all holes", () => {
    const holes: HoleData[] = Array.from({ length: 18 }, (_, i) => ({
      hole: i + 1,
      par: 4,
      gross: 4,
    }));
    const result = countBirdiesEaglesIndividual(holes);
    expect(result.birdies).toBe(0);
    expect(result.eagles).toBe(0);
  });
  
  it("handles all bogeys (never under par)", () => {
    const holes: HoleData[] = Array.from({ length: 18 }, (_, i) => ({
      hole: i + 1,
      par: 4,
      gross: 5,
    }));
    const result = countBirdiesEaglesIndividual(holes);
    expect(result.birdies).toBe(0);
    expect(result.eagles).toBe(0);
  });
  
  it("handles dream round of all birdies", () => {
    const holes: HoleData[] = Array.from({ length: 18 }, (_, i) => ({
      hole: i + 1,
      par: 4,
      gross: 3,
    }));
    const result = countBirdiesEaglesIndividual(holes);
    expect(result.birdies).toBe(18);
    expect(result.eagles).toBe(0);
  });
  
  it("handles impossible round of all eagles", () => {
    const holes: HoleData[] = Array.from({ length: 18 }, (_, i) => ({
      hole: i + 1,
      par: 4,
      gross: 2,
    }));
    const result = countBirdiesEaglesIndividual(holes);
    expect(result.birdies).toBe(0);
    expect(result.eagles).toBe(18);
  });
  
  it("distinguishes birdie (-1) from eagle (-2) at boundary", () => {
    const holes: HoleData[] = [
      { hole: 1, par: 4, gross: 3 },  // -1 = birdie
      { hole: 2, par: 4, gross: 2 },  // -2 = eagle
      { hole: 3, par: 5, gross: 4 },  // -1 = birdie
      { hole: 4, par: 5, gross: 3 },  // -2 = eagle
      { hole: 5, par: 3, gross: 2 },  // -1 = birdie
      { hole: 6, par: 3, gross: 1 },  // -2 = eagle (hole in one!)
    ];
    const result = countBirdiesEaglesIndividual(holes);
    expect(result.birdies).toBe(3);
    expect(result.eagles).toBe(3);
  });
  
  it("correctly handles par 3, 4, and 5 holes", () => {
    const holes: HoleData[] = [
      // Par 3s
      { hole: 1, par: 3, gross: 2 },  // birdie
      { hole: 2, par: 3, gross: 1 },  // eagle (ace)
      // Par 4s  
      { hole: 3, par: 4, gross: 3 },  // birdie
      { hole: 4, par: 4, gross: 2 },  // eagle
      // Par 5s
      { hole: 5, par: 5, gross: 4 },  // birdie
      { hole: 6, par: 5, gross: 3 },  // eagle
      { hole: 7, par: 5, gross: 2 },  // albatross (counted as eagle)
    ];
    const result = countBirdiesEaglesIndividual(holes);
    expect(result.birdies).toBe(3);
    expect(result.eagles).toBe(4);
  });
});
