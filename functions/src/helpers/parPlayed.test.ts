import { describe, it, expect } from "vitest";
import {
  parForPlayerHolesPlayed,
  parForTeamHolesPlayed,
  type HolePerfLike,
} from "./parPlayed.js";

// Real per-hole pars from the prod course docs. The par-71 case is the guard
// that matters: 2023 played two courses with different pars (Cholla 72,
// Saguaro 71), so nothing may assume a single course-level par.
const IDAHO_CLUB = [4, 3, 4, 3, 5, 4, 3, 4, 5, 5, 4, 5, 4, 3, 4, 3, 4, 4]; // par 71
const WEKOPA_CHOLLA = [4, 5, 3, 4, 3, 4, 4, 5, 4, 5, 3, 4, 4, 3, 4, 4, 5, 4]; // par 72
const DONALD_ROSS = [4, 4, 4, 3, 4, 3, 5, 4, 4, 4, 4, 4, 3, 4, 5, 3, 4, 4]; // par 70

/** Build a holePerformance array scoring holes 1..thru. */
function played(pars: number[], thru: number, gross = 4): HolePerfLike[] {
  return pars.map((par, i) => ({
    hole: i + 1,
    par,
    gross: i < thru ? gross : null,
  }));
}

describe("parForPlayerHolesPlayed", () => {
  describe("full 18 holes played", () => {
    it.each([
      ["idahoClub", IDAHO_CLUB, 71],
      ["wekopa-Cholla", WEKOPA_CHOLLA, 72],
      ["frenchLickDonaldRoss", DONALD_ROSS, 70],
    ])("%s: equals course par", (_name, pars, coursePar) => {
      expect(parForPlayerHolesPlayed(played(pars, 18))).toBe(coursePar);
    });
  });

  it("sums only holes played when the match closes early (5&4)", () => {
    // The regression this fix exists for: Cassady/Euckert shot 53 thru 14 at
    // idahoClub and were stored as -18 (53 - 71) instead of -3 (53 - 56).
    const parPlayed = parForPlayerHolesPlayed(played(IDAHO_CLUB, 14));
    expect(parPlayed).toBe(56);
    expect(53 - parPlayed).toBe(-3);
    expect(53 - 71).toBe(-18); // the old, wrong answer
  });

  it("excludes a non-contiguous picked-up hole", () => {
    const perf = played(IDAHO_CLUB, 18);
    perf[6].gross = null; // picked up on 7 (par 3)
    expect(parForPlayerHolesPlayed(perf)).toBe(71 - 3);
  });

  it("treats gross 0 as a real score, not a missing one", () => {
    // Guards the `typeof x === "number"` predicate against a truthiness bug.
    const perf: HolePerfLike[] = [{ hole: 1, par: 4, gross: 0 }];
    expect(parForPlayerHolesPlayed(perf)).toBe(4);
  });

  describe("empty and malformed input", () => {
    it("returns 0 for an empty array", () => {
      expect(parForPlayerHolesPlayed([])).toBe(0);
    });

    it.each([[null], [undefined]])("returns 0 for %s", (input) => {
      expect(parForPlayerHolesPlayed(input)).toBe(0);
    });

    it("skips entries with a null par", () => {
      const perf: HolePerfLike[] = [
        { hole: 1, par: 4, gross: 5 },
        { hole: 2, par: null, gross: 5 },
      ];
      expect(parForPlayerHolesPlayed(perf)).toBe(4);
    });

    it("returns 0 when no hole was scored", () => {
      expect(parForPlayerHolesPlayed(played(IDAHO_CLUB, 0))).toBe(0);
    });
  });

  describe("holePars override", () => {
    it("beats a stale perf.par", () => {
      const perf: HolePerfLike[] = [
        { hole: 1, par: 3, gross: 4 }, // stale: course doc now says 4
        { hole: 2, par: 4, gross: 4 },
      ];
      expect(parForPlayerHolesPlayed(perf, IDAHO_CLUB)).toBe(4 + 3);
    });

    it("skips a hole number outside the holePars array", () => {
      const perf: HolePerfLike[] = [
        { hole: 1, par: 4, gross: 4 },
        { hole: 99, par: 4, gross: 4 },
      ];
      expect(parForPlayerHolesPlayed(perf, IDAHO_CLUB)).toBe(4);
    });
  });
});

describe("parForTeamHolesPlayed", () => {
  describe("scramble (team gross stored in `gross`)", () => {
    it("matches the individual predicate on a full round", () => {
      expect(parForTeamHolesPlayed(played(DONALD_ROSS, 18), "twoManScramble")).toBe(70);
    });

    it("sums only holes played when closed early", () => {
      expect(parForTeamHolesPlayed(played(IDAHO_CLUB, 14), "twoManScramble")).toBe(56);
    });

    it("applies to fourManScramble too", () => {
      expect(parForTeamHolesPlayed(played(IDAHO_CLUB, 14), "fourManScramble")).toBe(56);
    });
  });

  describe("shamble (individual gross + partnerGross)", () => {
    it("counts a hole where only the partner has a ball", () => {
      const perf: HolePerfLike[] = [{ hole: 1, par: 4, gross: null, partnerGross: 5 }];
      expect(parForTeamHolesPlayed(perf, "twoManShamble")).toBe(4);
    });

    it("counts a hole where only this player has a ball", () => {
      const perf: HolePerfLike[] = [{ hole: 1, par: 4, gross: 5, partnerGross: null }];
      expect(parForTeamHolesPlayed(perf, "twoManShamble")).toBe(4);
    });

    it("excludes a hole where neither partner has a ball", () => {
      const perf: HolePerfLike[] = [{ hole: 1, par: 4, gross: null, partnerGross: null }];
      expect(parForTeamHolesPlayed(perf, "twoManShamble")).toBe(0);
    });

    it("gives both partners' facts the same team par (symmetry invariant)", () => {
      // The two facts for one shamble team are mirror images: each stores its own
      // player's gross in `gross` and the other's in `partnerGross`. teamTotalGross
      // takes min(both) on any hole where either scored, so both facts must agree
      // on team par — this is what a naive `gross != null` gate breaks.
      const cassady: HolePerfLike[] = [
        { hole: 1, par: 4, gross: 4, partnerGross: 5 },
        { hole: 2, par: 3, gross: null, partnerGross: 4 }, // only partner scored
        { hole: 3, par: 4, gross: 5, partnerGross: null }, // only Cassady scored
        { hole: 4, par: 3, gross: null, partnerGross: null }, // neither: not played
      ];
      const furden: HolePerfLike[] = cassady.map((p) => ({
        ...p,
        gross: p.partnerGross ?? null,
        partnerGross: p.gross ?? null,
      }));

      const a = parForTeamHolesPlayed(cassady, "twoManShamble");
      const b = parForTeamHolesPlayed(furden, "twoManShamble");

      expect(a).toBe(b);
      expect(a).toBe(4 + 3 + 4); // hole 4 excluded
    });
  });

  it("honors the holePars override", () => {
    const perf: HolePerfLike[] = [{ hole: 1, par: 3, gross: 4 }];
    expect(parForTeamHolesPlayed(perf, "twoManScramble", IDAHO_CLUB)).toBe(4);
  });
});
