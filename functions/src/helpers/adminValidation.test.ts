import { describe, expect, it } from "vitest";
import {
  describeRoundDeletionBlock,
  isSelfDemotion,
  playerTournamentReferences,
  validateCourseInput,
  type TournamentRefs,
} from "./adminValidation";

/** A valid 18-hole layout: pars sum to 72, hcpIndex 1-18 unique. */
function validHoles() {
  const pars = [4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 4, 3, 5, 4, 4, 3, 5, 4];
  return pars.map((par, i) => ({ number: i + 1, par, hcpIndex: i + 1, yards: 400 }));
}

function validCourse(overrides: Record<string, unknown> = {}) {
  return {
    name: "Chambers Bay",
    tees: "Blue",
    par: 72,
    rating: 71.5,
    slope: 130,
    holes: validHoles(),
    ...overrides,
  };
}

describe("validateCourseInput", () => {
  it("accepts a valid course and sorts holes by number", () => {
    const shuffled = validCourse({ holes: [...validHoles()].reverse() });
    const result = validateCourseInput(shuffled);
    expect(result.ok).toBe(true);
    expect(result.course?.holes.map((h) => h.number)).toEqual(
      Array.from({ length: 18 }, (_, i) => i + 1)
    );
    expect(result.course?.name).toBe("Chambers Bay");
  });

  it("rejects non-object payloads", () => {
    expect(validateCourseInput(null).ok).toBe(false);
    expect(validateCourseInput("x").ok).toBe(false);
  });

  it("requires a name", () => {
    const result = validateCourseInput(validCourse({ name: "  " }));
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("name is required");
  });

  it("enforces rating, slope, and par ranges", () => {
    expect(validateCourseInput(validCourse({ rating: 49 })).ok).toBe(false);
    expect(validateCourseInput(validCourse({ rating: 91 })).ok).toBe(false);
    expect(validateCourseInput(validCourse({ slope: 54 })).ok).toBe(false);
    expect(validateCourseInput(validCourse({ slope: 156 })).ok).toBe(false);
    expect(validateCourseInput(validCourse({ par: 59 })).ok).toBe(false);
    expect(validateCourseInput(validCourse({ par: 81 })).ok).toBe(false);
    expect(validateCourseInput(validCourse({ par: 72.5 })).ok).toBe(false);
  });

  it("requires exactly 18 holes", () => {
    const result = validateCourseInput(validCourse({ holes: validHoles().slice(0, 17) }));
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/exactly 18/);
  });

  it("rejects duplicate hole numbers", () => {
    const holes = validHoles();
    holes[1].number = 1;
    const result = validateCourseInput(validCourse({ holes }));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("number 1 is duplicated"))).toBe(true);
  });

  it("rejects duplicate hcpIndex values", () => {
    const holes = validHoles();
    holes[5].hcpIndex = 1;
    const result = validateCourseInput(validCourse({ holes }));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("hcpIndex 1 is duplicated"))).toBe(true);
  });

  it("rejects out-of-range hole pars", () => {
    const holes = validHoles();
    holes[0].par = 2;
    expect(validateCourseInput(validCourse({ holes })).ok).toBe(false);
  });

  it("rejects negative or fractional yards", () => {
    const holes = validHoles();
    holes[0].yards = -10;
    expect(validateCourseInput(validCourse({ holes })).ok).toBe(false);
  });

  it("allows holes without yards", () => {
    const holes = validHoles().map(({ yards: _yards, ...rest }) => rest);
    const result = validateCourseInput(validCourse({ holes }));
    expect(result.ok).toBe(true);
    expect(result.course?.holes[0].yards).toBeUndefined();
  });

  it("requires course par to equal the sum of hole pars", () => {
    const result = validateCourseInput(validCourse({ par: 71 }));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("sum of hole pars"))).toBe(true);
  });

  it("treats empty tees as absent", () => {
    const result = validateCourseInput(validCourse({ tees: "" }));
    expect(result.ok).toBe(true);
    expect(result.course?.tees).toBeUndefined();
  });
});

describe("describeRoundDeletionBlock", () => {
  it("allows deleting an empty round without force", () => {
    expect(describeRoundDeletionBlock(0, false)).toBeNull();
  });

  it("blocks a round with matches unless forced", () => {
    expect(describeRoundDeletionBlock(4, false)).toMatch(/4 matches/);
    expect(describeRoundDeletionBlock(1, false)).toMatch(/1 match\./);
    expect(describeRoundDeletionBlock(4, true)).toBeNull();
  });
});

describe("playerTournamentReferences", () => {
  const tournaments: TournamentRefs[] = [
    { id: "t1", teamA: { rosterByTier: { A: ["p1"], B: [] } }, teamB: {} },
    { id: "t2", teamA: {}, teamB: { handicapByPlayer: { p1: 7.4 } } },
    { id: "t3", teamA: { rosterByTier: { C: ["p2"] } }, teamB: {} },
    { id: "t4" },
  ];

  it("finds roster and handicap references on either team", () => {
    expect(playerTournamentReferences("p1", tournaments)).toEqual(["t1", "t2"]);
  });

  it("returns empty when unreferenced", () => {
    expect(playerTournamentReferences("p9", tournaments)).toEqual([]);
  });
});

describe("isSelfDemotion", () => {
  it("blocks removing your own admin flag", () => {
    expect(isSelfDemotion("pMe", "pMe", false)).toBe(true);
  });

  it("allows granting yourself (no-op) and changing others", () => {
    expect(isSelfDemotion("pMe", "pMe", true)).toBe(false);
    expect(isSelfDemotion("pMe", "pOther", false)).toBe(false);
  });
});
