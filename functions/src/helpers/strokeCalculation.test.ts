import { describe, expect, it } from "vitest";
import { computeTeamsWithStrokes, resolveCourseParams } from "./strokeCalculation";
import { calculateCourseHandicap, calculateStrokesReceived } from "../ghin";
import { DEFAULT_COURSE_PAR } from "../constants";

function courseHoles() {
  // pars sum to 72; hcpIndex shuffled so stroke allocation is non-trivial
  const pars = [4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 4, 3, 5, 4, 4, 3, 5, 4];
  const hcps = [7, 1, 15, 9, 3, 13, 17, 11, 5, 8, 2, 16, 10, 4, 14, 18, 12, 6];
  return pars.map((par, i) => ({ number: i + 1, par, hcpIndex: hcps[i] }));
}

const course = { slope: 130, rating: 71.5, par: 72, holes: courseHoles() };

/**
 * Parity oracle: the exact inline logic the three callables used before the
 * extraction (seedMatch/editMatch/recalculateMatchStrokes in index.ts).
 */
function legacyCompute(
  teamAPlayers: { playerId: string; handicapIndex: number }[],
  teamBPlayers: { playerId: string; handicapIndex: number }[],
  c: { slope?: number; rating?: number; par?: number; holes: ReturnType<typeof courseHoles> }
) {
  const slopeRating = c.slope ?? 113;
  const courseRating = typeof c.rating === "number" ? c.rating : (c.par ?? DEFAULT_COURSE_PAR);
  const coursePar = c.par ?? DEFAULT_COURSE_PAR;

  const allCourseHandicaps = [
    ...teamAPlayers.map((p) => calculateCourseHandicap(p.handicapIndex, slopeRating, courseRating, coursePar)),
    ...teamBPlayers.map((p) => calculateCourseHandicap(p.handicapIndex, slopeRating, courseRating, coursePar)),
  ];
  const lowestHandicap = Math.min(...allCourseHandicaps);

  const teamAPlayersWithStrokes = teamAPlayers.map((p, idx) => ({
    playerId: p.playerId,
    strokesReceived: calculateStrokesReceived(allCourseHandicaps[idx] - lowestHandicap, c.holes),
  }));
  const teamBPlayersWithStrokes = teamBPlayers.map((p, idx) => ({
    playerId: p.playerId,
    strokesReceived: calculateStrokesReceived(allCourseHandicaps[teamAPlayers.length + idx] - lowestHandicap, c.holes),
  }));

  return { teamAPlayersWithStrokes, teamBPlayersWithStrokes, courseHandicaps: allCourseHandicaps };
}

describe("computeTeamsWithStrokes parity with the legacy inline logic", () => {
  const fixtures: [string, { playerId: string; handicapIndex: number }[], { playerId: string; handicapIndex: number }[]][] = [
    ["singles", [{ playerId: "pA", handicapIndex: 7.4 }], [{ playerId: "pB", handicapIndex: 12.1 }]],
    [
      "two-man teams",
      [{ playerId: "pA1", handicapIndex: 2.3 }, { playerId: "pA2", handicapIndex: 18.9 }],
      [{ playerId: "pB1", handicapIndex: 9.0 }, { playerId: "pB2", handicapIndex: 5.6 }],
    ],
    [
      "scratch and plus handicaps",
      [{ playerId: "pA1", handicapIndex: 0 }, { playerId: "pA2", handicapIndex: -2.5 }],
      [{ playerId: "pB1", handicapIndex: 24.7 }, { playerId: "pB2", handicapIndex: 11.2 }],
    ],
  ];

  for (const [label, teamA, teamB] of fixtures) {
    it(`matches legacy output for ${label}`, () => {
      expect(computeTeamsWithStrokes(teamA, teamB, course)).toEqual(legacyCompute(teamA, teamB, course));
    });
  }

  it("matches legacy fallbacks when course slope/rating/par are missing", () => {
    const bare = { holes: courseHoles() };
    const teamA = [{ playerId: "pA", handicapIndex: 10.4 }];
    const teamB = [{ playerId: "pB", handicapIndex: 3.2 }];
    expect(computeTeamsWithStrokes(teamA, teamB, bare)).toEqual(legacyCompute(teamA, teamB, bare));
  });
});

describe("computeTeamsWithStrokes behavior", () => {
  it("gives the lowest player zero strokes (spin-down)", () => {
    const result = computeTeamsWithStrokes(
      [{ playerId: "low", handicapIndex: 2.0 }],
      [{ playerId: "high", handicapIndex: 14.0 }],
      course
    );
    expect(result.teamAPlayersWithStrokes[0].strokesReceived.every((s) => s === 0)).toBe(true);
    const highStrokes = result.teamBPlayersWithStrokes[0].strokesReceived;
    const expectedCount = result.courseHandicaps[1] - result.courseHandicaps[0];
    expect(highStrokes.reduce((a, b) => a + b, 0)).toBe(Math.min(expectedCount, 18));
  });

  it("assigns strokes to the hardest holes first", () => {
    const result = computeTeamsWithStrokes(
      [{ playerId: "low", handicapIndex: 0 }],
      [{ playerId: "high", handicapIndex: 1.0 }],
      { ...course, rating: 72 } // keep the diff small and deterministic
    );
    const strokes = result.teamBPlayersWithStrokes[0].strokesReceived;
    const strokeCount = strokes.reduce((a, b) => a + b, 0);
    if (strokeCount > 0) {
      // hole with hcpIndex 1 is hole number 2 in the fixture
      expect(strokes[1]).toBe(1);
    }
  });
});

describe("resolveCourseParams", () => {
  it("applies the documented fallbacks", () => {
    expect(resolveCourseParams({ holes: [] })).toEqual({
      slopeRating: 113,
      courseRating: DEFAULT_COURSE_PAR,
      coursePar: DEFAULT_COURSE_PAR,
    });
    expect(resolveCourseParams({ slope: 130, rating: 71.5, par: 72, holes: [] })).toEqual({
      slopeRating: 130,
      courseRating: 71.5,
      coursePar: 72,
    });
    expect(resolveCourseParams({ par: 70, holes: [] })).toEqual({
      slopeRating: 113,
      courseRating: 70,
      coursePar: 70,
    });
  });
});
